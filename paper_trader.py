"""적응형 실시간 페이퍼 트레이딩 시스템.

6전략 평가 → 최적 전략 선택 → 실시간 모니터링 → 동적 전략 전환.
빗썸 실시간 가격으로 가상 매매를 수행하며, 시장 상태에 따라 전략을 자동 교체한다.
"""
import argparse
import signal
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import List, Optional

import numpy as np
import pandas as pd
import schedule

import config
from backtest_scalp import Trade, compute_indicators, compute_regime
from exchange.bithumb_client import BithumbClient
from monitor.market_monitor import MarketMonitor, TriggerType
from monitor.strategy_evaluator import StrategyEvaluator, EvaluationResult
from dashboard.shared_state import PaperStateWriter
from strategy.scalp_strategy import ScalpStrategy, ScalpSignalContext
from strategy.market_regime import EnsembleRegimeDetector
from stats.kelly import kelly_from_trades, optimal_position_krw
from stats.garch_forecast import forecast_volatility, GarchForecast
from stats.bayesian_strategy import BayesianStrategyTracker
from stats.hmm_regime import detect_hmm_regime, HMMRegimeResult
from stats.evt_risk import analyze_tail_risk
from stats.monte_carlo import run_monte_carlo
from learning.paper_trade_adapter import PaperTradeAdapter
from learning.trade_insight_engine import TradeInsightEngine
from learning.trade_journal import TradeJournal, AppliedInsight
from learning.unified_insight_engine import UnifiedInsightEngine


# ── 페이퍼 트레이딩 설정 (config.py에서 읽기) ──────────────
PAPER_DEFAULT_CAPITAL = config.PAPER_INITIAL_KRW
PAPER_FEE_PCT = config.BACKTEST_FEE_PCT
PAPER_SLIPPAGE_PCT = config.BACKTEST_SLIPPAGE_PCT
PAPER_TRADING_INTERVAL_SEC = config.PAPER_TRADING_INTERVAL_SEC
PAPER_REPORT_INTERVAL_MIN = config.PAPER_REPORT_INTERVAL_MIN
PAPER_OHLCV_COUNT = config.PAPER_OHLCV_COUNT
PAPER_STARTUP_OHLCV_COUNT = config.PAPER_STARTUP_OHLCV_COUNT
PAPER_REEVAL_COOLDOWN_MIN = config.PAPER_REEVAL_COOLDOWN_MIN


@dataclass
class PaperPosition:
    """가상 보유 포지션."""
    coin: str
    entry_price: float        # 슬리피지 포함 진입가
    quantity: float            # 코인 수량
    entry_time: str
    sl_pct: float              # 손절 %
    tp_pct: float              # 익절 %
    strategy: str              # 진입 전략 (e.g. "S3_HA")
    ha_weak_min_pct: float = 0.0  # HA_WEAK 청산 최소 이익 %
    invested_krw: float = 0.0  # 투입 원화
    volatility_tier: str = "NORMAL"  # NORMAL / HOT / EXTREME
    trailing_high: float = 0.0      # 트레일링 스탑용 최고가 추적


@dataclass
class PaperTrade:
    """가상 거래 기록 + 학습용 컨텍스트."""
    coin: str
    strategy: str
    entry_price: float
    exit_price: float
    entry_time: str
    exit_time: str
    exit_reason: str
    quantity: float
    invested_krw: float
    returned_krw: float
    pnl_krw: float
    pnl_pct: float
    # ★ 학습용 컨텍스트 (거래별 인사이트 분석에 사용)
    entry_regime: str = "UNKNOWN"       # 진입 시 레짐 (BULL/BEAR/SIDEWAYS)
    exit_regime: str = "UNKNOWN"        # 청산 시 레짐
    volatility_tier: str = "NORMAL"     # 변동성 티어 (NORMAL/HOT/EXTREME)
    entry_rsi: float = 0.0             # 진입 시 RSI
    entry_volume_ratio: float = 0.0    # 진입 시 거래량 비율
    hold_minutes: int = 0              # 보유 시간 (분)
    sl_pct: float = 0.0               # 설정된 손절 %
    tp_pct: float = 0.0               # 설정된 익절 %


class AdaptivePaperTrader:
    """6전략 적응형 페이퍼 트레이딩 시스템.

    시작 시 전체 전략 평가 → 최적 선택 → 실시간 모니터링 → 동적 전환.
    """

    def __init__(
        self,
        coin: str = "BTC",
        capital: float = PAPER_DEFAULT_CAPITAL,
        interval_min: int = PAPER_TRADING_INTERVAL_SEC,
        report_min: int = PAPER_REPORT_INTERVAL_MIN,
        verbose: bool = False,
        end_time: Optional[datetime] = None,
        candle_interval: str = "1h",
    ) -> None:
        self._coin = coin
        self._initial_capital = capital
        self._balance_krw = capital       # 현재 원화 잔고
        self._interval_min = interval_min
        self._report_min = report_min
        self._verbose = verbose
        self._end_time = end_time          # 자동 종료 시각 (None이면 무한)
        self._managed = False              # True이면 PaperPortfolioManager가 상태 기록 담당
        self._candle_interval = candle_interval  # 코인별 최적 캔들 간격

        # 외부 컴포넌트
        self._client = BithumbClient("", "")   # 공개 API (시세 전용)
        self._monitor = MarketMonitor()
        self._evaluator = StrategyEvaluator()
        self._regime_detector = EnsembleRegimeDetector()
        self._strategy = ScalpStrategy(self._regime_detector)

        # 상태
        import threading
        self._position_lock = threading.Lock()
        self._position: Optional[PaperPosition] = None
        self._trades: List[PaperTrade] = []
        self._active_strategy_id = ""
        self._active_strategy_name = ""
        self._last_eval: Optional[EvaluationResult] = None
        self._last_reeval_time: Optional[datetime] = None
        self._running = False
        self._cycle_count = 0

        # 캐시 (마지막 OHLCV + 지표)
        self._cached_df: Optional[pd.DataFrame] = None
        self._cached_regimes: Optional[np.ndarray] = None

        # 고래 신호 부스트 (외부에서 주입)
        self._whale_buy_boost: bool = False   # True면 BUY 신호 시 즉시 실행
        self._whale_sell_alert: bool = False  # True면 포지션 보유 시 주의
        self._surge_boost: bool = False       # ★ True면 급등 감지 → 신호 없이도 즉시 매수 가능

        # 학습 어댑터 — 페이퍼 거래를 학습 엔진 호환 포맷으로 변환
        self._volatility_tier: str = "NORMAL"  # 코인 변동성 티어
        self._trade_adapter = PaperTradeAdapter(coin=coin)
        self._insight_engine = TradeInsightEngine()  # ★ 개별 거래 인사이트 엔진
        self._unified_engine = UnifiedInsightEngine(self._insight_engine)  # ★ 통합 인사이트
        self._trade_journal = TradeJournal()          # ★ 거래 저널 (이력+분석+반영추적)
        self._entry_applied_insights: List[AppliedInsight] = []  # 진입 시 적용된 인사이트
        self._blocked_hours: set = set()            # 저성과 시간대 차단
        self._block_downtrend_buy: bool = False     # 하락추세 매수 차단
        self._position_multiplier: float = 1.0      # 포지션 크기 배율
        self._adapted_sl_pct: Optional[float] = None  # 학습된 손절%
        self._adapted_tp_pct: Optional[float] = None  # 학습된 익절%
        self._last_adaptation: Optional[datetime] = None
        self._adaptation_count: int = 0

        # ── 고급 통계 모듈 ──────────────────────────────────────
        self._bayesian = BayesianStrategyTracker(
            prior_alpha=config.BAYESIAN_PRIOR_ALPHA,
            prior_beta=config.BAYESIAN_PRIOR_BETA,
        )
        self._garch_forecast: Optional[GarchForecast] = None
        self._hmm_result: Optional[HMMRegimeResult] = None
        self._last_hmm_fit: Optional[datetime] = None

    # ── 라이프사이클 ──────────────────────────────────────────

    def startup(self) -> bool:
        """데이터 수집 → 6전략 평가 → 최적 전략 선택."""
        self._print_header()

        # Step 1: 데이터 수집
        print(f"[1/3] 데이터 수집 중... ", end="", flush=True)
        df = self._fetch_ohlcv(PAPER_STARTUP_OHLCV_COUNT)
        if df is None or len(df) < 200:
            print("FAIL")
            print("  오류: 충분한 데이터를 가져올 수 없습니다.")
            return False
        print(f"OK ({len(df)}개 {self._candle_interval} 캔들)")

        # Step 2: 지표 계산 + 레짐 감지
        print("[2/3] 지표 계산 + 레짐 감지... ", end="", flush=True)
        df = compute_indicators(df)
        regimes = compute_regime(df)
        self._cached_df = df
        self._cached_regimes = regimes
        current_regime = str(regimes[-1]) if len(regimes) > 0 else "UNKNOWN"
        print(f"완료 (현재 레짐: {current_regime})")

        # Step 3: 6전략 평가
        print("[3/3] 6전략 평가 중...")
        result = self._evaluator.evaluate_all(df, regimes)
        self._last_eval = result
        StrategyEvaluator.print_evaluation_table(result)

        if result.best is None:
            # ★ 학습을 위해 최고 점수 전략을 fallback으로 사용
            if result.scores:
                fallback = result.scores[0]
                print(f"  ⚠️ 양호한 전략 없음 — fallback: {fallback.name} "
                      f"(점수: {fallback.score:.1f})")
                self._active_strategy_id = fallback.strategy_id
                self._active_strategy_name = fallback.name
            else:
                print("  경고: 평가 가능한 전략 없음 — HOLD 모드.")
                self._active_strategy_id = ""
                self._active_strategy_name = "NONE"
        else:
            self._active_strategy_id = result.best.strategy_id
            self._active_strategy_name = result.best.name
            print(f"\n  활성 전략: {result.best.name} "
                  f"(점수: {result.best.score:.1f})")

        # ★ 학습 상태 복원 (재시작해도 이전 학습 유지)
        self._load_learning_state()

        # 대시보드 상태 기록
        if not self._managed:
            PaperStateWriter.update(self)
        return True

    def run(self) -> None:
        """스케줄러 루프 시작 (Ctrl+C 또는 end_time에 종료)."""
        self._running = True
        end_msg = ""
        if self._end_time:
            end_msg = f" → {self._end_time.strftime('%m/%d %H:%M')} 자동 종료"
        print(f"\n페이퍼 트레이딩 시작... "
              f"({self._interval_min}초 사이클{end_msg})")
        print(f"{'─'*64}\n")

        # 스케줄러 등록 (초 단위)
        schedule.every(self._interval_min).seconds.do(self._safe_trading_cycle)
        schedule.every(self._report_min).minutes.do(self._safe_hourly_report)

        # 즉시 첫 사이클 실행
        self._safe_trading_cycle()

        # 시그널 핸들러
        signal.signal(signal.SIGINT, self._handle_shutdown)

        while self._running:
            try:
                # 종료 시각 도달 체크
                if self._end_time and datetime.now() >= self._end_time:
                    print(f"\n⏰ 종료 시각 도달: {self._end_time.strftime('%Y-%m-%d %H:%M')}")
                    break
                schedule.run_pending()
                time.sleep(1)
            except KeyboardInterrupt:
                break

        self.shutdown()

    def shutdown(self) -> None:
        """종료 시 최종 요약 출력."""
        self._running = False
        schedule.clear()

        # 미청산 포지션 처리
        if self._position:
            price = self._client.get_current_price(self._coin)
            if price:
                self._execute_sell(price, "SHUTDOWN")

        self._print_final_summary()

    def _handle_shutdown(self, signum, frame) -> None:
        """Ctrl+C 시그널 핸들러."""
        print("\n\n종료 신호 수신...")
        self._running = False

    # ── 매 사이클 (5분) ───────────────────────────────────────

    def _safe_trading_cycle(self) -> None:
        """trading_cycle 예외 안전 래퍼."""
        try:
            self.trading_cycle()
        except Exception as e:
            now = datetime.now().strftime("%H:%M")
            print(f"[{now}] ❌ 사이클 오류: {e}", file=sys.stderr)

    def trading_cycle(self) -> None:
        """핵심 트레이딩 사이클: 데이터 → 모니터링 → 신호 → 매매."""
        self._cycle_count += 1
        now = datetime.now().strftime("%H:%M")

        # 1. OHLCV 갱신
        df = self._fetch_ohlcv(PAPER_OHLCV_COUNT)
        if df is None:
            if self._verbose:
                print(f"[{now}] SKIP  | 데이터 수집 실패")
            return

        df = compute_indicators(df)
        regimes = compute_regime(df)
        self._cached_df = df
        self._cached_regimes = regimes

        # 1.5. 통계 모듈 갱신 (GARCH + HMM)
        self._update_stats_models(df)

        # 2. 현재가 조회
        price = self._client.get_current_price(self._coin)
        if price is None:
            if self._verbose:
                print(f"[{now}] SKIP  | 가격 조회 실패")
            return

        # ★ 실시간 가격 추적 (대시보드용)
        self._prev_price = getattr(self, "_last_price", price)
        self._last_price = price

        # 3. 시장 모니터링 → 트리거 확인
        recent_trades_for_monitor = [
            _trade_to_backtest_trade(t) for t in self._trades[-10:]
        ]
        triggers = self._monitor.check(df, regimes, recent_trades_for_monitor)
        if triggers:
            self._handle_triggers(triggers, df, regimes)

        # 4. 포지션 있으면: 청산 조건 확인
        if self._position:
            # ★ 고래 매도 경고 시: 유예 기간 + 손실 임계치 확인 후 청산
            # ★ 교훈: WHALE_SELL 오탐 시 비활성화
            actions = self._unified_engine.get_unified_actions()
            if actions.block_whale_sell:
                self._whale_sell_alert = False  # 교훈에 의해 비활성화
            if self._whale_sell_alert:
                _et = self._position.entry_time
                if isinstance(_et, str):
                    _et = datetime.strptime(_et, "%Y-%m-%d %H:%M")
                _now = datetime.now()
                hold_seconds = (_now - _et).total_seconds()
                # 변동성 티어별 유예 기간: EXTREME/HOT은 고래 빈도가 높으므로 더 길게
                grace_map = {"EXTREME": 600, "HOT": 300, "NORMAL": 120}  # 초
                grace_sec = grace_map.get(self._volatility_tier, 120)
                # 변동성 티어별 손실 임계치 (NotebookLM: 기존값 너무 민감 → 2배 상향)
                pnl_threshold_map = {"EXTREME": -4.0, "HOT": -3.0, "NORMAL": -1.0}
                pnl_threshold = pnl_threshold_map.get(self._volatility_tier, -0.5)

                pnl_now = (
                    (price - self._position.entry_price)
                    / self._position.entry_price * 100
                )
                if hold_seconds >= grace_sec and pnl_now < pnl_threshold:
                    if self._verbose:
                        print(f"  🐋⚠️ 고래 매도 + 손실({pnl_now:+.1f}%) "
                              f"유예{grace_sec}s 경과 → 조기 청산")
                    self._execute_sell(price, "WHALE_SELL")
                    self._whale_sell_alert = False
                    return
                elif self._verbose and hold_seconds < grace_sec:
                    remain = int(grace_sec - hold_seconds)
                    print(f"  🐋 고래 매도 감지 but 유예 중 "
                          f"({remain}s 남음, PnL:{pnl_now:+.1f}%) → 무시")
                self._whale_sell_alert = False  # 조건 미충족이면 리셋

            self._check_exit(price, df)
            if self._position is None:
                return  # 청산됨 → 이번 사이클 종료

        # 5. 포지션 없으면: 신호 생성 → 매수
        # ★ 전략 NONE이어도 워터폴 실행 (모든 코인에 기회 부여)
        if self._position is None:
            # ★ 인사이트 학습 승률로 워터폴 우선순위 동적 재정렬
            _scores = self._unified_engine.get_unified_actions().strategy_scores
            ctx = self._strategy.generate_signal_with_context(
                df, strategy_scores=_scores
            )
            self._print_cycle_status(now, price, ctx)

            if ctx.signal == "BUY":
                # 5a-0. ★ FAKE_SIGNAL 필터 (교훈: 진입 즉시 역행 방지)
                fake_blocked = self._check_fake_signal_filter(df, price)
                if fake_blocked and not self._surge_boost:
                    if self._verbose:
                        print(f"  → FAKE_SIGNAL 필터: 모멘텀 약세 → 진입 보류")
                    return

                # 5a. 학습된 필터 적용 (시간대 + 추세 + 전략×레짐 + 연속손실)
                # ★ 급등 부스트 시 학습 필터 우회 (급등은 시간대 무관)
                blocked, block_reason = self._check_learned_filters(
                    regimes=regimes, ctx=ctx
                )
                if blocked and not self._surge_boost:
                    if self._verbose:
                        print(f"  → 학습 필터 차단: {block_reason}")
                # 5b. ★ 워터폴 BUY 신호는 전략 무관 수용 (전략 불일치 필터 제거)
                else:
                    boost_tag = ""
                    if self._surge_boost:
                        boost_tag = " 🚀급등"
                    elif self._whale_buy_boost:
                        boost_tag = " 🐋"
                    if boost_tag and self._verbose:
                        print(f"  → 부스트 활성: 즉시 진입{boost_tag}")
                    self._execute_buy(price, ctx)
                    self._whale_buy_boost = False  # 한 번 사용 후 리셋
                    self._surge_boost = False      # 한 번 사용 후 리셋
        # 포지션 보유 중 상태 출력 (위의 if에서 _position is None이 아닌 경우)
        if self._position and self._verbose:
            pnl = (price - self._position.entry_price) / \
                self._position.entry_price * 100
            print(f"[{now}] HOLD  | {price:,.0f} | "
                  f"{self._active_strategy_name} | "
                  f"포지션 보유 중 (PnL: {pnl:+.2f}%)")

        # 대시보드 상태 기록 (매 사이클)
        if not self._managed:
            PaperStateWriter.update(self)

    # ── 트리거 핸들링 ─────────────────────────────────────────

    def _handle_triggers(
        self,
        triggers: list,
        df: pd.DataFrame,
        regimes: np.ndarray,
    ) -> None:
        """모니터 트리거 발동 → 전략 재평가 + 전환."""
        now = datetime.now().strftime("%H:%M")

        for t in triggers:
            severity_icon = "⚡" if t.severity == "HIGH" else "⚠️"
            print(f"[{now}] {severity_icon} TRIGGER | "
                  f"{t.trigger_type.value}: {t.description}")

        # 쿨다운 체크
        if self._last_reeval_time:
            elapsed = (datetime.now() - self._last_reeval_time).total_seconds()
            if elapsed < PAPER_REEVAL_COOLDOWN_MIN * 60:
                if self._verbose:
                    remaining = PAPER_REEVAL_COOLDOWN_MIN - elapsed / 60
                    print(f"        재평가 쿨다운 중 ({remaining:.0f}분 남음)")
                return

        # HIGH 심각도 트리거가 있으면 전략 재평가
        has_high = any(t.severity == "HIGH" for t in triggers)
        if not has_high:
            return

        print(f"        전략 재평가 실행...")
        result = self._evaluator.quick_eval(df, regimes)
        self._last_eval = result
        self._last_reeval_time = datetime.now()

        if result.best is None:
            if self._active_strategy_id:
                print(f"        전략 비활성화: {self._active_strategy_name} → NONE")
                self._active_strategy_id = ""
                self._active_strategy_name = "NONE"
            return

        old_name = self._active_strategy_name
        if result.best.strategy_id != self._active_strategy_id:
            self._active_strategy_id = result.best.strategy_id
            self._active_strategy_name = result.best.name
            print(f"        전략 전환: {old_name} → {result.best.name} "
                  f"(점수: {result.best.score:.1f})")

            # 전략 전환 시 포지션 정리 (★ 교훈: 최소 보유 시간 확인)
            if self._position:
                _actions = self._unified_engine.get_unified_actions()
                min_hold = _actions.min_hold_minutes
                if min_hold > 0:
                    _et = self._position.entry_time
                    if isinstance(_et, str):
                        _et = datetime.strptime(_et, "%Y-%m-%d %H:%M")
                    held_min = (datetime.now() - _et).total_seconds() / 60
                    if held_min < min_hold:
                        if self._verbose:
                            print(f"        교훈: 최소 보유 {min_hold}분 미달 "
                                  f"({held_min:.0f}분) → 전략 전환 청산 보류")
                        # 전략은 전환하되 청산은 하지 않음
                        continue_hold = True
                    else:
                        continue_hold = False
                else:
                    continue_hold = False

                if not continue_hold:
                    price = self._client.get_current_price(self._coin)
                    if price:
                        print(f"        전략 전환 — 기존 포지션 청산")
                        self._execute_sell(price, "STRATEGY_SWITCH")
        else:
            print(f"        전략 유지: {result.best.name} "
                  f"(점수: {result.best.score:.1f})")

    # ── 매매 실행 ─────────────────────────────────────────────

    def _execute_buy(self, price: float, ctx: ScalpSignalContext) -> None:
        """가상 매수 실행 (Kelly 사이징 + GARCH 동적 SL/TP)."""
        if self._balance_krw <= 0:
            return

        now = datetime.now().strftime("%H:%M")

        # Kelly 포지션 사이징: 과거 거래 기반 최적 투입 비율
        invest_krw = self._calc_kelly_position()

        # 학습 기반 포지션 사이징 조정 (승률 낮으면 축소, 높으면 유지/확대)
        if self._position_multiplier != 1.0:
            invest_krw = int(invest_krw * self._position_multiplier)
            invest_krw = max(invest_krw, 10_000)  # 최소 1만원

        # ★ 인사이트 기반 티어별 포지션 축소 (EXTREME/HOT 승률 <25%면 축소)
        invest_krw = self._apply_tier_scaling(invest_krw)

        # ★ SIDEWAYS 레짐 포지션 축소 (48% 승률, -2,461만원)
        current_regime = getattr(self._monitor, "current_regime", "UNKNOWN")
        if current_regime == "SIDEWAYS" and config.SIDEWAYS_POSITION_SCALE < 1.0:
            invest_krw = int(invest_krw * config.SIDEWAYS_POSITION_SCALE)
            if self._verbose:
                print(f"  📊 SIDEWAYS 축소: ×{config.SIDEWAYS_POSITION_SCALE}")

        # ★ 연속 손실 점진적 축소 (2연패 70%, 3연패 50%, 4연패 30%)
        actions_for_sizing = self._insight_engine.get_actions()
        consec = actions_for_sizing.consecutive_losses
        consec_scale = 1.0
        for threshold in sorted(config.CONSEC_LOSS_SCALES.keys()):
            if consec >= threshold:
                consec_scale = config.CONSEC_LOSS_SCALES[threshold]
        if consec_scale < 1.0:
            invest_krw = int(invest_krw * consec_scale)
            if self._verbose:
                print(f"  📊 연속 {consec}패 축소: ×{consec_scale}")

        # GARCH 동적 SL/TP 조정
        sl_pct, tp_pct = self._adjust_sl_tp_by_garch(ctx.sl_pct, ctx.tp_pct)

        # ★ 인사이트 기반 SL 확대 (SL/SL_FAST 비율 > 50%면 SL 넓힘)
        actions = self._unified_engine.get_unified_actions()
        if actions.should_widen_sl and self._adapted_sl_pct is None:
            sl_pct = sl_pct + actions.sl_widen_pct
            if self._verbose:
                print(f"  📊 인사이트 SL 확대: +{actions.sl_widen_pct}% "
                      f"→ {sl_pct:.2f}%")

        # ★ 진입 시 적용된 인사이트 캡처 (저널용)
        self._entry_applied_insights = self._capture_applied_insights(actions)

        # 학습 기반 SL/TP 오버라이드 (적응 엔진이 제안한 값 적용)
        if self._adapted_sl_pct is not None:
            sl_pct = self._adapted_sl_pct
        if self._adapted_tp_pct is not None:
            tp_pct = self._adapted_tp_pct

        entry_price = price * (1 + PAPER_SLIPPAGE_PCT / 100)
        fee = invest_krw * (PAPER_FEE_PCT / 100)
        investable = invest_krw - fee
        quantity = investable / entry_price

        # ★ 급등락 코인 SL/TP 동적 조정 (6개월 788건 그리드서치 최적)
        vol_tier = self._volatility_tier
        if vol_tier == "EXTREME":
            sl_pct = round(sl_pct * config.VOLATILE_EXTREME_SL_MULT, 2)
            tp_pct = round(tp_pct * config.VOLATILE_EXTREME_TP_MULT, 2)
        elif vol_tier == "HOT":
            sl_pct = round(sl_pct * config.VOLATILE_HOT_SL_MULT, 2)
            tp_pct = round(tp_pct * config.VOLATILE_HOT_TP_MULT, 2)

        # ★ 티어별 SL 최소값 강제 (#35: 0.14% SL → 노이즈 즉시 청산 방지)
        tier_min_sl = {"EXTREME": 2.0, "HOT": 1.5, "NORMAL": 0.8}
        sl_pct = max(sl_pct, tier_min_sl.get(vol_tier, 0.8))
        tp_pct = max(tp_pct, sl_pct * 1.5)  # TP는 최소 SL의 1.5배

        self._position = PaperPosition(
            coin=self._coin,
            entry_price=entry_price,
            quantity=quantity,
            entry_time=datetime.now().strftime("%Y-%m-%d %H:%M"),
            sl_pct=sl_pct,
            tp_pct=tp_pct,
            strategy=ctx.sub_strategy,
            ha_weak_min_pct=ctx.ha_weak_min_pct,
            invested_krw=invest_krw,
            volatility_tier=vol_tier,
            trailing_high=entry_price,
        )
        self._balance_krw -= invest_krw

        # ★ 진입 시 컨텍스트 저장 (청산 시 인사이트 분석용)
        self._entry_regime = getattr(self._monitor, "current_regime", "UNKNOWN")
        try:
            cdf = self._cached_df
            if cdf is not None and len(cdf) > 0:
                self._entry_rsi = float(cdf["rsi"].iloc[-1]) if "rsi" in cdf.columns else 0.0
                avg_vol = cdf["volume"].rolling(20).mean().iloc[-1]
                self._entry_volume_ratio = float(
                    cdf["volume"].iloc[-1] / avg_vol
                ) if avg_vol > 0 else 0.0
            else:
                self._entry_rsi = 0.0
                self._entry_volume_ratio = 0.0
        except Exception:
            self._entry_rsi = 0.0
            self._entry_volume_ratio = 0.0

        kelly_tag = ""
        if len(self._trades) >= config.KELLY_MIN_TRADES:
            kelly_pct = invest_krw / (self._balance_krw + invest_krw) * 100
            kelly_tag = f" | Kelly {kelly_pct:.0f}%"

        garch_tag = ""
        if self._garch_forecast:
            garch_tag = f" | Vol:{self._garch_forecast.vol_regime}"

        adapt_tag = ""
        if self._adapted_sl_pct is not None or self._position_multiplier != 1.0:
            adapt_tag = f" | 학습적용"

        vol_tag = ""
        if vol_tier != "NORMAL":
            vol_tag = f" | 🔥{vol_tier}"

        print(f"[{now}] BUY   | {price:,.0f} | {ctx.sub_strategy} | "
              f"SL {sl_pct:.1f}% TP {tp_pct:.1f}% | "
              f"{invest_krw:,.0f}원 투입{kelly_tag}{garch_tag}{adapt_tag}{vol_tag}")
        if self._verbose:
            print(f"  → 진입가(슬리피지): {entry_price:,.0f}, "
                  f"수량: {quantity:.8f}, 수수료: {fee:,.0f}원")

    def _execute_sell(self, price: float, reason: str) -> None:
        """가상 매도 실행 (잔고 갱신)."""
        if self._position is None:
            return

        # ★ 비정상 가격 방어 (#33: NEO -100% 방지)
        pos = self._position
        if price is None or price <= 0:
            print(f"  ⚠️ 매도 차단: 가격 비정상 ({price}) — 다음 사이클 재시도")
            return
        # 진입가 대비 50% 이상 급락은 데이터 오류로 판단
        if price < pos.entry_price * 0.5:
            print(f"  ⚠️ 매도 차단: 가격 급락 의심 "
                  f"({price:,.0f} < 진입가 {pos.entry_price:,.0f}의 50%) — 스킵")
            return

        now = datetime.now().strftime("%H:%M")
        exit_price = price * (1 - PAPER_SLIPPAGE_PCT / 100)
        gross_krw = pos.quantity * exit_price
        fee = gross_krw * (PAPER_FEE_PCT / 100)
        returned_krw = gross_krw - fee
        pnl_krw = returned_krw - pos.invested_krw
        pnl_pct = pnl_krw / pos.invested_krw * 100 if pos.invested_krw > 0 else 0

        self._balance_krw += returned_krw

        # ★ 보유 시간 계산
        hold_min = 0
        try:
            from datetime import datetime as dt2
            entry_dt = dt2.strptime(pos.entry_time, "%Y-%m-%d %H:%M")
            hold_min = int((datetime.now() - entry_dt).total_seconds() / 60)
        except Exception:
            pass

        # ★ 현재 레짐/지표 캡처
        exit_regime = getattr(self._monitor, "current_regime", "UNKNOWN")
        entry_rsi = getattr(self, "_entry_rsi", 0.0)
        entry_vol_ratio = getattr(self, "_entry_volume_ratio", 0.0)
        entry_regime = getattr(self, "_entry_regime", "UNKNOWN")

        trade = PaperTrade(
            coin=pos.coin,
            strategy=pos.strategy,
            entry_price=pos.entry_price,
            exit_price=exit_price,
            entry_time=pos.entry_time,
            exit_time=datetime.now().strftime("%Y-%m-%d %H:%M"),
            exit_reason=reason,
            quantity=pos.quantity,
            invested_krw=pos.invested_krw,
            returned_krw=returned_krw,
            pnl_krw=pnl_krw,
            pnl_pct=pnl_pct,
            entry_regime=entry_regime,
            exit_regime=exit_regime,
            volatility_tier=getattr(pos, "volatility_tier", self._volatility_tier),
            entry_rsi=entry_rsi,
            entry_volume_ratio=entry_vol_ratio,
            hold_minutes=hold_min,
            sl_pct=pos.sl_pct,
            tp_pct=pos.tp_pct,
        )
        self._trades.append(trade)
        self._position = None

        # 학습 어댑터에 거래 기록 (적응 사이클용)
        self._trade_adapter.record(trade)

        # ★ 개별 거래 인사이트 분석 + 기록
        self._record_trade_insight(trade)

        # Bayesian 전략 신뢰도 업데이트
        belief = self._bayesian.update(pos.strategy, pnl_pct)
        bayes_tag = ""
        if belief.total_trades >= 5:
            lo, hi = belief.confidence_interval
            bayes_tag = (f" | Bayes WR:{belief.mean_win_rate*100:.0f}%"
                         f" [{lo*100:.0f}-{hi*100:.0f}]")

        print(f"[{now}] EXIT  | {price:,.0f} | {reason} | "
              f"{pnl_krw:+,.0f}원 ({pnl_pct:+.2f}%) | "
              f"잔고: {self._balance_krw:,.0f}원{bayes_tag}")

        # 매도 즉시 대시보드 갱신
        if not self._managed:
            PaperStateWriter.update(self)

    def _capture_applied_insights(self, actions) -> List[AppliedInsight]:
        """진입 시 현재 적용 중인 인사이트를 캡처한다."""
        applied = []
        if actions.blocked_strategy_regimes:
            applied.append(AppliedInsight(
                insight_type="BLOCKED_COMBO",
                description=f"차단 조합 활성: {actions.blocked_strategy_regimes}",
            ))
        if actions.tier_position_scale:
            applied.append(AppliedInsight(
                insight_type="TIER_SCALE",
                description=f"티어 축소: {actions.tier_position_scale}",
            ))
        if actions.should_widen_sl:
            applied.append(AppliedInsight(
                insight_type="SL_WIDEN",
                description=f"SL 확대 +{actions.sl_widen_pct}%",
            ))
        if actions.strategy_scores:
            top = max(actions.strategy_scores,
                      key=actions.strategy_scores.get)
            applied.append(AppliedInsight(
                insight_type="STRATEGY_PRIORITY",
                description=f"전략 우선순위: {top} "
                            f"({actions.strategy_scores[top]}점)",
            ))
        if actions.blocked_hours:
            applied.append(AppliedInsight(
                insight_type="BLOCKED_HOUR",
                description=f"차단 시간대: {sorted(actions.blocked_hours)}",
            ))
        return applied

    def _record_trade_insight(self, trade) -> None:
        """★ 개별 거래 인사이트를 분석하고 저널에 기록한다."""
        try:
            insight = self._insight_engine.analyze_trade(trade)
            icon = "✅" if insight.win else "❌"
            print(f"  {icon} 인사이트: {insight.diagnosis}")
            print(f"     카테고리: {insight.category} | "
                  f"{insight.entry_regime}→{insight.exit_regime} | "
                  f"{insight.volatility_tier} | {insight.hold_minutes}분 보유")

            # ★ 저널에 기록 (인사이트 반영 상태 포함)
            applied = getattr(self, "_entry_applied_insights", [])
            journal_entry = self._trade_journal.record_trade(
                trade, insight, applied
            )
            self._entry_applied_insights = []  # 초기화

            # 인사이트 흡수 처리
            actions = self._unified_engine.get_unified_actions()
            absorption = []
            if actions.blocked_strategy_regimes:
                absorption.append(f"차단:{actions.blocked_strategy_regimes}")
            if actions.tier_position_scale:
                absorption.append(f"축소:{actions.tier_position_scale}")
            if absorption:
                self._trade_journal.mark_absorbed(
                    journal_entry.journal_id,
                    " | ".join(absorption)
                )

            # 실행 가능한 인사이트가 있으면 출력
            actionable = self._insight_engine.get_actionable_insights()
            if actionable:
                print(f"  📊 학습 인사이트 (텍스트):")
                for a in actionable[:3]:
                    print(f"     {a}")

            # ★ 통합엔진에 Lesson Learned 학습 요청
            self._unified_engine.learn_from_trade(
                asdict(journal_entry) if hasattr(journal_entry, '__dataclass_fields__') else {}
            )

            # 저널 상태 출력
            summary = self._trade_journal.get_summary()
            lessons = self._unified_engine.get_lessons()
            print(f"  📓 저널: {summary['total']}건 "
                  f"(흡수율 {summary.get('absorption_rate', 0)}%, "
                  f"인사이트효과 {summary.get('insight_impact', 0):+.1f}%p)")
            if lessons:
                print(f"  🧠 교훈: {len(lessons)}개 활성")
                for l in lessons[:3]:
                    print(f"     • {l.get('lesson_type','')}: {l.get('description','')[:60]}")

            self._log_active_insight_actions(actions)

            # ★ 거래 종료 직후 SL/TP 즉시 재계산 (6시간 대기 제거)
            if len(self._trades) >= 5:
                adapted = self._adapt_sl_tp_by_recent_performance()
                if adapted > 0:
                    print(f"  🔧 즉시 학습: SL/TP {adapted}건 조정 반영")
        except Exception as e:
            print(f"  [인사이트] 분석 오류: {e}")
            import traceback
            traceback.print_exc()

    def _log_active_insight_actions(self, actions) -> None:
        """현재 활성화된 인사이트 액션을 로그에 출력."""
        parts = []
        if actions.blocked_strategy_regimes:
            parts.append(f"차단 조합: {actions.blocked_strategy_regimes}")
        if actions.tier_position_scale:
            parts.append(f"티어 축소: {actions.tier_position_scale}")
        if actions.should_widen_sl:
            parts.append(f"SL 확대: +{actions.sl_widen_pct}%")
        if actions.blocked_hours:
            parts.append(f"차단 시간: {sorted(actions.blocked_hours)}")
        if actions.consecutive_losses >= 3:
            parts.append(f"연속 {actions.consecutive_losses}패")
        if parts:
            print(f"  🔧 활성 인사이트 액션:")
            for p in parts:
                print(f"     → {p}")
        if actions.strategy_scores:
            top = sorted(actions.strategy_scores.items(),
                        key=lambda x: x[1], reverse=True)[:3]
            scores_str = ", ".join(f"{s}:{v:.0f}%" for s, v in top)
            print(f"     → 워터폴 우선순위: {scores_str}")

    def _check_exit(self, price: float, df: pd.DataFrame) -> None:
        """유연한 청산 시스템 — 5개 독립 조건이 동시 평가."""
        if self._position is None:
            return

        pos = self._position
        entry = pos.entry_price
        if entry <= 0:
            return
        current_pnl_pct = (price - entry) / entry * 100
        hold_min = self._get_hold_minutes()

        # 디버그: 청산 조건 체크 로그 (항상 출력)
        if self._verbose and self._cycle_count % 10 == 0:
            print(f"  [EXIT] PnL={current_pnl_pct:+.2f}% SL={pos.sl_pct:.1f}% TP={pos.tp_pct:.1f}% hold={hold_min}m")

        # ① 기본 SL (최후 방어선 — 항상 작동)
        if pos.sl_pct > 0 and current_pnl_pct <= -pos.sl_pct:
            self._execute_sell(price, "SL")
            return

        # ② 기본 TP (목표가 도달)
        if pos.tp_pct > 0 and current_pnl_pct >= pos.tp_pct:
            self._execute_sell(price, "TP")
            return

        # ③ 트레일링 스탑 (수익 보호)
        self._check_trailing_stop(price, current_pnl_pct)
        if self._position is None:
            return

        # ④ 시간 기반 유연 청산 (보유 시간에 따라 TP 하향)
        self._check_time_based_exit(price, current_pnl_pct, hold_min)
        if self._position is None:
            return

        # ⑤ 지표 기반 청산 (RSI 과매수, HA 약세, 변동성 급등)
        self._check_indicator_exit(price, df, current_pnl_pct, hold_min)

    def _get_hold_minutes(self) -> int:
        """현재 포지션 보유 시간(분)."""
        if self._position is None:
            return 0
        _et = self._position.entry_time
        if isinstance(_et, str):
            _et = datetime.strptime(_et, "%Y-%m-%d %H:%M")
        return int((datetime.now() - _et).total_seconds() / 60)

    def _check_time_based_exit(
        self, price: float, pnl_pct: float, hold_min: int
    ) -> None:
        """시간 기반 유연 청산 — 보유 시간이 길수록 TP를 낮춰 수익 확정."""
        if self._position is None:
            return

        # 보유 시간별 최소 수익으로 청산 (거래 회전율 향상)
        time_tp_rules = [
            (120, 0.05),  # 2시간 이상 → 수익이면 거의 무조건 청산
            (60, 0.15),   # 1시간 이상 → +0.15% 이상이면 청산
            (30, 0.3),    # 30분 이상 → +0.3% 이상이면 청산
            (15, 0.5),    # 15분 이상 → +0.5% 이상이면 청산
        ]

        for min_hold, min_tp in time_tp_rules:
            if hold_min >= min_hold and pnl_pct >= min_tp:
                if self._verbose:
                    print(f"  ⏰ 시간 청산: {hold_min}분 보유 + "
                          f"PnL {pnl_pct:+.2f}% ≥ {min_tp}% → 확정")
                self._execute_sell(price, "TIME_TP")
                return

        # ★ 30분 초과 + 손실: 즉시 청산 (승리 22분 vs 패배 31분 데이터)
        max_hold = config.MAX_HOLD_MINUTES
        if hold_min >= max_hold and pnl_pct < 0:
            if self._verbose:
                print(f"  ⏰ {max_hold}분 초과 손절: {hold_min}분 + "
                      f"PnL {pnl_pct:+.2f}% → 즉시 청산")
            self._execute_sell(price, "TIME_SL")
            return

        # 장기 보유 손절: 2시간 이상 보유 + 손실 중 → 기회비용 방지
        if hold_min >= 120 and pnl_pct < 0:
            if self._verbose:
                print(f"  ⏰ 장기 보유 손절: {hold_min}분 + "
                      f"PnL {pnl_pct:+.2f}% → 기회비용 방지")
            self._execute_sell(price, "TIME_SL")

    def _check_indicator_exit(
        self, price: float, df: pd.DataFrame,
        pnl_pct: float, hold_min: int
    ) -> None:
        """지표 기반 청산 — RSI/HA/변동성으로 청산 판단."""
        if self._position is None or len(df) < 14:
            return

        import ta as ta_lib
        c = df["close"].astype(float)
        rsi = ta_lib.momentum.RSIIndicator(c, window=14).rsi()
        if rsi is None or len(rsi) < 2:
            return
        current_rsi = float(rsi.iloc[-1])

        # RSI 과매수 + 수익 중 → 최적 청산 타이밍
        if current_rsi >= 70 and pnl_pct > 0.1:
            if self._verbose:
                print(f"  📊 RSI 과매수 청산: RSI={current_rsi:.0f} + "
                      f"PnL {pnl_pct:+.2f}% → 고점 청산")
            self._execute_sell(price, "RSI_OVERBOUGHT")
            return

        # RSI 급락 (직전 대비 15 이상 하락) + 수익 중 → 모멘텀 이탈
        prev_rsi = float(rsi.iloc[-2])
        if prev_rsi - current_rsi > 15 and pnl_pct > 0:
            if self._verbose:
                print(f"  📊 RSI 급락 청산: {prev_rsi:.0f}→{current_rsi:.0f} + "
                      f"PnL {pnl_pct:+.2f}% → 모멘텀 이탈")
            self._execute_sell(price, "RSI_DROP")
            return

        # 변동성 급등 (ATR이 평균의 2배) + 손실 중 → 리스크 회피
        atr = ta_lib.volatility.AverageTrueRange(
            df["high"].astype(float), df["low"].astype(float), c, window=14
        ).average_true_range()
        if atr is not None and len(atr) > 20:
            current_atr = float(atr.iloc[-1])
            avg_atr = float(atr.iloc[-20:].mean())
            if avg_atr > 0 and current_atr > avg_atr * 2.0 and pnl_pct < -0.3:
                if self._verbose:
                    print(f"  📊 변동성 급등 청산: ATR {current_atr/avg_atr:.1f}x + "
                          f"PnL {pnl_pct:+.2f}% → 리스크 회피")
                self._execute_sell(price, "VOL_SPIKE")
                return

        # HA_WEAK 청산 (S3 전용)
        if self._position and self._position.strategy == "S3_HA" and len(df) >= 2:
            self._check_ha_weak_exit(price, df, pnl_pct)

    def _check_trailing_stop(
        self, price: float, current_pnl_pct: float
    ) -> None:
        """★ 급등락 코인 트레일링 스탑 — 티어별 최적 파라미터 적용."""
        if self._position is None:
            return

        pos = self._position

        # 티어별 최적 파라미터 선택 (6개월 그리드서치)
        if pos.volatility_tier == "EXTREME":
            activate_pct = config.VOLATILE_EXTREME_ACTIVATE_PCT
            trail_pct = config.VOLATILE_EXTREME_TRAIL_PCT
        elif pos.volatility_tier == "HOT":
            activate_pct = config.VOLATILE_HOT_ACTIVATE_PCT
            trail_pct = config.VOLATILE_HOT_TRAIL_PCT
        else:
            activate_pct = config.VOLATILE_NORMAL_ACTIVATE_PCT
            trail_pct = config.VOLATILE_NORMAL_TRAIL_PCT

        # 최고가 갱신
        if price > pos.trailing_high:
            pos.trailing_high = price

        # 트레일링 활성화 조건: 최소 이익 이상일 때만
        if current_pnl_pct < activate_pct:
            return

        # 최고가 대비 하락폭 계산
        drop_from_high = (pos.trailing_high - price) / pos.trailing_high * 100

        if drop_from_high >= trail_pct:
            trail_pnl = (price - pos.entry_price) / pos.entry_price * 100
            if self._verbose:
                print(f"  🔥 트레일링 스탑 발동: 최고가 {pos.trailing_high:,.0f} "
                      f"→ 현재 {price:,.0f} ({drop_from_high:.1f}% 하락) "
                      f"| PnL {trail_pnl:+.2f}%")
            self._execute_sell(price, "TRAILING")

    def _check_ha_weak_exit(
        self, price: float, df: pd.DataFrame, pnl_pct: float
    ) -> None:
        """하이킨아시 약세 전환 시 청산 (최소 이익 조건 포함)."""
        if self._position is None:
            return

        # ha_weak_min_pct 미만이면 청산 안 함
        if pnl_pct < self._position.ha_weak_min_pct:
            return

        c = df["close"].astype(float)
        o = df["open"].astype(float)
        h = df["high"].astype(float)
        lo = df["low"].astype(float)
        n = len(df)

        # 하이킨아시 계산 (최근 2봉만 필요)
        ha_close = (o + h + lo + c) / 4
        ha_open = pd.Series(np.zeros(n), index=df.index)
        ha_open.iloc[0] = (o.iloc[0] + c.iloc[0]) / 2
        for j in range(1, n):
            ha_open.iloc[j] = (ha_open.iloc[j - 1] + ha_close.iloc[j - 1]) / 2

        i = n - 1
        # 하이킨아시 음봉 (약세 전환)
        if ha_close.iloc[i] < ha_open.iloc[i]:
            self._execute_sell(price, "HA_WEAK")

    def fast_check_volatile_position(self) -> None:
        """★ 급등락 코인 실시간 모니터링 — 포지션 보유 중 빠른 가격 체크.

        포트폴리오 매니저가 HOT/EXTREME 포지션에 대해 10초마다 호출한다.
        전체 OHLCV를 다시 받지 않고, 현재가만 조회 → 트레일링/SL/TP 체크.
        """
        with self._position_lock:
            if self._position is None:
                return
            if self._position.volatility_tier == "NORMAL":
                return

            price = self._client.get_current_price(self._coin)
            if price is None:
                return

            pos = self._position
            entry = pos.entry_price
            current_pnl_pct = (price - entry) / entry * 100

            # SL 체크
            if pos.sl_pct > 0 and current_pnl_pct <= -pos.sl_pct:
                if self._verbose:
                    print(f"  🔥 [{self._coin}] 실시간 SL 발동: {current_pnl_pct:+.2f}%")
                self._execute_sell(price, "SL_FAST")
                return

            # TP 체크
            if pos.tp_pct > 0 and current_pnl_pct >= pos.tp_pct:
                if self._verbose:
                    print(f"  🔥 [{self._coin}] 실시간 TP 발동: {current_pnl_pct:+.2f}%")
                self._execute_sell(price, "TP_FAST")
                return

            # 트레일링 스탑 체크
            self._check_trailing_stop(price, current_pnl_pct)

    # ── 통계 모듈 헬퍼 ────────────────────────────────────────

    def _calc_kelly_position(self) -> float:
        """Kelly Criterion 기반 최적 투입 금액을 계산한다."""
        pnl_list = [t.pnl_pct for t in self._trades]
        if len(pnl_list) < config.KELLY_MIN_TRADES:
            return self._balance_krw  # 데이터 부족 시 전액

        return optimal_position_krw(
            total_capital=self._balance_krw,
            pnl_pcts=pnl_list,
            mode=config.KELLY_MODE,
            min_pct=config.KELLY_MIN_PCT,
            max_pct=config.KELLY_MAX_PCT,
        )

    def _adjust_sl_tp_by_garch(
        self, base_sl: float, base_tp: float
    ) -> tuple:
        """GARCH 변동성 예측에 따라 SL/TP를 동적 조정한다."""
        if not config.GARCH_ENABLED or self._garch_forecast is None:
            return base_sl, base_tp

        sl = base_sl * self._garch_forecast.suggested_sl_mult
        tp = base_tp * self._garch_forecast.suggested_tp_mult
        return round(sl, 2), round(tp, 2)

    def _update_stats_models(self, df: pd.DataFrame) -> None:
        """GARCH 변동성 예측 + HMM 레짐 갱신."""
        # GARCH: 매 사이클 갱신 (가벼움)
        if config.GARCH_ENABLED:
            try:
                self._garch_forecast = forecast_volatility(
                    df, method=config.GARCH_METHOD,
                    lookback=config.GARCH_LOOKBACK,
                )
            except Exception:
                pass

        # HMM: 주기적 갱신 (무거움)
        if config.HMM_ENABLED:
            should_refit = (
                self._last_hmm_fit is None
                or (datetime.now() - self._last_hmm_fit).total_seconds()
                > config.HMM_REFIT_INTERVAL * 3600
            )
            if should_refit:
                try:
                    self._hmm_result = detect_hmm_regime(
                        df, lookback=config.HMM_LOOKBACK
                    )
                    self._last_hmm_fit = datetime.now()
                except Exception:
                    pass

    # ── 유틸리티 ──────────────────────────────────────────────

    def _fetch_ohlcv(self, count: int) -> Optional[pd.DataFrame]:
        """빗썸에서 OHLCV 데이터를 가져온다."""
        try:
            df = self._client.get_ohlcv(
                self._coin, interval=self._candle_interval, count=count
            )
            if df is None or len(df) < 60:
                return None
            # 날짜 인덱스 → datetime 컬럼 (backtest_scalp 호환)
            df = df.reset_index()
            if "time" in df.columns:
                df.rename(columns={"time": "datetime"}, inplace=True)
            elif "index" in df.columns:
                df.rename(columns={"index": "datetime"}, inplace=True)
            df = df.reset_index(drop=True)
            return df
        except Exception as e:
            if self._verbose:
                print(f"  OHLCV 수집 실패: {e}", file=sys.stderr)
            return None

    def _is_matching_strategy(self, ctx: ScalpSignalContext) -> bool:
        """신호의 전략이 현재 활성 전략과 일치하는지 확인."""
        # 전략 ID → sub_strategy 매핑
        strategy_map = {
            "S1": "S1_RSI",
            "S2": "S2_Volume",
            "S3": "S3_HA",
            "S4": "S4_VWAP",
            "S5": "S5_Bear",
            "S6": "S6_SMMA",
            "S7": "S7_SMC",
        }
        expected = strategy_map.get(self._active_strategy_id, "")
        return ctx.sub_strategy == expected

    def _print_cycle_status(
        self, now: str, price: float, ctx: ScalpSignalContext
    ) -> None:
        """사이클 상태 출력."""
        if ctx.signal == "BUY":
            return  # BUY는 _execute_buy에서 출력
        regime = ctx.regime
        reason = ctx.reason
        if len(reason) > 40:
            reason = reason[:40] + "…"
        print(f"[{now}] HOLD  | {price:,.0f} | "
              f"{self._active_strategy_name} | {regime} | {reason}")

    def _print_header(self) -> None:
        """시작 헤더 출력."""
        fee_total = PAPER_FEE_PCT * 2 + PAPER_SLIPPAGE_PCT * 2
        print(f"\n{'='*64}")
        print(f"  적응형 페이퍼 트레이딩 시스템")
        print(f"  코인: {self._coin} | "
              f"자본: {self._initial_capital:,.0f}원 | "
              f"비용: {fee_total:.2f}%/왕복")
        print(f"  사이클: {self._interval_min}초 | "
              f"보고: {self._report_min}분")
        print(f"{'='*64}\n")

    # ── 보고서 ────────────────────────────────────────────────

    def _safe_hourly_report(self) -> None:
        """hourly_report 예외 안전 래퍼."""
        try:
            self.hourly_report()
        except Exception as e:
            print(f"  보고서 오류: {e}", file=sys.stderr)

    def hourly_report(self) -> None:
        """정기 상태 보고서."""
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        total_value = self._balance_krw
        if self._position:
            price = self._client.get_current_price(self._coin)
            if price:
                pos_value = self._position.quantity * price
                total_value += pos_value

        pnl_total = total_value - self._initial_capital
        pnl_pct = pnl_total / self._initial_capital * 100

        # 거래 통계
        wins = sum(1 for t in self._trades if t.pnl_pct > 0)
        total = len(self._trades)
        wr = wins / total * 100 if total > 0 else 0

        regime = self._monitor.current_regime
        triggers_total = len(self._monitor.trigger_history)

        print(f"\n{'─'*64}")
        print(f"  [{now}] 상태 보고")
        print(f"{'─'*64}")
        print(f"  잔고:      {total_value:>15,.0f}원 ({pnl_pct:+.2f}%)")
        print(f"  시작자본:  {self._initial_capital:>15,.0f}원")
        print(f"  손익:      {pnl_total:>+15,.0f}원")
        print(f"  거래:      {total:>4}건 (승률: {wr:.0f}%)")
        print(f"  전략:      {self._active_strategy_name}")
        print(f"  레짐:      {regime}")
        print(f"  트리거:    {triggers_total}건 누적")
        if self._position:
            print(f"  포지션:    {self._position.strategy} "
                  f"(진입: {self._position.entry_price:,.0f})")
        else:
            print(f"  포지션:    없음")

        # 최근 거래 요약
        if self._trades:
            last_5 = self._trades[-5:]
            print(f"\n  최근 거래:")
            for t in last_5:
                print(f"    {t.exit_time} | {t.strategy} | "
                      f"{t.exit_reason} | {t.pnl_krw:+,.0f}원 "
                      f"({t.pnl_pct:+.2f}%)")

        # 통계 모듈 요약
        self._print_stats_summary()
        print(f"{'─'*64}\n")

    def _print_stats_summary(self) -> None:
        """통계 모듈 현황 요약 출력."""
        parts = []

        # Kelly
        pnl_list = [t.pnl_pct for t in self._trades]
        kelly = kelly_from_trades(pnl_list)
        if kelly:
            parts.append(
                f"Kelly: {kelly.half_kelly*100:.0f}% "
                f"(edge:{kelly.edge:+.2f})"
            )

        # GARCH
        if self._garch_forecast:
            g = self._garch_forecast
            parts.append(
                f"Vol: {g.vol_regime} "
                f"({g.current_vol_pct:.2f}%)"
            )

        # HMM
        if self._hmm_result:
            h = self._hmm_result
            parts.append(
                f"HMM: {h.regime_label} "
                f"({h.regime_duration}봉, "
                f"전환위험:{h.transition_risk:.0%})"
            )

        # Bayesian
        bayes = self._bayesian.summary()
        if bayes:
            best_sid = self._bayesian.best_strategy()
            if best_sid and best_sid in bayes:
                b = bayes[best_sid]
                parts.append(
                    f"Bayes최강: {best_sid} "
                    f"WR:{b['mean_wr']:.0f}% "
                    f"[{b['ci_lo']:.0f}-{b['ci_hi']:.0f}]"
                )

        if parts:
            print(f"\n  통계:")
            for p in parts:
                print(f"    {p}")

    # ── 학습 엔진 (적응 사이클) ──────────────────────────────

    def run_adaptation_cycle(self) -> int:
        """페이퍼 거래 학습 사이클을 실행한다.

        TradeAnalyzer로 거래를 분석하고, 3가지 핵심 적응을 수행:
          1. TIME_FILTER: 승률 낮은 시간대 차단
          2. TREND_FILTER: 하락추세 매수 차단
          3. POSITION_SIZE: 연속 손실 시 포지션 축소

        Returns:
            적용된 적응 수
        """
        trades = self._trade_adapter.get_completed_trades()
        min_trades = config.ADAPTIVE_MIN_TRADES

        if len(trades) < min_trades:
            if self._verbose:
                print(f"  [학습] 거래 {len(trades)}건 < 최소 {min_trades}건 — 스킵")
            return 0

        from analyzer.analyzer import TradeAnalyzer
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()

        adapted = 0

        # 1. TIME_FILTER: 시간대별 승률 분석 → 저성과 시간대 차단
        #    (TradeAnalyzer + InsightEngine 양쪽 데이터 통합)
        new_blocked = set()
        min_hour_trades = getattr(config, "ADAPTIVE_BAD_HOUR_MIN_TRADES", 8)
        for hour, stats in report.by_hour.items():
            hr_total = stats.get("total", 0)
            hr_wr = stats.get("win_rate", 100)
            if hr_total >= min_hour_trades and hr_wr < config.ADAPTIVE_BAD_HOUR_WIN_RATE:
                new_blocked.add(hour)
        # ★ 인사이트 엔진의 시간대 차단도 통합
        actions = self._unified_engine.get_unified_actions()
        new_blocked = new_blocked | actions.blocked_hours
        if new_blocked != self._blocked_hours:
            self._blocked_hours = new_blocked
            adapted += 1
            if self._verbose and new_blocked:
                print(f"  [학습] 시간대 차단: {sorted(new_blocked)}")

        # 2. TREND_FILTER: 하락추세 진입 → 축소 (차단 대신)
        trend_stats = report.by_trend.get("DOWNTREND", {})
        dt_total = trend_stats.get("total", 0)
        dt_wr = trend_stats.get("win_rate", 100)
        dt_scale = getattr(config, "ADAPTIVE_DOWNTREND_SCALE", 0.5)
        new_block_dt = (
            dt_total >= 5
            and dt_wr < config.ADAPTIVE_DOWNTREND_WIN_RATE
        )
        if new_block_dt != self._block_downtrend_buy:
            self._block_downtrend_buy = new_block_dt
            adapted += 1
            if self._verbose:
                action = f"축소 {dt_scale}x" if new_block_dt else "해제"
                print(f"  [학습] 하락추세 {action} "
                      f"(WR: {dt_wr:.0f}%, {dt_total}건)")

        # 3. POSITION_SIZE: 연속 손실/고변동 시 축소
        #    (TradeAnalyzer + InsightEngine 중 더 큰 값 사용)
        consec_loss = max(
            report.max_consecutive_losses, actions.consecutive_losses
        )
        new_mult = 1.0
        if consec_loss >= config.ADAPTIVE_CONSEC_LOSS_THRESHOLD:
            new_mult = max(config.ADAPTIVE_POSITION_MIN_MULT, 0.5)
        elif report.win_rate >= 55:
            new_mult = min(config.ADAPTIVE_POSITION_MAX_MULT, 1.2)

        if abs(new_mult - self._position_multiplier) > 0.01:
            self._position_multiplier = new_mult
            adapted += 1
            if self._verbose:
                print(f"  [학습] 포지션 배율: {new_mult:.2f}x "
                      f"(연속손실: {consec_loss}, WR: {report.win_rate:.0f}%)")

        # 4. EXIT_STRATEGY: SL/TP 적응 (매 사이클 재평가 — 원샷 잠금 제거)
        if len(trades) >= 10:  # ★ 20→10건으로 빠른 학습
            exit_stats = report.exit_pattern
            sl_ratio = exit_stats.get("SL", {}).get("ratio", 0)
            tp_ratio = exit_stats.get("TP", {}).get("ratio", 0)

            # SL 비율이 40% 넘으면 SL을 넓힘 (매 사이클 재평가)
            if sl_ratio > 0.4:
                current_sl = self._adapted_sl_pct or config.STOP_LOSS_PCT
                new_sl = min(current_sl + 0.5, config.ADAPTIVE_SL_MAX)
                if self._adapted_sl_pct is None or abs(new_sl - self._adapted_sl_pct) > 0.01:
                    self._adapted_sl_pct = new_sl
                    adapted += 1
                    if self._verbose:
                        print(f"  [학습] 손절 조정: {config.STOP_LOSS_PCT}% → {new_sl}%")
            elif sl_ratio < 0.2 and self._adapted_sl_pct is not None:
                # SL 비율이 낮으면 기본값으로 복원
                self._adapted_sl_pct = None
                adapted += 1
                if self._verbose:
                    print(f"  [학습] 손절 기본값 복원: {config.STOP_LOSS_PCT}%")

            # TP 비율이 15% 미만이면 TP를 좁힘 (매 사이클 재평가)
            if tp_ratio < 0.15:
                current_tp = self._adapted_tp_pct or config.TAKE_PROFIT_PCT
                new_tp = max(current_tp - 0.5, config.ADAPTIVE_TP_MIN)
                if self._adapted_tp_pct is None or abs(new_tp - self._adapted_tp_pct) > 0.01:
                    self._adapted_tp_pct = new_tp
                    adapted += 1
                    if self._verbose:
                        print(f"  [학습] 익절 조정: {config.TAKE_PROFIT_PCT}% → {new_tp}%")
            elif tp_ratio > 0.3 and self._adapted_tp_pct is not None:
                # TP 달성률이 좋으면 기본값 복원
                self._adapted_tp_pct = None
                adapted += 1
                if self._verbose:
                    print(f"  [학습] 익절 기본값 복원: {config.TAKE_PROFIT_PCT}%")

        self._last_adaptation = datetime.now()
        self._adaptation_count += adapted

        if adapted > 0 and self._verbose:
            print(f"  [학습] 사이클 완료: {adapted}건 적응 적용 "
                  f"(총 {self._adaptation_count}건)")

            # ★ 학습 상태 영속화 (재시작해도 유지)
            self._save_learning_state()

        return adapted

    def _save_learning_state(self) -> None:
        """학습된 필터/적응 상태를 파일로 저장한다."""
        import json, os
        state_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__) or "."),
            ".claude", "memory"
        )
        os.makedirs(state_dir, exist_ok=True)
        state_file = os.path.join(state_dir, f"adaptive_state_{self._coin}.json")
        state = {
            "coin": self._coin,
            "saved_at": datetime.now().isoformat(timespec="seconds"),
            "blocked_hours": sorted(self._blocked_hours),
            "block_downtrend_buy": self._block_downtrend_buy,
            "position_multiplier": self._position_multiplier,
            "adapted_sl_pct": self._adapted_sl_pct,
            "adapted_tp_pct": self._adapted_tp_pct,
            "adaptation_count": self._adaptation_count,
        }
        try:
            import tempfile
            state_dir = os.path.dirname(state_file)
            fd, tmp = tempfile.mkstemp(dir=state_dir, suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
            os.replace(tmp, state_file)
        except Exception as e:
            print(f"  [학습] 상태 저장 실패: {e}")

    def _load_learning_state(self) -> None:
        """저장된 학습 상태를 복원한다."""
        import json, os
        state_file = os.path.join(
            os.path.dirname(os.path.dirname(__file__) or "."),
            ".claude", "memory", f"adaptive_state_{self._coin}.json"
        )
        if not os.path.exists(state_file):
            return
        try:
            with open(state_file, encoding="utf-8") as f:
                state = json.load(f)
            self._blocked_hours = set(state.get("blocked_hours", []))
            self._block_downtrend_buy = state.get("block_downtrend_buy", False)
            self._position_multiplier = state.get("position_multiplier", 1.0)
            self._adapted_sl_pct = state.get("adapted_sl_pct")
            self._adapted_tp_pct = state.get("adapted_tp_pct")
            self._adaptation_count = state.get("adaptation_count", 0)
            if self._verbose:
                print(f"  [학습] {self._coin} 상태 복원: "
                      f"차단시간={sorted(self._blocked_hours)} "
                      f"배율={self._position_multiplier:.2f}x "
                      f"SL={self._adapted_sl_pct} TP={self._adapted_tp_pct}")
        except Exception as e:
            print(f"  [학습] {self._coin} 복원 실패: {e}")

    def _check_fake_signal_filter(self, df, price) -> bool:
        """★ 교훈: FAKE_SIGNAL 방지 — 최근 모멘텀이 약세면 차단.

        최근 3봉 연속 하락 + 현재가가 직전 저가 근처면 가짜 신호로 판단.
        """
        try:
            if df is None or len(df) < 5:
                return False
            c = df["close"].astype(float)
            # 최근 3봉 연속 하락 확인
            declining = all(
                float(c.iloc[-(i+1)]) < float(c.iloc[-(i+2)])
                for i in range(3)
            )
            if not declining:
                return False
            # 현재가가 최근 5봉 최저가의 0.5% 이내면 바닥 진입 허용
            recent_low = float(df["low"].astype(float).iloc[-5:].min())
            if price <= recent_low * 1.005:
                return False  # 바닥 바운스는 허용
            return True  # 하락 중 + 바닥 아님 → 가짜 신호
        except Exception:
            return False

    def _check_learned_filters(
        self, regimes=None, ctx=None
    ) -> tuple:
        """학습된 필터로 매수를 차단할지 확인한다.

        인사이트 엔진의 모든 학습을 실제 거래 차단/축소에 반영:
          1. 시간대 차단 (기존 + 인사이트 통합)
          2. 전략×레짐 차단 (인사이트 학습)
          3. 연속 손실 쿨다운 (인사이트 학습)
          4. 하락추세 포지션 축소 (기존)

        Returns:
            (차단 여부, 사유)
        """
        if not config.ADAPTIVE_ENABLED:
            return False, ""

        actions = self._unified_engine.get_unified_actions()

        # 1. 시간대 필터 (기존 _blocked_hours + 인사이트 학습 통합)
        current_hour = datetime.now().hour
        merged_blocked_hours = (
            self._blocked_hours | actions.blocked_hours
            | getattr(config, "MANUAL_BLOCKED_HOURS", set())
        )
        if current_hour in merged_blocked_hours:
            return True, f"시간대 필터: {current_hour}시 저성과"

        # 2. ★ 전략×레짐 차단 (인사이트 학습)
        blocked = self._check_strategy_regime_block(ctx, regimes, actions)
        if blocked:
            return blocked

        # 3. ★ 연속 손실 쿨다운 (인사이트 학습)
        cooldown = config.INSIGHT_CONSEC_LOSS_COOLDOWN
        if actions.consecutive_losses >= cooldown:
            return True, (f"연속 {actions.consecutive_losses}패 쿨다운 "
                         f"(임계치: {cooldown})")

        # 4. 하락추세 필터 → 차단 대신 축소 (수익 기회 유지)
        if self._block_downtrend_buy and regimes is not None and len(regimes) > 0:
            current_regime = str(regimes[-1])
            if "BEAR" in current_regime or "DOWN" in current_regime:
                dt_scale = getattr(config, "ADAPTIVE_DOWNTREND_SCALE", 0.5)
                self._position_multiplier = min(
                    self._position_multiplier, dt_scale
                )

        return False, ""

    def _check_strategy_regime_block(self, ctx, regimes, actions) -> tuple:
        """전략×레짐 조합이 인사이트에 의해 차단 대상인지 확인."""
        if ctx is None or regimes is None or len(regimes) == 0:
            return None
        strategy_name = getattr(ctx, "sub_strategy", "")
        current_regime = str(regimes[-1])
        # 레짐 문자열 정규화
        regime_map = {"TRENDING_UP": "BULL", "TRENDING_DOWN": "BEAR"}
        regime_key = regime_map.get(current_regime, current_regime)
        combo_key = f"{strategy_name}:{regime_key}"
        if combo_key in actions.blocked_strategy_regimes:
            return True, (f"전략×레짐 차단: {combo_key} "
                         f"(승률 < {config.INSIGHT_STRATEGY_REGIME_BLOCK_WR}%)")
        return None

    def _apply_tier_scaling(self, invest_krw: int) -> int:
        """인사이트 학습에서 변동성 티어 승률이 낮으면 포지션 축소."""
        actions = self._unified_engine.get_unified_actions()
        tier_scale = actions.tier_position_scale.get(self._volatility_tier)
        if tier_scale is not None and tier_scale < 1.0:
            invest_krw = int(invest_krw * tier_scale)
            invest_krw = max(invest_krw, 10_000)
            if self._verbose:
                print(f"  📊 인사이트 티어 축소: {self._volatility_tier} "
                      f"→ {tier_scale:.0%} 포지션")
        return invest_krw

    def get_adapted_sl_pct(self) -> float:
        """학습된 손절 비율 (없으면 config 기본값)."""
        if self._adapted_sl_pct is not None:
            return self._adapted_sl_pct
        return config.STOP_LOSS_PCT

    def get_adapted_tp_pct(self) -> float:
        """학습된 익절 비율 (없으면 config 기본값)."""
        if self._adapted_tp_pct is not None:
            return self._adapted_tp_pct
        return config.TAKE_PROFIT_PCT

    def learning_status(self) -> dict:
        """학습 상태 요약 (인사이트 액션 포함)."""
        actions = self._unified_engine.get_unified_actions()
        return {
            "trade_count": self._trade_adapter.trade_count,
            "blocked_hours": sorted(self._blocked_hours | actions.blocked_hours),
            "block_downtrend": self._block_downtrend_buy,
            "position_multiplier": self._position_multiplier,
            "adapted_sl_pct": self._adapted_sl_pct,
            "adapted_tp_pct": self._adapted_tp_pct,
            "adaptation_count": self._adaptation_count,
            "last_adaptation": (
                self._last_adaptation.strftime("%H:%M")
                if self._last_adaptation else "없음"
            ),
            # ★ 인사이트 기반 액션 (학습→행동 피드백)
            "insight_blocked_combos": sorted(actions.blocked_strategy_regimes),
            "insight_tier_scales": actions.tier_position_scale,
            "insight_sl_widen": actions.should_widen_sl,
            "insight_strategy_scores": actions.strategy_scores,
            "insight_consec_losses": actions.consecutive_losses,
        }

    def _print_final_summary(self) -> None:
        """종료 시 최종 요약."""
        total_value = self._balance_krw
        pnl_total = total_value - self._initial_capital
        pnl_pct = pnl_total / self._initial_capital * 100

        wins = sum(1 for t in self._trades if t.pnl_pct > 0)
        losses = sum(1 for t in self._trades if t.pnl_pct <= 0)
        total = len(self._trades)
        wr = wins / total * 100 if total > 0 else 0

        total_gain = sum(t.pnl_krw for t in self._trades if t.pnl_krw > 0)
        total_loss = abs(sum(t.pnl_krw for t in self._trades if t.pnl_krw < 0))
        pf = total_gain / total_loss if total_loss > 0 else 999.0

        print(f"\n{'='*64}")
        print(f"  최종 결과")
        print(f"{'='*64}")
        print(f"  시작 자본:    {self._initial_capital:>15,.0f}원")
        print(f"  최종 잔고:    {total_value:>15,.0f}원")
        print(f"  총 손익:      {pnl_total:>+15,.0f}원 ({pnl_pct:+.2f}%)")
        print(f"  총 거래:      {total:>4}건 (승: {wins}, 패: {losses})")
        print(f"  승률:         {wr:>5.1f}%")
        print(f"  Profit Factor:{pf:>5.2f}")
        print(f"  사이클 수:    {self._cycle_count}회")
        print(f"{'='*64}\n")

        # 전략별 통계
        if self._trades:
            self._print_strategy_stats()

        # Monte Carlo + EVT 분석 (종료 시에만, 무거움)
        pnl_list = [t.pnl_pct for t in self._trades]
        if len(pnl_list) >= config.EVT_MIN_TRADES:
            self._print_advanced_stats(pnl_list)

    def _print_strategy_stats(self) -> None:
        """전략별 거래 통계."""
        stats = {}
        for t in self._trades:
            if t.strategy not in stats:
                stats[t.strategy] = {"count": 0, "wins": 0, "pnl": 0.0}
            stats[t.strategy]["count"] += 1
            if t.pnl_pct > 0:
                stats[t.strategy]["wins"] += 1
            stats[t.strategy]["pnl"] += t.pnl_krw

        print(f"\n  전략별 성과:")
        print(f"  {'전략':<15} {'거래':>4} {'승률':>6} {'손익':>12}")
        print(f"  {'-'*40}")
        for name, s in sorted(stats.items(), key=lambda x: x[1]["pnl"], reverse=True):
            wr = s["wins"] / s["count"] * 100 if s["count"] > 0 else 0
            print(f"  {name:<15} {s['count']:>4} {wr:>5.1f}% {s['pnl']:>+11,.0f}원")
        print()

    def _print_advanced_stats(self, pnl_list: list) -> None:
        """종료 시 Monte Carlo + EVT 고급 분석 출력."""
        # Monte Carlo
        mc = run_monte_carlo(
            pnl_list,
            n_simulations=config.MC_SIMULATIONS,
            ruin_threshold_pct=config.MC_RUIN_THRESHOLD_PCT,
        )
        if mc:
            from stats.monte_carlo import print_monte_carlo_report
            print_monte_carlo_report(mc)

        # EVT
        evt = analyze_tail_risk(pnl_list)
        if evt:
            from stats.evt_risk import print_evt_report
            print_evt_report(evt)

        # Kelly 최종
        kelly = kelly_from_trades(pnl_list)
        if kelly:
            print(f"\n  Kelly Criterion 최종:")
            print(f"    승률: {kelly.win_rate*100:.1f}% | "
                  f"손익비: {kelly.payoff_ratio:.2f}")
            print(f"    Full Kelly: {kelly.full_kelly*100:.1f}% | "
                  f"Half: {kelly.half_kelly*100:.1f}% | "
                  f"Quarter: {kelly.quarter_kelly*100:.1f}%")
            print(f"    기대값(Edge): {kelly.edge:+.3f}%/거래")


# ── 헬퍼 함수 ─────────────────────────────────────────────────

def _trade_to_backtest_trade(pt: PaperTrade) -> Trade:
    """PaperTrade → backtest_scalp.Trade 변환 (모니터용)."""
    return Trade(
        strategy=pt.strategy,
        entry_idx=0,
        entry_price=pt.entry_price,
        entry_time=pt.entry_time,
        sl=0.0,
        tp=0.0,
        exit_idx=0,
        exit_price=pt.exit_price,
        exit_time=pt.exit_time,
        exit_reason=pt.exit_reason,
        pnl_pct=pt.pnl_pct,
    )


# ── CLI ──────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    """CLI 인자 파싱."""
    parser = argparse.ArgumentParser(
        description="적응형 페이퍼 트레이딩 시스템 — 6전략 동적 전환"
    )
    parser.add_argument(
        "--coin", default="BTC", help="거래 코인 (기본: BTC)"
    )
    parser.add_argument(
        "--capital", type=float, default=PAPER_DEFAULT_CAPITAL,
        help=f"시작 자본 원화 (기본: {PAPER_DEFAULT_CAPITAL:,.0f})"
    )
    parser.add_argument(
        "--interval", type=int, default=PAPER_TRADING_INTERVAL_SEC,
        help=f"트레이딩 사이클 분 (기본: {PAPER_TRADING_INTERVAL_SEC})"
    )
    parser.add_argument(
        "--report", type=int, default=PAPER_REPORT_INTERVAL_MIN,
        help=f"보고서 주기 분 (기본: {PAPER_REPORT_INTERVAL_MIN})"
    )
    parser.add_argument(
        "--verbose", action="store_true", help="상세 로그 출력"
    )
    parser.add_argument(
        "--end-time", type=str, default=None,
        help="자동 종료 시각 (예: '2026-03-11 07:00')"
    )
    return parser.parse_args()


def main() -> None:
    """메인 진입점."""
    args = parse_args()

    end_time = None
    if args.end_time:
        try:
            end_time = datetime.strptime(args.end_time, "%Y-%m-%d %H:%M")
            print(f"자동 종료 예정: {end_time.strftime('%Y-%m-%d %H:%M')}")
        except ValueError:
            print(f"⚠️ --end-time 형식 오류: '{args.end_time}' (예: '2026-03-11 07:00')")
            sys.exit(1)

    trader = AdaptivePaperTrader(
        coin=args.coin,
        capital=args.capital,
        interval_min=args.interval,
        report_min=args.report,
        verbose=args.verbose,
        end_time=end_time,
    )

    if not trader.startup():
        print("시작 실패 — 종료합니다.")
        sys.exit(1)

    trader.run()


if __name__ == "__main__":
    main()

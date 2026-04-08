# 포트폴리오 매니저 — 멀티코인 TradingBot 인스턴스를 동적으로 관리한다.
"""
CoinScreener 스캔 결과를 기반으로 코인을 활성화/비활성화하고,
각 코인의 TradingBot이 독립적으로 트레이딩 사이클을 실행하도록 조율한다.

코인 라이프사이클:
  스크리너 → 후보 → 데이터 수집 → 그리드서치 → 게이트 검증
    → PASS → TradingBot 생성 → 활성 슬롯 등록
    → FAIL → 블랙리스트 (24시간)

비활성화 트리거:
  - LiveMonitor 승률 임계값 미달
  - 코인별 MDD 초과
  - 스크리너에서 탈락 (거래량/변동성 부족)
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set

import config
from backtest.backtest_engine import BacktestEngine
from backtest.data_fetcher import DataFetcher
from learning.adaptive_engine import AdaptiveEngine
from learning.learning_log import LearningLog
from logger.trade_logger import TradeLogger
from notifier.telegram_notifier import TelegramNotifier
from risk.risk_manager import RiskManager
from screener.coin_screener import CoinScreener, CoinScore
from strategy.rsi_strategy import RSIStrategy
from strategy.scalp_strategy import ScalpStrategy
from strategy.strategy_gate import StrategyGate

logger = logging.getLogger(__name__)


# ── LiveMonitor 임포트 (main.py에 정의) ───────────────────────────────────────
# 순환 임포트 방지를 위해 지연 임포트로 처리한다.
def _import_live_monitor():
    from bot.trading_bot import LiveMonitor
    return LiveMonitor


# ── 코인 슬롯 ────────────────────────────────────────────────────────────────

@dataclass
class CoinSlot:
    """활성 코인 하나의 런타임 상태를 보관한다."""
    coin: str
    bot: object              # TradingBot 인스턴스
    strategy: object         # RSIStrategy 또는 ScalpStrategy
    risk_manager: RiskManager
    live_monitor: object     # LiveMonitor 인스턴스
    adaptive_engine: Optional[AdaptiveEngine] = None
    activated_at: datetime = field(default_factory=datetime.now)
    draining: bool = False   # True이면 신규 진입 차단, 기존 포지션 청산 대기

    def is_idle(self) -> bool:
        """포지션 없이 드레인 모드인 경우 제거 가능."""
        return self.draining and self.bot._current_entry_id is None


# ── 블랙리스트 엔트리 ─────────────────────────────────────────────────────────

@dataclass
class BlacklistEntry:
    coin: str
    reason: str
    expires_at: datetime


# ── 포트폴리오 매니저 ─────────────────────────────────────────────────────────

class PortfolioManager:
    """
    멀티코인 트레이딩 오케스트레이터.

    공유 자원 (1개):
      - client, trade_logger, notifier

    코인별 자원 (N개):
      - strategy, risk_manager, live_monitor, adaptive_engine, TradingBot

    안전 장치:
      1. 포트폴리오 MDD — 전체 포트폴리오 25% 하락 시 신규 진입 차단
      2. 최대 포지션 수 — MAX_POSITIONS 하드 리밋
      3. 코인당 자본 배분 — 총 자본의 PER_COIN_ALLOCATION_PCT
      4. 기존 안전장치 유지 — 코인별 SL/TP, LiveMonitor, RiskManager MDD
    """

    def __init__(
        self,
        client,
        trade_logger: TradeLogger,
        notifier: Optional[TelegramNotifier] = None,
        screener: Optional[CoinScreener] = None,
        max_positions: int = 5,
        portfolio_mdd_pct: float = 25.0,
        per_coin_allocation_pct: float = 20.0,
        blacklist_ttl_hours: int = 24,
    ) -> None:
        self.client = client
        self.trade_logger = trade_logger
        self.notifier = notifier
        self.screener = screener or CoinScreener()

        self.max_positions = max_positions
        self.portfolio_mdd_pct = portfolio_mdd_pct
        self.per_coin_allocation_pct = per_coin_allocation_pct
        self.blacklist_ttl_hours = blacklist_ttl_hours

        # 활성 코인 슬롯 (symbol → CoinSlot)
        self._slots: Dict[str, CoinSlot] = {}
        # 블랙리스트 (symbol → BlacklistEntry)
        self._blacklist: Dict[str, BlacklistEntry] = {}
        # 포트폴리오 전체 자산 추적
        self._portfolio_equity: float = 1.0
        self._portfolio_peak: float = 1.0
        self._total_trades: int = 0

        logger.info(
            f"[PortfolioManager] 초기화 완료 | "
            f"max_positions={max_positions} "
            f"portfolio_mdd={portfolio_mdd_pct}% "
            f"per_coin={per_coin_allocation_pct}%"
        )

    # ── 스캔 & 업데이트 ──────────────────────────────────────────────────────

    def scan_and_update(self) -> List[str]:
        """
        스크리너 → 필터 → 활성화 시도. 매 30분 호출.

        Returns:
            새로 활성화된 코인 심볼 리스트
        """
        logger.info("[Portfolio] ═══ 스캔 시작 ═══")

        # 만료된 블랙리스트 정리
        self._clean_blacklist()

        # 포트폴리오 MDD 체크
        if self._is_portfolio_mdd_exceeded():
            logger.warning("[Portfolio] 포트폴리오 MDD 초과 — 신규 활성화 중단")
            return []

        # 슬롯 여유 확인
        active_count = len([s for s in self._slots.values() if not s.draining])
        available = self.max_positions - active_count
        if available <= 0:
            logger.info(f"[Portfolio] 슬롯 가득 참 ({active_count}/{self.max_positions})")
            return []

        # 스크리너 실행
        try:
            scores = self.screener.scan()
        except Exception as e:
            logger.error(f"[Portfolio] 스크리너 오류: {e}")
            return []

        if not scores:
            logger.info("[Portfolio] 스크리너 결과 없음")
            return []

        logger.info(f"[Portfolio] 스크리너 후보: {len(scores)}개")

        # 필터: 이미 활성 / 블랙리스트 / 드레이닝 제외
        candidates = [
            s for s in scores
            if s.symbol not in self._slots
            and s.symbol not in self._blacklist
        ]

        # 활성화 시도 (여유 슬롯 수만큼)
        activated = []
        for score in candidates[:available]:
            success = self._try_activate_coin(score)
            if success:
                activated.append(score.symbol)
                if len(activated) >= available:
                    break

        # 드레이닝 완료된 슬롯 정리
        self._clean_drained_slots()

        logger.info(
            f"[Portfolio] ═══ 스캔 완료 ═══ "
            f"활성={len(self._slots)} 신규={len(activated)} "
            f"블랙리스트={len(self._blacklist)}"
        )
        return activated

    # ── 코인 활성화 ──────────────────────────────────────────────────────────

    def _try_activate_coin(self, score: CoinScore) -> bool:
        """
        단일 코인 활성화 시도: 데이터 수집 → 그리드서치 → 게이트 검증 → 봇 생성.

        Returns:
            활성화 성공 여부
        """
        coin = score.symbol
        logger.info(f"[Portfolio] {coin} 활성화 시도 (변동폭={score.range_pct:.1f}%)")

        try:
            # 1. 과거 데이터 수집
            fetcher = DataFetcher(self.client)
            df = fetcher.fetch(coin, days=config.BACKTEST_DAYS, interval=config.RSI_CANDLE_INTERVAL)
            if df is None or df.empty:
                logger.warning(f"[Portfolio] {coin} 데이터 수집 실패 — 블랙리스트 등록")
                self._add_to_blacklist(coin, "데이터 수집 실패")
                return False

            # 2. 전략 선택 및 검증
            if config.SCALP_ENTRY_MODE == "meta":
                live_strategy = self._create_scalp_strategy()
                best_params = {"mode": "meta", "regime_filter": True}
                # ScalpStrategy는 자체 파라미터 사용 (config.py에 최적값 반영됨)
                logger.info(f"[Portfolio] {coin} ScalpStrategy(메타) 사용")
            else:
                # 기존 RSI 그리드서치 경로
                base_strategy = RSIStrategy(
                    config.RSI_PERIOD, config.RSI_OVERSOLD, config.RSI_OVERBOUGHT
                )
                engine = BacktestEngine(base_strategy)
                gs = engine.grid_search(df)
                best_params = gs.best_params
                best_result = gs.best_result
                best_result.best_params = best_params

                gate = StrategyGate(
                    min_win_rate=config.MIN_WIN_RATE,
                    min_trades=config.MIN_BACKTEST_TRADES,
                    max_mdd=config.MAX_DRAWDOWN_PCT,
                    min_profit_factor=config.MIN_PROFIT_FACTOR,
                )
                gate_result = gate.check(best_result)

                if not gate_result.passed:
                    logger.info(
                        f"[Portfolio] {coin} 게이트 미통과: "
                        f"{', '.join(gate_result.fail_reasons)} — 블랙리스트 등록"
                    )
                    self._add_to_blacklist(
                        coin, f"게이트 미통과: {', '.join(gate_result.fail_reasons)}"
                    )
                    self.trade_logger.log_event(
                        "COIN_GATE_FAIL", coin,
                        {
                            "fail_reasons": gate_result.fail_reasons,
                            "win_rate": gate_result.win_rate,
                        },
                    )
                    return False

                live_strategy = RSIStrategy(
                    period=best_params.get("period", config.RSI_PERIOD),
                    oversold=best_params.get("oversold", config.RSI_OVERSOLD),
                    overbought=best_params.get("overbought", config.RSI_OVERBOUGHT),
                )

            risk_manager = RiskManager(
                stop_loss_pct=config.STOP_LOSS_PCT,
                take_profit_pct=config.TAKE_PROFIT_PCT,
                max_drawdown_pct=config.MAX_DRAWDOWN_PCT,
            )

            LiveMonitor = _import_live_monitor()
            live_monitor = LiveMonitor(
                window=config.LIVE_MONITOR_WINDOW,
                threshold=config.LIVE_WIN_RATE_THRESHOLD,
                min_sample=config.LIVE_MONITOR_MIN_SAMPLE,
            )

            # 적응형 학습 엔진 (활성화 시)
            adaptive_engine = None
            if config.ADAPTIVE_ENABLED:
                learning_log = LearningLog(config.DB_PATH)
                adaptive_engine = AdaptiveEngine(
                    strategy=live_strategy,
                    trade_logger=self.trade_logger,
                    learning_log=learning_log,
                    gate=gate,
                    client=self.client,
                    notifier=self.notifier,
                    coin=coin,
                    risk_manager=risk_manager,
                )

            # 5. TradingBot 생성 (지연 임포트)
            from bot.trading_bot import TradingBot
            bot = TradingBot(
                client=self.client,
                strategy=live_strategy,
                risk_manager=risk_manager,
                trade_logger=self.trade_logger,
                live_monitor=live_monitor,
                coin=coin,
                notifier=self.notifier,
                adaptive_engine=adaptive_engine,
            )

            # 6. 슬롯 등록
            slot = CoinSlot(
                coin=coin,
                bot=bot,
                strategy=live_strategy,
                risk_manager=risk_manager,
                live_monitor=live_monitor,
                adaptive_engine=adaptive_engine,
            )
            self._slots[coin] = slot

            strategy_desc = self._describe_strategy(live_strategy)
            event_data = {
                "params": best_params,
                "range_pct": score.range_pct,
                "volume_krw": score.volume_krw,
                "strategy_type": config.SCALP_ENTRY_MODE,
            }
            self.trade_logger.log_event("COIN_ACTIVATED", coin, event_data)

            logger.info(
                f"[Portfolio] {coin} 활성화 완료 | {strategy_desc}"
            )

            if self.notifier:
                self.notifier.send(
                    f"<b>코인 활성화</b>\n"
                    f"코인: {coin}\n"
                    f"전략: {strategy_desc}\n"
                    f"변동폭: {score.range_pct:.1f}%"
                )
            return True

        except Exception as e:
            logger.error(f"[Portfolio] {coin} 활성화 오류: {e}")
            self._add_to_blacklist(coin, f"활성화 오류: {e}")
            return False

    # ── 트레이딩 사이클 ──────────────────────────────────────────────────────

    def run_all_cycles(self) -> None:
        """
        모든 활성 코인의 트레이딩 사이클을 실행한다. 매 5분 호출.
        드레이닝 슬롯도 청산 기회를 위해 실행한다.
        """
        if not self._slots:
            logger.debug("[Portfolio] 활성 코인 없음")
            return

        for coin, slot in list(self._slots.items()):
            try:
                # 드레이닝 모드: 포지션 없으면 스킵
                if slot.draining and slot.bot._current_entry_id is None:
                    continue

                slot.bot.run_cycle()

                # 비활성 감지 (LiveMonitor threshold 미달 등)
                if not slot.bot.is_active and not slot.draining:
                    logger.info(f"[Portfolio] {coin} 봇 비활성화 감지 — 드레인 모드 전환")
                    self.deactivate_coin(coin, reason="봇 자체 비활성화")

            except Exception as e:
                logger.error(f"[Portfolio] {coin} 사이클 오류: {e}")

        # 드레이닝 완료 슬롯 정리
        self._clean_drained_slots()

    # ── 코인 비활성화 ────────────────────────────────────────────────────────

    def deactivate_coin(self, coin: str, reason: str = "") -> bool:
        """
        코인을 비활성화한다.
        - 포지션 없음 → 즉시 제거
        - 포지션 있음 → 드레인 모드 (신규 진입 차단, 기존 포지션 SL/TP/SELL 대기)

        Returns:
            비활성화 처리 성공 여부
        """
        slot = self._slots.get(coin)
        if not slot:
            logger.warning(f"[Portfolio] {coin} 슬롯 없음 — 비활성화 무시")
            return False

        if slot.bot._current_entry_id is not None:
            # 포지션 보유 중 — 드레인 모드
            slot.draining = True
            slot.bot._active = True  # 청산을 위해 활성 상태 유지
            logger.info(f"[Portfolio] {coin} 드레인 모드 진입 (사유: {reason})")
            self.trade_logger.log_event(
                "COIN_DRAINING", coin, {"reason": reason}
            )
        else:
            # 포지션 없음 — 즉시 제거
            del self._slots[coin]
            logger.info(f"[Portfolio] {coin} 즉시 제거 (사유: {reason})")
            self.trade_logger.log_event(
                "COIN_DEACTIVATED", coin, {"reason": reason}
            )

        if self.notifier:
            self.notifier.send(
                f"<b>코인 비활성화</b>\n"
                f"코인: {coin}\n"
                f"사유: {reason}\n"
                f"상태: {'드레인 모드' if coin in self._slots else '즉시 제거'}"
            )
        return True

    # ── 적응형 학습 ──────────────────────────────────────────────────────────

    def run_all_adaptations(self) -> None:
        """모든 활성 코인의 적응형 학습 사이클을 실행한다."""
        for coin, slot in self._slots.items():
            if slot.adaptive_engine and not slot.draining:
                try:
                    proposals = slot.adaptive_engine.run_adaptation_cycle()
                    if proposals:
                        logger.info(
                            f"[Portfolio] {coin} 적응 완료: {len(proposals)}건 적용"
                        )
                except Exception as e:
                    logger.error(f"[Portfolio] {coin} 적응 오류: {e}")

    # ── 포트폴리오 안전장치 ──────────────────────────────────────────────────

    def _is_portfolio_mdd_exceeded(self) -> bool:
        """포트폴리오 전체 MDD를 체크한다."""
        if self._portfolio_peak == 0:
            return False
        dd = (self._portfolio_peak - self._portfolio_equity) / self._portfolio_peak * 100
        if dd >= self.portfolio_mdd_pct:
            logger.warning(
                f"[Portfolio] 포트폴리오 MDD {dd:.1f}% >= {self.portfolio_mdd_pct}%"
            )
            return True
        return False

    def update_portfolio_equity(self, pnl_pct: float) -> None:
        """
        개별 거래 완료 시 호출. 포트폴리오 전체 자산을 업데이트한다.

        Args:
            pnl_pct: 해당 거래의 손익률 %
        """
        # 코인당 배분 비율로 포트폴리오 영향 계산
        allocation_ratio = self.per_coin_allocation_pct / 100
        portfolio_impact = pnl_pct * allocation_ratio / 100
        self._portfolio_equity *= (1 + portfolio_impact)

        if self._portfolio_equity > self._portfolio_peak:
            self._portfolio_peak = self._portfolio_equity

        self._total_trades += 1

    def _calculate_allocation(self) -> float:
        """코인당 KRW 배분 금액을 계산한다."""
        return config.TRADE_AMOUNT * (self.per_coin_allocation_pct / 100)

    # ── 전략 팩토리 ──────────────────────────────────────────────────────────

    def _create_scalp_strategy(self) -> ScalpStrategy:
        """ScalpStrategy 인스턴스를 생성한다 (config.py 파라미터 사용)."""
        from strategy.market_regime import EnsembleRegimeDetector
        detector = EnsembleRegimeDetector(
            bull_threshold=config.REGIME_BULL_THRESHOLD,
            bear_threshold=config.REGIME_BEAR_THRESHOLD,
        )
        return ScalpStrategy(regime_detector=detector)

    def _describe_strategy(self, strategy) -> str:
        """전략 종류에 따른 설명 문자열 반환."""
        if isinstance(strategy, ScalpStrategy):
            return "ScalpMeta(BULL→S2, SIDEWAYS→S3, BEAR→HOLD)"
        if isinstance(strategy, RSIStrategy):
            return (
                f"RSI({strategy.period},{strategy.oversold},{strategy.overbought})"
            )
        return strategy.name

    # ── 블랙리스트 관리 ──────────────────────────────────────────────────────

    def _add_to_blacklist(self, coin: str, reason: str) -> None:
        """게이트 실패한 코인을 블랙리스트에 등록한다."""
        expires_at = datetime.now() + timedelta(hours=self.blacklist_ttl_hours)
        self._blacklist[coin] = BlacklistEntry(
            coin=coin, reason=reason, expires_at=expires_at
        )
        logger.info(
            f"[Portfolio] {coin} 블랙리스트 등록 ({self.blacklist_ttl_hours}h) — {reason}"
        )

    def _clean_blacklist(self) -> None:
        """만료된 블랙리스트 항목을 제거한다."""
        now = datetime.now()
        expired = [c for c, e in self._blacklist.items() if now >= e.expires_at]
        for coin in expired:
            del self._blacklist[coin]
            logger.debug(f"[Portfolio] {coin} 블랙리스트 만료 — 재평가 가능")

    # ── 드레이닝 슬롯 정리 ───────────────────────────────────────────────────

    def _clean_drained_slots(self) -> None:
        """포지션 없이 드레인 모드인 슬롯을 제거한다."""
        drained = [coin for coin, slot in self._slots.items() if slot.is_idle()]
        for coin in drained:
            del self._slots[coin]
            logger.info(f"[Portfolio] {coin} 드레인 완료 — 슬롯 제거")
            self.trade_logger.log_event("COIN_DEACTIVATED", coin, {"reason": "드레인 완료"})

    # ── 스크리너 기반 비활성화 ────────────────────────────────────────────────

    def check_and_deactivate_stale(self, current_scores: List[CoinScore]) -> List[str]:
        """
        스크리너 결과에 없는 활성 코인을 비활성화한다.
        거래량/변동성이 떨어진 코인을 자동 정리.

        Args:
            current_scores: 최신 스크리너 결과

        Returns:
            비활성화된 코인 리스트
        """
        screened_symbols: Set[str] = {s.symbol for s in current_scores}
        deactivated = []

        for coin in list(self._slots.keys()):
            slot = self._slots[coin]
            if slot.draining:
                continue  # 이미 드레이닝 중이면 스킵
            if coin not in screened_symbols:
                self.deactivate_coin(coin, reason="스크리너 탈락 (거래량/변동성 부족)")
                deactivated.append(coin)

        return deactivated

    # ── 상태 조회 ────────────────────────────────────────────────────────────

    @property
    def active_coins(self) -> List[str]:
        """활성 코인 심볼 리스트 (드레이닝 제외)."""
        return [c for c, s in self._slots.items() if not s.draining]

    @property
    def all_coins(self) -> List[str]:
        """모든 슬롯 코인 심볼 (드레이닝 포함)."""
        return list(self._slots.keys())

    def has_position(self, coin: str) -> bool:
        """특정 코인이 포지션을 보유 중인지 확인."""
        slot = self._slots.get(coin)
        if not slot:
            return False
        return slot.bot._current_entry_id is not None

    def status(self) -> dict:
        """포트폴리오 전체 현황 요약."""
        portfolio_dd = 0.0
        if self._portfolio_peak > 0:
            portfolio_dd = (
                (self._portfolio_peak - self._portfolio_equity)
                / self._portfolio_peak * 100
            )

        slot_statuses = {}
        for coin, slot in self._slots.items():
            slot_statuses[coin] = {
                "draining": slot.draining,
                "active": slot.bot.is_active,
                "has_position": slot.bot._current_entry_id is not None,
                "strategy": self._describe_strategy(slot.strategy),
                "live_win_rate": slot.live_monitor.current_win_rate(),
                "risk_dd": slot.risk_manager.status()["current_drawdown_pct"],
                "activated_at": slot.activated_at.isoformat(),
            }

        return {
            "active_coins": self.active_coins,
            "total_slots": len(self._slots),
            "draining_count": sum(1 for s in self._slots.values() if s.draining),
            "blacklist": list(self._blacklist.keys()),
            "portfolio_equity": round(self._portfolio_equity, 6),
            "portfolio_mdd_pct": round(portfolio_dd, 2),
            "total_trades": self._total_trades,
            "slots": slot_statuses,
        }

    def status_text(self) -> str:
        """텔레그램/로그용 포트폴리오 현황 텍스트."""
        s = self.status()
        lines = [
            f"활성 코인: {', '.join(s['active_coins']) or '없음'}",
            f"슬롯: {s['total_slots']}/{self.max_positions} (드레인: {s['draining_count']})",
            f"포트폴리오 MDD: {s['portfolio_mdd_pct']:.1f}% / {self.portfolio_mdd_pct}%",
            f"총 거래: {s['total_trades']}건",
        ]
        if s["blacklist"]:
            lines.append(f"블랙리스트: {', '.join(s['blacklist'])}")

        for coin, info in s["slots"].items():
            flag = " [DRAIN]" if info["draining"] else ""
            pos = " [POS]" if info["has_position"] else ""
            lines.append(
                f"  {coin}{flag}{pos}: {info['strategy']} "
                f"승률={info['live_win_rate']:.1f}% DD={info['risk_dd']:.1f}%"
            )
        return "\n".join(lines)

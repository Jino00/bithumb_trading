"""적응형 실시간 페이퍼 트레이딩 시스템.

6전략 평가 → 최적 전략 선택 → 실시간 모니터링 → 동적 전략 전환.
빗썸 실시간 가격으로 가상 매매를 수행하며, 시장 상태에 따라 전략을 자동 교체한다.
"""
import argparse
import signal
import sys
import time
from dataclasses import dataclass, field
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


# ── 페이퍼 트레이딩 설정 (config.py에서 읽기) ──────────────
PAPER_DEFAULT_CAPITAL = config.PAPER_INITIAL_KRW
PAPER_FEE_PCT = config.BACKTEST_FEE_PCT
PAPER_SLIPPAGE_PCT = config.BACKTEST_SLIPPAGE_PCT
PAPER_TRADING_INTERVAL_MIN = config.PAPER_TRADING_INTERVAL_MIN
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


@dataclass
class PaperTrade:
    """가상 거래 기록."""
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


class AdaptivePaperTrader:
    """6전략 적응형 페이퍼 트레이딩 시스템.

    시작 시 전체 전략 평가 → 최적 선택 → 실시간 모니터링 → 동적 전환.
    """

    def __init__(
        self,
        coin: str = "BTC",
        capital: float = PAPER_DEFAULT_CAPITAL,
        interval_min: int = PAPER_TRADING_INTERVAL_MIN,
        report_min: int = PAPER_REPORT_INTERVAL_MIN,
        verbose: bool = False,
        end_time: Optional[datetime] = None,
    ) -> None:
        self._coin = coin
        self._initial_capital = capital
        self._balance_krw = capital       # 현재 원화 잔고
        self._interval_min = interval_min
        self._report_min = report_min
        self._verbose = verbose
        self._end_time = end_time          # 자동 종료 시각 (None이면 무한)

        # 외부 컴포넌트
        self._client = BithumbClient("", "")   # 공개 API (시세 전용)
        self._monitor = MarketMonitor()
        self._evaluator = StrategyEvaluator()
        self._regime_detector = EnsembleRegimeDetector()
        self._strategy = ScalpStrategy(self._regime_detector)

        # 상태
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
        print(f"OK ({len(df)}개 1h 캔들)")

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
            print("  경고: 양호한 전략 없음 — HOLD 모드로 시작합니다.")
            self._active_strategy_id = ""
            self._active_strategy_name = "NONE"
        else:
            self._active_strategy_id = result.best.strategy_id
            self._active_strategy_name = result.best.name
            print(f"\n  활성 전략: {result.best.name} "
                  f"(점수: {result.best.score:.1f})")

        # 대시보드 상태 기록
        PaperStateWriter.update(self)
        return True

    def run(self) -> None:
        """스케줄러 루프 시작 (Ctrl+C 또는 end_time에 종료)."""
        self._running = True
        end_msg = ""
        if self._end_time:
            end_msg = f" → {self._end_time.strftime('%m/%d %H:%M')} 자동 종료"
        print(f"\n페이퍼 트레이딩 시작... "
              f"({self._interval_min}분 사이클{end_msg})")
        print(f"{'─'*64}\n")

        # 스케줄러 등록
        schedule.every(self._interval_min).minutes.do(self._safe_trading_cycle)
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

        # 2. 현재가 조회
        price = self._client.get_current_price(self._coin)
        if price is None:
            if self._verbose:
                print(f"[{now}] SKIP  | 가격 조회 실패")
            return

        # 3. 시장 모니터링 → 트리거 확인
        recent_trades_for_monitor = [
            _trade_to_backtest_trade(t) for t in self._trades[-10:]
        ]
        triggers = self._monitor.check(df, regimes, recent_trades_for_monitor)
        if triggers:
            self._handle_triggers(triggers, df, regimes)

        # 4. 포지션 있으면: 청산 조건 확인
        if self._position:
            self._check_exit(price, df)
            if self._position is None:
                return  # 청산됨 → 이번 사이클 종료

        # 5. 포지션 없으면: 신호 생성 → 매수
        if self._position is None and self._active_strategy_id:
            ctx = self._strategy.generate_signal_with_context(df)
            self._print_cycle_status(now, price, ctx)

            if ctx.signal == "BUY":
                # 활성 전략과 일치하는 신호만 실행
                if self._is_matching_strategy(ctx):
                    self._execute_buy(price, ctx)
                elif self._verbose:
                    print(f"  → 전략 불일치: {ctx.sub_strategy} != "
                          f"{self._active_strategy_name}")
        else:
            if self._position and self._verbose:
                pnl = (price - self._position.entry_price) / \
                    self._position.entry_price * 100
                print(f"[{now}] HOLD  | {price:,.0f} | "
                      f"{self._active_strategy_name} | "
                      f"포지션 보유 중 (PnL: {pnl:+.2f}%)")
            elif not self._active_strategy_id:
                current_regime = str(regimes[-1]) if len(regimes) > 0 else "?"
                if self._verbose:
                    print(f"[{now}] WAIT  | {price:,.0f} | "
                          f"활성 전략 없음 | {current_regime}")

        # 대시보드 상태 기록 (매 사이클)
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

            # 전략 전환 시 포지션 정리
            if self._position:
                price = self._client.get_current_price(self._coin)
                if price:
                    print(f"        전략 전환 — 기존 포지션 청산")
                    self._execute_sell(price, "STRATEGY_SWITCH")
        else:
            print(f"        전략 유지: {result.best.name} "
                  f"(점수: {result.best.score:.1f})")

    # ── 매매 실행 ─────────────────────────────────────────────

    def _execute_buy(self, price: float, ctx: ScalpSignalContext) -> None:
        """가상 매수 실행 (전액 투입, 수수료+슬리피지 차감)."""
        if self._balance_krw <= 0:
            return

        now = datetime.now().strftime("%H:%M")
        entry_price = price * (1 + PAPER_SLIPPAGE_PCT / 100)
        fee = self._balance_krw * (PAPER_FEE_PCT / 100)
        investable = self._balance_krw - fee
        quantity = investable / entry_price

        self._position = PaperPosition(
            coin=self._coin,
            entry_price=entry_price,
            quantity=quantity,
            entry_time=datetime.now().strftime("%Y-%m-%d %H:%M"),
            sl_pct=ctx.sl_pct,
            tp_pct=ctx.tp_pct,
            strategy=ctx.sub_strategy,
            ha_weak_min_pct=ctx.ha_weak_min_pct,
            invested_krw=self._balance_krw,
        )
        self._balance_krw = 0.0

        print(f"[{now}] BUY   | {price:,.0f} | {ctx.sub_strategy} | "
              f"SL {ctx.sl_pct:.1f}% TP {ctx.tp_pct:.1f}% | "
              f"{self._position.invested_krw:,.0f}원 투입")
        if self._verbose:
            print(f"  → 진입가(슬리피지): {entry_price:,.0f}, "
                  f"수량: {quantity:.8f}, 수수료: {fee:,.0f}원")

    def _execute_sell(self, price: float, reason: str) -> None:
        """가상 매도 실행 (잔고 갱신)."""
        if self._position is None:
            return

        now = datetime.now().strftime("%H:%M")
        pos = self._position
        exit_price = price * (1 - PAPER_SLIPPAGE_PCT / 100)
        gross_krw = pos.quantity * exit_price
        fee = gross_krw * (PAPER_FEE_PCT / 100)
        returned_krw = gross_krw - fee
        pnl_krw = returned_krw - pos.invested_krw
        pnl_pct = pnl_krw / pos.invested_krw * 100 if pos.invested_krw > 0 else 0

        self._balance_krw = returned_krw

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
        )
        self._trades.append(trade)
        self._position = None

        print(f"[{now}] EXIT  | {price:,.0f} | {reason} | "
              f"{pnl_krw:+,.0f}원 ({pnl_pct:+.2f}%) | "
              f"잔고: {self._balance_krw:,.0f}원")

        # 매도 즉시 대시보드 갱신
        PaperStateWriter.update(self)

    def _check_exit(self, price: float, df: pd.DataFrame) -> None:
        """SL / TP / HA_WEAK 청산 조건 확인."""
        if self._position is None:
            return

        pos = self._position
        entry = pos.entry_price
        current_pnl_pct = (price - entry) / entry * 100

        # 손절 (SL)
        if pos.sl_pct > 0 and current_pnl_pct <= -pos.sl_pct:
            self._execute_sell(price, "SL")
            return

        # 익절 (TP)
        if pos.tp_pct > 0 and current_pnl_pct >= pos.tp_pct:
            self._execute_sell(price, "TP")
            return

        # HA_WEAK 청산 (S3 전용)
        if pos.strategy == "S3_HA" and len(df) >= 2:
            self._check_ha_weak_exit(price, df, current_pnl_pct)

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

    # ── 유틸리티 ──────────────────────────────────────────────

    def _fetch_ohlcv(self, count: int) -> Optional[pd.DataFrame]:
        """빗썸에서 OHLCV 데이터를 가져온다."""
        try:
            df = self._client.get_ohlcv(self._coin, interval="1h", count=count)
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
        print(f"  사이클: {self._interval_min}분 | "
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
        print(f"{'─'*64}\n")

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
        "--interval", type=int, default=PAPER_TRADING_INTERVAL_MIN,
        help=f"트레이딩 사이클 분 (기본: {PAPER_TRADING_INTERVAL_MIN})"
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

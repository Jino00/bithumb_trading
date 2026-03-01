"""거래 핵심 로직 — LiveMonitor와 TradingBot 클래스를 제공한다."""
import logging
from collections import deque
from datetime import datetime
from typing import Optional

import config
from logger.trade_logger import TradeLogger
from notifier.telegram_notifier import TelegramNotifier
from learning.adaptive_engine import AdaptiveEngine
from risk.risk_manager import RiskManager
from strategy.base_strategy import BaseStrategy
from strategy.rsi_strategy import RSIStrategy, SignalContext

logger = logging.getLogger("bot.trading_bot")


# ── 실전 승률 모니터 ──────────────────────────────────────────────────────────

class LiveMonitor:
    """
    최근 N건의 실전 거래 승률을 추적한다.
    threshold 이하로 떨어지면 is_below_threshold()가 True를 반환한다.

    Args:
        window:    최근 N건 (기본 20)
        threshold: 비활성화 기준 승률 % (기본 65.0)
        min_sample: 판단에 필요한 최소 샘플 수 (기본 5)
    """

    def __init__(
        self,
        window: int = 20,
        threshold: float = 65.0,
        min_sample: int = 5,
    ) -> None:
        self.threshold = threshold
        self.min_sample = min_sample
        self._results: deque = deque(maxlen=window)

    def record(self, pnl_pct: float) -> None:
        self._results.append(pnl_pct > 0)

    def current_win_rate(self) -> float:
        if not self._results:
            return 100.0
        return sum(self._results) / len(self._results) * 100

    def is_below_threshold(self) -> bool:
        if len(self._results) < self.min_sample:
            return False
        return self.current_win_rate() < self.threshold

    def status(self) -> str:
        n = len(self._results)
        wr = self.current_win_rate()
        return (
            f"실전 승률={wr:.1f}% ({n}건) "
            + ("⚠ 임계값 미달" if self.is_below_threshold() else "✓ 정상")
        )


# ── 거래 봇 ───────────────────────────────────────────────────────────────────

class TradingBot:
    """실전 거래 사이클을 담당한다."""

    def __init__(
        self,
        client,
        strategy: BaseStrategy,
        risk_manager: RiskManager,
        trade_logger: TradeLogger,
        live_monitor: LiveMonitor,
        coin: str = "BTC",
        notifier: Optional[TelegramNotifier] = None,
        adaptive_engine: Optional[AdaptiveEngine] = None,
    ) -> None:
        self.coin = coin
        self.client = client
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.trade_logger = trade_logger
        self.live_monitor = live_monitor
        self.notifier = notifier
        self.adaptive_engine = adaptive_engine

        self._active: bool = True
        self._current_entry_id: Optional[int] = None
        self._entry_time: Optional[datetime] = None
        self._entry_price: Optional[float] = None

        self._recover_open_position()

    def run_cycle(self) -> None:
        """한 사이클: 시세 → 신호 → 리스크 체크 → 주문 → 로그"""
        if not self._active:
            logger.warning("봇이 비활성화 상태입니다.")
            return

        try:
            if self._check_live_monitor():
                return
            if self._check_mdd():
                return

            ctx, current_price = self._fetch_signal()
            if ctx is None or current_price is None:
                return

            self._process_signal(ctx, current_price)
        except Exception as e:
            logger.exception(f"거래 사이클 오류: {e}")
            self.trade_logger.log_event("ERROR", self.coin, {"error": str(e)})
            if self.notifier:
                self.notifier.notify_error(f"[{self.coin}] {e}")

    def _check_live_monitor(self) -> bool:
        """실전 승률 체크. 임계값 미달 시 비활성화하고 True 반환."""
        if not self.live_monitor.is_below_threshold():
            return False
        wr = self.live_monitor.current_win_rate()
        logger.warning(
            f"실전 승률 {wr:.1f}% < {self.live_monitor.threshold}% — 전략 자동 비활성화"
        )
        self.trade_logger.log_event(
            "STRATEGY_DEACTIVATED", self.coin,
            {"reason": f"실전 승률 {wr:.1f}% 임계값 미달", "win_rate": wr},
        )
        if self.notifier:
            self.notifier.notify_strategy_deactivated(wr, self.live_monitor.threshold)
        self._active = False
        return True

    def _check_mdd(self) -> bool:
        """MDD 초과 확인. 초과 시 True 반환."""
        if not self.risk_manager.is_mdd_exceeded():
            return False
        logger.warning("MDD 한도 초과 — 거래 중단")
        self.trade_logger.log_event("MDD_EXCEEDED", self.coin, self.risk_manager.status())
        if self.notifier:
            status = self.risk_manager.status()
            self.notifier.notify_mdd_exceeded(
                status["current_drawdown_pct"], self.risk_manager.max_drawdown_pct
            )
        return True

    def _fetch_signal(self):
        """OHLCV 조회 → 신호 생성 → (ctx, price) 반환. 실패 시 (None, None)."""
        df = self.client.get_ohlcv(
            self.coin, interval=config.RSI_CANDLE_INTERVAL, count=config.OHLCV_CANDLE_COUNT
        )
        if df is None or df.empty:
            logger.error("OHLCV 조회 실패")
            return None, None

        ctx: SignalContext = self.strategy.generate_signal_with_context(df)
        current_price = self.client.get_current_price(self.coin)
        if current_price is None:
            logger.error("현재가 조회 실패")
            return None, None

        logger.info(
            f"[{self.coin}] price={current_price:,.0f} RSI={ctx.rsi_value:.1f} "
            f"vol={ctx.volume_ratio:.2f}x trend={ctx.trend} → {ctx.signal}"
        )
        return ctx, current_price

    def _process_signal(self, ctx: SignalContext, current_price: float) -> None:
        """신호에 따라 진입/청산을 처리한다."""
        if self._current_entry_id is not None and self._entry_price is not None:
            self._check_exit(self.coin, current_price, ctx)
        elif ctx.signal == "BUY":
            if self.adaptive_engine:
                blocked, reason = self.adaptive_engine.should_block_buy(
                    hour=datetime.now().hour, trend=ctx.trend
                )
                if blocked:
                    logger.info(f"[Adaptive] 매수 차단: {reason}")
                    self.trade_logger.log_event(
                        "BUY_BLOCKED", self.coin, {"reason": reason, "rsi": ctx.rsi_value}
                    )
                    return
            self._execute_buy(self.coin, current_price, ctx)

    # ── 진입 / 청산 ────────────────────────────────────────

    def _execute_buy(self, coin: str, price: float, ctx: SignalContext) -> None:
        """매수 주문 실행 및 로그"""
        trade_krw = (
            self.adaptive_engine.get_trade_amount(config.TRADE_AMOUNT)
            if self.adaptive_engine
            else config.TRADE_AMOUNT
        )
        amount = trade_krw / price
        try:
            result = self.client.buy(coin, amount)
        except Exception as e:
            self.trade_logger.log_event("ORDER_ERROR", coin, {"side": "BUY", "error": str(e)})
            raise

        entry_id = self.trade_logger.log_entry(
            strategy_name=self.strategy.name,
            coin=coin,
            price=price,
            amount=amount,
            reason=ctx.reason,
            rsi_value=ctx.rsi_value,
            volume_ratio=ctx.volume_ratio,
            trend=ctx.trend,
            volatility=ctx.volatility,
            indicators=ctx.indicators,
            result=result,
        )
        self.risk_manager.record_trade("BUY", price)
        self._current_entry_id = entry_id
        self._entry_price = price
        self._entry_time = datetime.now()
        if self.notifier:
            self.notifier.notify_buy(coin, price, amount, ctx.reason)

    def _check_exit(self, coin: str, current_price: float, ctx: SignalContext) -> None:
        """청산 조건 확인 후 매도 실행"""
        pnl_pct = (current_price - self._entry_price) / self._entry_price * 100

        should_exit = (
            pnl_pct <= -config.STOP_LOSS_PCT
            or pnl_pct >= config.TAKE_PROFIT_PCT
            or ctx.signal == "SELL"
        )
        if not should_exit:
            return

        exit_reason = RSIStrategy.build_exit_reason(
            rsi=ctx.rsi_value if ctx.signal == "SELL" else None,
            pnl_pct=pnl_pct,
            stop_loss_pct=config.STOP_LOSS_PCT,
            take_profit_pct=config.TAKE_PROFIT_PCT,
            overbought=self.strategy.overbought,
        )
        hold_minutes = (
            (datetime.now() - self._entry_time).total_seconds() / 60
            if self._entry_time else 0.0
        )

        balance = self.client.get_coin_balance(coin) or 0.0
        if balance <= 0:
            logger.warning("청산할 잔고 없음")
            self._reset_position()
            return

        try:
            result = self.client.sell(coin, balance)
        except Exception as e:
            self.trade_logger.log_event(
                "ORDER_ERROR", coin, {"side": "SELL", "error": str(e)}
            )
            raise

        self.trade_logger.log_exit(
            entry_id=self._current_entry_id,
            coin=coin,
            price=current_price,
            amount=balance,
            exit_reason=exit_reason,
            pnl_pct=round(pnl_pct, 4),
            hold_minutes=round(hold_minutes, 1),
            result=result,
        )
        self.risk_manager.record_trade("SELL", current_price)
        self.live_monitor.record(pnl_pct)
        self._reset_position()
        if self.notifier:
            self.notifier.notify_sell(coin, current_price, balance, pnl_pct, exit_reason)

        logger.info(
            f"청산 완료 | pnl={pnl_pct:+.2f}% | hold={hold_minutes:.0f}m | {exit_reason}"
        )
        logger.info(f"[Monitor] {self.live_monitor.status()}")

    def _reset_position(self) -> None:
        self._current_entry_id = None
        self._entry_price = None
        self._entry_time = None

    def _recover_open_position(self) -> None:
        """봇 재시작 시 미청산 포지션을 DB에서 복구한다."""
        open_entry = self.trade_logger.get_open_entry(self.coin)
        if open_entry:
            self._current_entry_id = open_entry["id"]
            self._entry_price = open_entry["price"]
            try:
                self._entry_time = datetime.fromisoformat(open_entry["timestamp"])
            except Exception:
                self._entry_time = datetime.now()
            logger.info(
                f"미청산 포지션 복구: entry_id={self._current_entry_id} "
                f"price={self._entry_price:,.0f}"
            )

    @property
    def is_active(self) -> bool:
        return self._active

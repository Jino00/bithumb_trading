"""
리스크 관리자 — 손절/익절, MDD(최대 낙폭) 관리
"""
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


class RiskManager:
    """
    실시간 포지션 리스크를 관리한다.

    - 손절(stop_loss_pct): 진입가 대비 -N% 하락 시 SELL 신호
    - 익절(take_profit_pct): 진입가 대비 +N% 상승 시 SELL 신호
    - MDD 한도(max_drawdown_pct): 고점 대비 누적 낙폭 초과 시 거래 중단

    Args:
        stop_loss_pct: 손절 기준 % (양수, 예: 3.0)
        take_profit_pct: 익절 기준 % (양수, 예: 5.0)
        max_drawdown_pct: MDD 한도 % (양수, 예: 20.0)
    """

    def __init__(
        self,
        stop_loss_pct: float = 3.0,
        take_profit_pct: float = 5.0,
        max_drawdown_pct: float = 20.0,
    ) -> None:
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.max_drawdown_pct = max_drawdown_pct

        self._entry_price: Optional[float] = None
        self._equity: float = 1.0          # 시작 자산 기준 1.0
        self._peak_equity: float = 1.0
        self._trade_history: List[float] = []  # pnl_pct 목록

    # ── 포지션 추적 ────────────────────────────────────────

    def record_trade(self, side: str, price: float) -> None:
        """매수/매도 가격을 기록해 내부 상태를 업데이트한다."""
        if side == "BUY":
            self._entry_price = price
            logger.debug(f"[Risk] 매수 진입 price={price:,}")

        elif side == "SELL" and self._entry_price:
            pnl_pct = (price - self._entry_price) / self._entry_price * 100
            self._trade_history.append(pnl_pct)
            self._equity *= 1 + pnl_pct / 100

            if self._equity > self._peak_equity:
                self._peak_equity = self._equity

            current_dd = self._current_drawdown()
            logger.info(
                f"[Risk] 매도 청산 pnl={pnl_pct:.2f}% | "
                f"equity={self._equity:.4f} | MDD={current_dd:.2f}%"
            )
            self._entry_price = None

    # ── 실시간 체크 ────────────────────────────────────────

    def should_stop_loss(self, current_price: float) -> bool:
        """현재가 기준 손절 여부"""
        if self._entry_price is None:
            return False
        pnl = (current_price - self._entry_price) / self._entry_price * 100
        if pnl <= -self.stop_loss_pct:
            logger.warning(f"[Risk] 손절 발동: pnl={pnl:.2f}% <= -{self.stop_loss_pct}%")
            return True
        return False

    def should_take_profit(self, current_price: float) -> bool:
        """현재가 기준 익절 여부"""
        if self._entry_price is None:
            return False
        pnl = (current_price - self._entry_price) / self._entry_price * 100
        if pnl >= self.take_profit_pct:
            logger.info(f"[Risk] 익절 발동: pnl={pnl:.2f}% >= +{self.take_profit_pct}%")
            return True
        return False

    def is_mdd_exceeded(self) -> bool:
        """누적 MDD 한도 초과 여부"""
        dd = self._current_drawdown()
        if dd >= self.max_drawdown_pct:
            logger.warning(f"[Risk] MDD 한도 초과: {dd:.2f}% >= {self.max_drawdown_pct}%")
            return True
        return False

    # ── 상태 조회 ──────────────────────────────────────────

    def _current_drawdown(self) -> float:
        if self._peak_equity == 0:
            return 0.0
        return (self._peak_equity - self._equity) / self._peak_equity * 100

    def status(self) -> dict:
        return {
            "entry_price": self._entry_price,
            "equity": round(self._equity, 6),
            "peak_equity": round(self._peak_equity, 6),
            "current_drawdown_pct": round(self._current_drawdown(), 2),
            "total_trades": len(self._trade_history),
        }

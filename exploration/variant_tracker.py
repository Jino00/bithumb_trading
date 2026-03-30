"""변형 추적기 — 실험 변형의 성과를 추적하고 승격/폐기를 판단한다."""
import logging
from dataclasses import dataclass
from typing import Optional

import config
from exploration.exploration_db import ExplorationDB

logger = logging.getLogger("exploration")


@dataclass
class VariantStats:
    """변형의 실시간 성과 통계."""
    trade_count: int = 0
    wins: int = 0
    losses: int = 0
    total_pnl_krw: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    peak_balance: float = 0.0
    max_drawdown_pct: float = 0.0

    @property
    def win_rate(self) -> float:
        if self.trade_count == 0:
            return 0.0
        return self.wins / self.trade_count * 100

    @property
    def profit_factor(self) -> float:
        if self.gross_loss == 0:
            return 999.0 if self.gross_profit > 0 else 0.0
        return self.gross_profit / abs(self.gross_loss)


class VariantTracker:
    """변형별 성과 추적 + 승격/폐기 판단."""

    def __init__(self, db: Optional[ExplorationDB] = None) -> None:
        self._db = db or ExplorationDB()

    def record_trade(
        self, variant_id: str, stats: VariantStats,
        pnl_krw: float, balance: float,
    ) -> None:
        """거래 결과 기록 후 DB 업데이트."""
        stats.trade_count += 1
        stats.total_pnl_krw += pnl_krw
        if pnl_krw > 0:
            stats.wins += 1
            stats.gross_profit += pnl_krw
        else:
            stats.losses += 1
            stats.gross_loss += pnl_krw

        # MDD 추적
        if balance > stats.peak_balance:
            stats.peak_balance = balance
        if stats.peak_balance > 0:
            dd = (stats.peak_balance - balance) / stats.peak_balance * 100
            stats.max_drawdown_pct = max(stats.max_drawdown_pct, dd)

        self._sync_to_db(variant_id, stats)

    def evaluate(self, stats: VariantStats) -> str:
        """변형 판정: PROMOTE / DISCARD / KEEP."""
        if stats.trade_count < config.EXPLORATION_MIN_TRADES:
            return "KEEP"
        if (stats.win_rate >= config.EXPLORATION_PROMOTE_WR
                and stats.profit_factor >= config.EXPLORATION_PROMOTE_PF):
            return "PROMOTE"
        if stats.win_rate < config.EXPLORATION_DISCARD_WR:
            return "DISCARD"
        return "KEEP"

    def mark_promoted(self, variant_id: str) -> None:
        """승격 상태로 변경."""
        self._db.set_status(variant_id, "PROMOTED")
        logger.info(f"[탐색] {variant_id} → PROMOTED (정식 모델 승격)")

    def mark_discarded(self, variant_id: str) -> None:
        """폐기 상태로 변경."""
        self._db.set_status(variant_id, "DISCARDED")
        logger.info(f"[탐색] {variant_id} → DISCARDED")

    def _sync_to_db(self, variant_id: str, stats: VariantStats) -> None:
        """성과 통계를 DB에 동기화."""
        self._db.update_stats(
            variant_id=variant_id,
            trade_count=stats.trade_count,
            wins=stats.wins,
            losses=stats.losses,
            win_rate=stats.win_rate,
            profit_factor=stats.profit_factor,
            total_pnl_krw=stats.total_pnl_krw,
            max_drawdown=stats.max_drawdown_pct,
        )

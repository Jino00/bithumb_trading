# 적응 효과성 추적기 — 적응 전후 성과를 비교해 실제 개선 여부를 측정한다.
"""
흐름:
  1. 적응 적용 직후 → snapshot_before() (현재 성과 기록)
  2. 다음 적응 사이클 시작 시 → evaluate_pending() (AFTER 스냅샷 + delta 계산)
  3. delta 결과 → LearningLog.save_memory()로 장기 기억에 축적
"""
import logging
from typing import Any, Dict, List, Optional

import config
from learning.learning_log import LearningLog

logger = logging.getLogger(__name__)


class EffectivenessTracker:
    """적응 전후 성과를 비교해 효과를 측정한다."""

    def __init__(self, learning_log: LearningLog) -> None:
        self.learning_log = learning_log

    def snapshot_before(
        self,
        adaptation_id: int,
        coin: Optional[str],
        trades: List[Dict[str, Any]],
    ) -> None:
        """적응 적용 직후, 현재 성과를 BEFORE 스냅샷으로 저장한다."""
        stats = self._compute_stats(trades)
        self.learning_log.save_effectiveness_snapshot(
            adaptation_id=adaptation_id,
            coin=coin,
            snapshot_type="BEFORE",
            **stats,
        )
        logger.debug(
            f"[Effectiveness] BEFORE 스냅샷 저장: "
            f"adaptation_id={adaptation_id} win_rate={stats['win_rate']:.1f}%"
        )

    def evaluate_pending(
        self,
        coin: Optional[str],
        trades: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        AFTER 스냅샷이 없는 적응들을 평가한다.

        Returns:
            평가된 적응 결과 리스트 (adaptation_id, delta_win_rate, effective)
        """
        pending = self.learning_log.get_unevaluated_adaptations(coin)
        if not pending:
            return []

        current_stats = self._compute_stats(trades)
        results = []

        for adaptation in pending:
            aid = adaptation["id"]

            # 최소 거래 수 체크
            if current_stats["window_trades"] < config.EFFECTIVENESS_MIN_TRADES_AFTER:
                logger.debug(
                    f"[Effectiveness] adaptation_id={aid}: "
                    f"거래 {current_stats['window_trades']}건 < "
                    f"{config.EFFECTIVENESS_MIN_TRADES_AFTER}건 — 보류"
                )
                continue

            # AFTER 스냅샷 저장
            self.learning_log.save_effectiveness_snapshot(
                adaptation_id=aid,
                coin=coin,
                snapshot_type="AFTER",
                **current_stats,
            )

            # BEFORE vs AFTER 비교
            result = self._evaluate_single(aid, current_stats)
            if result:
                results.append(result)

        return results

    def _evaluate_single(
        self, adaptation_id: int, after_stats: dict
    ) -> Optional[Dict[str, Any]]:
        """단일 적응의 BEFORE vs AFTER를 비교한다."""
        snapshots = self.learning_log.get_effectiveness_snapshots(adaptation_id)
        before = snapshots.get("BEFORE")
        if not before:
            return None

        delta_wr = after_stats["win_rate"] - before["win_rate"]
        delta_pf = after_stats["profit_factor"] - before["profit_factor"]

        effective = delta_wr >= config.EFFECTIVENESS_GOOD_DELTA
        ineffective = delta_wr <= config.EFFECTIVENESS_BAD_DELTA

        label = "효과적" if effective else ("비효과적" if ineffective else "보통")
        logger.info(
            f"[Effectiveness] adaptation_id={adaptation_id}: "
            f"승률 {before['win_rate']:.1f}% → {after_stats['win_rate']:.1f}% "
            f"(Δ={delta_wr:+.1f}%p) | {label}"
        )

        return {
            "adaptation_id": adaptation_id,
            "before_win_rate": before["win_rate"],
            "after_win_rate": after_stats["win_rate"],
            "delta_win_rate": round(delta_wr, 2),
            "delta_profit_factor": round(delta_pf, 3),
            "effective": effective,
            "ineffective": ineffective,
        }

    @staticmethod
    def _compute_stats(trades: List[Dict[str, Any]]) -> dict:
        """거래 목록에서 성과 통계를 계산한다."""
        valid = [t for t in trades if t.get("pnl_pct") is not None]
        if not valid:
            return {
                "window_trades": 0,
                "win_rate": 0.0,
                "profit_factor": 0.0,
                "avg_pnl_pct": 0.0,
            }

        wins = sum(1 for t in valid if t["pnl_pct"] > 0)
        gross_p = sum(t["pnl_pct"] for t in valid if t["pnl_pct"] > 0)
        gross_l = abs(sum(t["pnl_pct"] for t in valid if t["pnl_pct"] <= 0))
        avg_pnl = sum(t["pnl_pct"] for t in valid) / len(valid)

        return {
            "window_trades": len(valid),
            "win_rate": round(wins / len(valid) * 100, 2),
            "profit_factor": round(gross_p / gross_l, 3) if gross_l > 0 else 999.0,
            "avg_pnl_pct": round(avg_pnl, 4),
        }

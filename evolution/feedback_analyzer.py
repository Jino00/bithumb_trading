# 실전 피드백 분석기 — 진화된 파라미터의 실전 성과를 평가하고 최적화 우선순위를 제안한다.
import json
import logging
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import config

logger = logging.getLogger(__name__)


class FeedbackAnalyzer:
    """실전 거래 결과를 분석하여 진화 엔진에 피드백을 제공한다."""

    def __init__(
        self,
        db_path: str = config.DB_PATH,
        paper_state_path: str = config.DASHBOARD_PAPER_STATE_PATH,
        lookback_hours: int = config.EVOLUTION_FEEDBACK_LOOKBACK_H,
    ) -> None:
        self._db_path = db_path
        self._paper_state_path = paper_state_path
        self._lookback_h = lookback_hours

    def get_live_performance(self, strategy_id: str) -> Optional[dict]:
        """
        실전(페이퍼) 거래 결과에서 특정 전략의 성과를 추출한다.

        Returns:
            {"win_rate": float, "pf": float, "avg_pnl": float,
             "count": int, "total_return": float} 또는 None
        """
        trades = self._load_paper_trades(strategy_id)
        if not trades or len(trades) < 3:
            return None

        wins = [t for t in trades if t["pnl_pct"] > 0]
        losses = [t for t in trades if t["pnl_pct"] <= 0]
        win_rate = len(wins) / len(trades) * 100

        gross_profit = sum(t["pnl_pct"] for t in wins)
        gross_loss = abs(sum(t["pnl_pct"] for t in losses))
        pf = gross_profit / gross_loss if gross_loss > 0 else 999.0

        total_return = sum(t["pnl_pct"] for t in trades)
        avg_pnl = total_return / len(trades)

        return {
            "win_rate": win_rate,
            "pf": min(pf, 5.0),
            "avg_pnl": avg_pnl,
            "count": len(trades),
            "total_return": total_return,
        }

    def compute_drift(
        self, strategy_id: str, expected_score: float
    ) -> float:
        """
        백테스트 예상 점수와 실전 성과의 괴리를 계산한다.

        Returns:
            drift 값 (0.0 = 일치, >0.3 = 과적합 의심)
        """
        live = self.get_live_performance(strategy_id)
        if not live or live["count"] < 5:
            return 0.0  # 데이터 부족 → drift 판단 보류

        # 간이 robust_score 계산 (실전 데이터 기반)
        wr = live["win_rate"]
        pf = min(live["pf"], 5)
        avg_pnl = live.get("avg_pnl", 0)
        total_ret = live.get("total_return", 0)

        ret_score = total_ret * 2.0 if total_ret > 0 else total_ret * 3.0
        pnl_bonus = max(0, avg_pnl) * 5.0

        live_score = (
            wr * 0.20
            + pf * 10 * 0.20
            + ret_score * 0.35
            + pnl_bonus * 0.15
        )
        if live["count"] >= 20:
            live_score *= 1.1

        if abs(expected_score) < 1.0:
            return 0.0

        drift = abs(expected_score - live_score) / abs(expected_score)
        return min(drift, 1.0)

    def suggest_priority(self) -> list[str]:
        """
        최적화 우선순위를 제안한다.

        기준:
          1) 실전 성과가 나쁜 전략 우선
          2) 오래 최적화하지 않은 전략 우선
          3) 기본 라운드로빈
        """
        from evolution.param_space import STRATEGY_IDS

        scores: dict[str, float] = {}
        for sid in STRATEGY_IDS:
            perf = self.get_live_performance(sid)
            if perf and perf["count"] >= 3:
                # 낮은 성과 = 높은 우선순위
                scores[sid] = -(perf["total_return"])
            else:
                scores[sid] = 0.0  # 데이터 없으면 중립

        # 점수 높은 순 (= 성과 나쁜 순)
        sorted_ids = sorted(STRATEGY_IDS, key=lambda s: scores.get(s, 0),
                            reverse=True)
        return sorted_ids

    def _load_paper_trades(self, strategy_id: str) -> list[dict]:
        """paper_state.json에서 특정 전략의 거래 기록을 읽는다."""
        path = Path(self._paper_state_path)
        if not path.exists():
            return []

        try:
            data = json.loads(path.read_text())
        except Exception:
            return []

        # 멀티코인 모드: 전체 거래에서 전략 필터링
        all_trades = data.get("trades", [])
        cutoff = (datetime.now() - timedelta(hours=self._lookback_h)).isoformat()

        filtered = []
        for t in all_trades:
            # 전략 이름에 strategy_id 포함 여부로 필터
            strat = t.get("strategy", "")
            if strategy_id not in strat and strat != strategy_id:
                continue
            # 시간 범위 필터
            ts = t.get("exit_time") or t.get("entry_time", "")
            if ts < cutoff:
                continue
            if "pnl_pct" in t:
                filtered.append(t)

        return filtered

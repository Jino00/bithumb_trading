# SQLite 읽기전용 데이터 접근 계층 — 대시보드 API가 trades.db를 조회한다.
"""
WAL 모드 + query_only로 봇의 쓰기 작업과 충돌 없이 동시 읽기.
모든 쿼리는 여기에 집중하여 SQL 중복을 방지한다.
"""
import json
import logging
import sqlite3
from typing import Optional

import config

logger = logging.getLogger(__name__)


class DBReader:
    """trades.db에 대한 읽기전용 접근."""

    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = db_path or config.DB_PATH

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA query_only=ON")
        conn.execute("PRAGMA busy_timeout=3000")
        return conn

    # ── 거래 이력 ──────────────────────────────────────────────────

    def get_completed_trades(
        self,
        limit: int = 50,
        offset: int = 0,
        coin: Optional[str] = None,
        strategy: Optional[str] = None,
    ) -> dict:
        """페이지네이션 + 필터 지원 완료 거래 조회."""
        conditions = []
        params: list = []

        if coin:
            conditions.append("e.coin = ?")
            params.append(coin)
        if strategy:
            conditions.append("e.strategy_name = ?")
            params.append(strategy)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        count_sql = f"""
            SELECT COUNT(*) FROM entries e
            JOIN exits x ON e.id = x.entry_id
            {where}
        """
        data_sql = f"""
            SELECT
                e.id AS entry_id, e.timestamp AS entry_time,
                e.strategy_name, e.coin,
                e.price AS entry_price, e.amount, e.total_krw,
                e.reason AS entry_reason,
                e.rsi_value, e.volume_ratio, e.trend, e.volatility,
                e.indicators_json,
                x.timestamp AS exit_time, x.price AS exit_price,
                x.exit_reason, x.pnl_pct, x.hold_minutes
            FROM entries e
            JOIN exits x ON e.id = x.entry_id
            {where}
            ORDER BY e.id DESC
            LIMIT ? OFFSET ?
        """

        with self._conn() as conn:
            total = conn.execute(count_sql, params).fetchone()[0]
            rows = conn.execute(data_sql, [*params, limit, offset]).fetchall()

        return {
            "items": [dict(r) for r in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def get_recent_trades(self, limit: int = 20) -> list[dict]:
        """최근 N건 완료 거래."""
        sql = """
            SELECT
                e.id AS entry_id, e.timestamp AS entry_time,
                e.strategy_name, e.coin,
                e.price AS entry_price,
                x.timestamp AS exit_time, x.price AS exit_price,
                x.exit_reason, x.pnl_pct, x.hold_minutes
            FROM entries e
            JOIN exits x ON e.id = x.entry_id
            ORDER BY x.id DESC
            LIMIT ?
        """
        with self._conn() as conn:
            rows = conn.execute(sql, (limit,)).fetchall()
        return [dict(r) for r in rows]

    def get_equity_curve(self) -> list[dict]:
        """에쿼티 커브 데이터 (누적 수익률 시계열)."""
        sql = """
            SELECT x.pnl_pct, x.timestamp AS exit_time, e.coin
            FROM exits x
            JOIN entries e ON e.id = x.entry_id
            ORDER BY x.id ASC
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()

        curve = []
        equity = 1.0
        for i, r in enumerate(rows):
            equity *= 1 + r["pnl_pct"] / 100
            curve.append({
                "trade_number": i + 1,
                "equity": round(equity, 6),
                "pnl_pct": r["pnl_pct"],
                "exit_time": r["exit_time"],
                "coin": r["coin"],
            })
        return curve

    def get_trade_detail(self, trade_id: int) -> Optional[dict]:
        """단일 거래 상세 (indicators_json 포함)."""
        sql = """
            SELECT
                e.*, x.timestamp AS exit_time, x.price AS exit_price,
                x.exit_reason, x.pnl_pct, x.hold_minutes
            FROM entries e
            JOIN exits x ON e.id = x.entry_id
            WHERE e.id = ?
        """
        with self._conn() as conn:
            row = conn.execute(sql, (trade_id,)).fetchone()
        if not row:
            return None

        result = dict(row)
        if result.get("indicators_json"):
            try:
                result["indicators"] = json.loads(result["indicators_json"])
            except json.JSONDecodeError:
                result["indicators"] = {}
        return result

    # ── 분석 ──────────────────────────────────────────────────────

    def get_trade_summary(self) -> dict:
        """전체 성과 요약 통계."""
        sql = """
            SELECT
                COUNT(*) AS total_trades,
                SUM(CASE WHEN x.pnl_pct > 0 THEN 1 ELSE 0 END) AS winning,
                SUM(CASE WHEN x.pnl_pct <= 0 THEN 1 ELSE 0 END) AS losing,
                AVG(x.pnl_pct) AS avg_pnl,
                AVG(CASE WHEN x.pnl_pct > 0 THEN x.pnl_pct END) AS avg_profit,
                AVG(CASE WHEN x.pnl_pct <= 0 THEN x.pnl_pct END) AS avg_loss,
                SUM(CASE WHEN x.pnl_pct > 0 THEN x.pnl_pct ELSE 0 END) AS gross_profit,
                SUM(CASE WHEN x.pnl_pct <= 0 THEN ABS(x.pnl_pct) ELSE 0 END) AS gross_loss,
                MAX(x.pnl_pct) AS best_trade,
                MIN(x.pnl_pct) AS worst_trade,
                AVG(x.hold_minutes) AS avg_hold_minutes
            FROM exits x
        """
        with self._conn() as conn:
            row = conn.execute(sql).fetchone()

        if not row or row["total_trades"] == 0:
            return {
                "total_trades": 0, "win_rate": 0, "avg_pnl": 0,
                "avg_profit": 0, "avg_loss": 0, "profit_factor": 0,
                "best_trade": 0, "worst_trade": 0, "avg_hold_minutes": 0,
            }

        d = dict(row)
        d["win_rate"] = round(d["winning"] / d["total_trades"] * 100, 1) if d["total_trades"] else 0
        d["profit_factor"] = (
            round(d["gross_profit"] / d["gross_loss"], 2)
            if d["gross_loss"] and d["gross_loss"] > 0 else 999.0
        )
        return d

    def get_analytics_by_strategy(self) -> list[dict]:
        """전략별 성과."""
        sql = """
            SELECT
                e.strategy_name,
                COUNT(*) AS total,
                SUM(CASE WHEN x.pnl_pct > 0 THEN 1 ELSE 0 END) AS wins,
                AVG(x.pnl_pct) AS avg_pnl,
                SUM(CASE WHEN x.pnl_pct > 0 THEN x.pnl_pct ELSE 0 END) AS profit,
                SUM(CASE WHEN x.pnl_pct <= 0 THEN ABS(x.pnl_pct) ELSE 0 END) AS loss
            FROM entries e JOIN exits x ON e.id = x.entry_id
            GROUP BY e.strategy_name
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [_add_derived_fields(dict(r)) for r in rows]

    def get_analytics_by_hour(self) -> list[dict]:
        """시간대별 승률 (0-23시)."""
        sql = """
            SELECT
                CAST(strftime('%H', e.timestamp) AS INTEGER) AS hour,
                COUNT(*) AS total,
                SUM(CASE WHEN x.pnl_pct > 0 THEN 1 ELSE 0 END) AS wins,
                AVG(x.pnl_pct) AS avg_pnl
            FROM entries e JOIN exits x ON e.id = x.entry_id
            GROUP BY hour ORDER BY hour
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [_add_derived_fields(dict(r)) for r in rows]

    def get_analytics_by_rsi_bucket(self) -> list[dict]:
        """RSI 진입 존별 성과 (5단위 버킷)."""
        sql = """
            SELECT
                CAST(e.rsi_value / 5 AS INTEGER) * 5 AS rsi_bucket,
                COUNT(*) AS total,
                SUM(CASE WHEN x.pnl_pct > 0 THEN 1 ELSE 0 END) AS wins,
                AVG(x.pnl_pct) AS avg_pnl
            FROM entries e JOIN exits x ON e.id = x.entry_id
            WHERE e.rsi_value IS NOT NULL
            GROUP BY rsi_bucket ORDER BY rsi_bucket
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [_add_derived_fields(dict(r)) for r in rows]

    def get_analytics_by_trend(self) -> list[dict]:
        """추세별 성과 (UPTREND / DOWNTREND / SIDEWAYS)."""
        sql = """
            SELECT
                COALESCE(e.trend, 'UNKNOWN') AS trend,
                COUNT(*) AS total,
                SUM(CASE WHEN x.pnl_pct > 0 THEN 1 ELSE 0 END) AS wins,
                AVG(x.pnl_pct) AS avg_pnl
            FROM entries e JOIN exits x ON e.id = x.entry_id
            GROUP BY trend
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [_add_derived_fields(dict(r)) for r in rows]

    def get_analytics_by_volatility(self) -> list[dict]:
        """변동성별 성과 (HIGH / MEDIUM / LOW)."""
        sql = """
            SELECT
                COALESCE(e.volatility, 'UNKNOWN') AS volatility,
                COUNT(*) AS total,
                SUM(CASE WHEN x.pnl_pct > 0 THEN 1 ELSE 0 END) AS wins,
                AVG(x.pnl_pct) AS avg_pnl
            FROM entries e JOIN exits x ON e.id = x.entry_id
            GROUP BY volatility
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [_add_derived_fields(dict(r)) for r in rows]

    def get_exit_patterns(self) -> list[dict]:
        """청산 사유별 분포."""
        sql = """
            SELECT
                CASE
                    WHEN x.exit_reason LIKE '%손절%' OR x.exit_reason LIKE '%STOP%' THEN 'STOP_LOSS'
                    WHEN x.exit_reason LIKE '%익절%' OR x.exit_reason LIKE '%TAKE%' THEN 'TAKE_PROFIT'
                    WHEN x.exit_reason LIKE '%RSI%' OR x.exit_reason LIKE '%과매수%' THEN 'RSI_SIGNAL'
                    ELSE 'OTHER'
                END AS exit_type,
                COUNT(*) AS total,
                AVG(x.pnl_pct) AS avg_pnl
            FROM exits x
            GROUP BY exit_type
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    def get_pnl_distribution(self) -> list[dict]:
        """P&L 분포 히스토그램 (1% 단위 버킷)."""
        sql = """
            SELECT
                CAST(x.pnl_pct AS INTEGER) AS bucket,
                COUNT(*) AS count
            FROM exits x
            GROUP BY bucket ORDER BY bucket
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    # ── 이벤트 ────────────────────────────────────────────────────

    def get_events(
        self,
        limit: int = 50,
        event_type: Optional[str] = None,
        coin: Optional[str] = None,
    ) -> list[dict]:
        """시스템 이벤트 로그."""
        conditions = []
        params: list = []

        if event_type:
            conditions.append("event_type = ?")
            params.append(event_type)
        if coin:
            conditions.append("coin = ?")
            params.append(coin)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"SELECT * FROM events {where} ORDER BY id DESC LIMIT ?"
        params.append(limit)

        try:
            with self._conn() as conn:
                rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]
        except sqlite3.OperationalError:
            return []


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _add_derived_fields(d: dict) -> dict:
    """total/wins 필드에서 win_rate, profit_factor를 계산."""
    total = d.get("total", 0)
    wins = d.get("wins", 0)
    d["win_rate"] = round(wins / total * 100, 1) if total else 0.0

    profit = d.get("profit", 0) or 0
    loss = d.get("loss", 0) or 0
    d["profit_factor"] = round(profit / loss, 2) if loss > 0 else 999.0

    return d

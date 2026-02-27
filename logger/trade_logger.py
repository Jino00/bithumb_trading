"""
거래 로거 — 예외 없이 모든 거래·이벤트를 SQLite에 기록한다.

테이블 구조:
  entries  — 매수 진입 기록 (전략명, 매매 이유, 지표 스냅샷, 시장 컨텍스트)
  exits    — 매도/청산 기록 (청산 이유, 수익률, 보유 시간)
  events   — 시스템 이벤트 (오류, MDD 초과 등)
"""
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,
    strategy_name   TEXT    NOT NULL,
    coin            TEXT    NOT NULL,
    price           REAL    NOT NULL,
    amount          REAL    NOT NULL,
    total_krw       REAL    NOT NULL,
    reason          TEXT,               -- 자연어 매수 이유
    rsi_value       REAL,               -- 진입 시 RSI
    volume_ratio    REAL,               -- 현재 거래량 / 20봉 평균 거래량
    trend           TEXT,               -- UPTREND / DOWNTREND / SIDEWAYS
    volatility      TEXT,               -- HIGH / MEDIUM / LOW
    indicators_json TEXT,               -- 전체 지표 스냅샷 (JSON)
    result_raw      TEXT,               -- API 응답 JSON
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS exits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id        INTEGER NOT NULL REFERENCES entries(id),
    timestamp       TEXT    NOT NULL,
    coin            TEXT    NOT NULL,
    price           REAL    NOT NULL,
    amount          REAL    NOT NULL,
    exit_reason     TEXT,               -- 자연어 청산 이유
    pnl_pct         REAL,               -- 수익률 %
    hold_minutes    REAL,               -- 보유 시간 (분)
    result_raw      TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,
    event_type      TEXT    NOT NULL,   -- ERROR / MDD_EXCEEDED / GATE_FAIL / ...
    coin            TEXT,
    detail          TEXT,               -- JSON
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);
"""


class TradeLogger:
    def __init__(self, db_path: str) -> None:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._init_db()
        logger.info(f"TradeLogger 초기화: {db_path}")

    # ── 연결 & 초기화 ──────────────────────────────────────

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(_CREATE_SQL)

    # ── 진입 기록 ──────────────────────────────────────────

    def log_entry(
        self,
        strategy_name: str,
        coin: str,
        price: float,
        amount: float,
        reason: str = "",
        rsi_value: Optional[float] = None,
        volume_ratio: Optional[float] = None,
        trend: Optional[str] = None,
        volatility: Optional[str] = None,
        indicators: Optional[dict] = None,
        result: Optional[Any] = None,
    ) -> int:
        """
        매수 진입을 entries 테이블에 저장한다.

        Returns:
            생성된 entry_id (청산 시 참조용)
        """
        ts = datetime.now().isoformat(timespec="seconds")
        total_krw = price * amount
        ind_json = json.dumps(indicators or {}, ensure_ascii=False, default=str)
        res_raw = json.dumps(result, ensure_ascii=False, default=str) if result else None

        try:
            with self._conn() as conn:
                cur = conn.execute(
                    """INSERT INTO entries
                       (timestamp, strategy_name, coin, price, amount, total_krw,
                        reason, rsi_value, volume_ratio, trend, volatility,
                        indicators_json, result_raw)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (ts, strategy_name, coin, price, amount, total_krw,
                     reason, rsi_value, volume_ratio, trend, volatility,
                     ind_json, res_raw),
                )
                entry_id = cur.lastrowid
            logger.info(
                f"[ENTRY #{entry_id}] BUY {coin} "
                f"price={price:,.0f} amount={amount:.8f} | {reason}"
            )
            return entry_id
        except Exception as e:
            logger.error(f"진입 로그 저장 실패: {e}")
            return -1

    # ── 청산 기록 ──────────────────────────────────────────

    def log_exit(
        self,
        entry_id: int,
        coin: str,
        price: float,
        amount: float,
        exit_reason: str = "",
        pnl_pct: float = 0.0,
        hold_minutes: float = 0.0,
        result: Optional[Any] = None,
    ) -> None:
        """매도/청산을 exits 테이블에 저장한다."""
        ts = datetime.now().isoformat(timespec="seconds")
        res_raw = json.dumps(result, ensure_ascii=False, default=str) if result else None

        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO exits
                       (entry_id, timestamp, coin, price, amount,
                        exit_reason, pnl_pct, hold_minutes, result_raw)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (entry_id, ts, coin, price, amount,
                     exit_reason, pnl_pct, hold_minutes, res_raw),
                )
            emoji = "✓" if pnl_pct >= 0 else "✗"
            logger.info(
                f"[EXIT #{entry_id}] {emoji} SELL {coin} "
                f"price={price:,.0f} pnl={pnl_pct:+.2f}% "
                f"hold={hold_minutes:.0f}m | {exit_reason}"
            )
        except Exception as e:
            logger.error(f"청산 로그 저장 실패: {e}")

    # ── 이벤트 기록 ────────────────────────────────────────

    def log_event(
        self,
        event_type: str,
        coin: Optional[str] = None,
        detail: Optional[dict] = None,
    ) -> None:
        """시스템 이벤트(오류, MDD 초과 등)를 events 테이블에 저장한다."""
        ts = datetime.now().isoformat(timespec="seconds")
        detail_str = json.dumps(detail or {}, ensure_ascii=False, default=str)

        try:
            with self._conn() as conn:
                conn.execute(
                    "INSERT INTO events (timestamp, event_type, coin, detail) VALUES (?,?,?,?)",
                    (ts, event_type, coin, detail_str),
                )
            logger.info(f"[EVENT] {event_type} coin={coin} | {detail_str}")
        except Exception as e:
            logger.error(f"이벤트 로그 저장 실패: {e}")

    # ── 조회 메서드 ────────────────────────────────────────

    def get_completed_trades(self) -> list:
        """
        진입+청산이 완료된 모든 거래를 반환한다 (분석용).
        entries JOIN exits
        """
        sql = """
            SELECT
                e.id          AS entry_id,
                e.timestamp   AS entry_time,
                e.strategy_name,
                e.coin,
                e.price       AS entry_price,
                e.amount,
                e.total_krw,
                e.reason      AS entry_reason,
                e.rsi_value,
                e.volume_ratio,
                e.trend,
                e.volatility,
                e.indicators_json,
                x.timestamp   AS exit_time,
                x.price       AS exit_price,
                x.exit_reason,
                x.pnl_pct,
                x.hold_minutes
            FROM entries e
            JOIN exits x ON e.id = x.entry_id
            ORDER BY e.id ASC
        """
        with self._conn() as conn:
            rows = conn.execute(sql).fetchall()
        return [dict(r) for r in rows]

    def get_open_entry(self, coin: str) -> Optional[dict]:
        """
        미청산 진입 포지션 조회 (봇 재시작 시 복구용).
        가장 최근 진입 중 exits 레코드가 없는 것을 반환한다.
        """
        sql = """
            SELECT e.*
            FROM entries e
            LEFT JOIN exits x ON e.id = x.entry_id
            WHERE e.coin = ? AND x.id IS NULL
            ORDER BY e.id DESC
            LIMIT 1
        """
        with self._conn() as conn:
            row = conn.execute(sql, (coin,)).fetchone()
        return dict(row) if row else None

    def get_recent_completed(self, limit: int = 20) -> list:
        """최근 N건의 완료된 거래 (승률 모니터링용)"""
        sql = """
            SELECT x.pnl_pct, x.exit_reason, e.strategy_name,
                   e.coin, e.timestamp AS entry_time
            FROM exits x
            JOIN entries e ON e.id = x.entry_id
            ORDER BY x.id DESC
            LIMIT ?
        """
        with self._conn() as conn:
            rows = conn.execute(sql, (limit,)).fetchall()
        return [dict(r) for r in rows]

    def get_all_events(self, event_type: Optional[str] = None) -> list:
        """이벤트 조회"""
        if event_type:
            sql = "SELECT * FROM events WHERE event_type=? ORDER BY id DESC"
            params = (event_type,)
        else:
            sql = "SELECT * FROM events ORDER BY id DESC"
            params = ()
        with self._conn() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    # ── 하위 호환 래퍼 ─────────────────────────────────────
    # main.py 구버전 호출 호환용

    def log_trade(
        self,
        side: str,
        coin: str,
        price: float,
        amount: float,
        result: Optional[Any] = None,
        **kwargs,
    ) -> None:
        """log_entry / log_exit의 하위 호환 래퍼 (신규 코드에서는 직접 호출 권장)"""
        if side == "BUY":
            self.log_entry(
                strategy_name=kwargs.get("strategy_name", "unknown"),
                coin=coin,
                price=price,
                amount=amount,
                reason=kwargs.get("reason", ""),
                result=result,
            )
        elif side == "SELL":
            entry_id = kwargs.get("entry_id", -1)
            self.log_exit(
                entry_id=entry_id,
                coin=coin,
                price=price,
                amount=amount,
                exit_reason=kwargs.get("reason", ""),
                pnl_pct=kwargs.get("pnl_pct", 0.0),
                hold_minutes=kwargs.get("hold_minutes", 0.0),
                result=result,
            )

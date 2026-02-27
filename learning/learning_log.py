# 학습 로그 — 모든 적응 결정을 SQLite에 기록한다 (감사 추적용).
"""
테이블:
  adaptations — 적응 이력 (유형, 사유, 이전값, 이후값, 게이트 결과, 적용 여부)
"""
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS adaptations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,
    adaptation_type TEXT    NOT NULL,
    coin            TEXT,
    trigger_reason  TEXT    NOT NULL,
    before_value    TEXT,
    after_value     TEXT,
    gate_passed     INTEGER NOT NULL,
    gate_detail     TEXT,
    applied         INTEGER NOT NULL,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);
"""


class LearningLog:
    """적응 결정을 trades.db의 adaptations 테이블에 기록한다."""

    def __init__(self, db_path: str) -> None:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._init_db()
        logger.info(f"LearningLog 초기화: {db_path}")

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(_CREATE_SQL)

    def log_adaptation(
        self,
        adaptation_type: str,
        trigger_reason: str,
        before_value: dict,
        after_value: dict,
        gate_passed: bool,
        applied: bool,
        coin: Optional[str] = None,
        gate_detail: Optional[dict] = None,
    ) -> int:
        """
        적응 결정을 기록한다.

        Args:
            adaptation_type: PARAM_TUNE | TIME_FILTER | TREND_FILTER | POSITION_SIZE
            trigger_reason:  자연어 사유
            before_value:    변경 전 값 (dict → JSON)
            after_value:     변경 후 값 (dict → JSON)
            gate_passed:     StrategyGate 통과 여부
            applied:         실제 적용 여부
            coin:            대상 코인
            gate_detail:     게이트 상세 결과

        Returns:
            생성된 adaptation ID
        """
        ts = datetime.now().isoformat(timespec="seconds")
        before_json = json.dumps(before_value, ensure_ascii=False, default=str)
        after_json = json.dumps(after_value, ensure_ascii=False, default=str)
        gate_json = json.dumps(gate_detail or {}, ensure_ascii=False, default=str)

        try:
            with self._conn() as conn:
                cur = conn.execute(
                    """INSERT INTO adaptations
                       (timestamp, adaptation_type, coin, trigger_reason,
                        before_value, after_value, gate_passed, gate_detail, applied)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (ts, adaptation_type, coin, trigger_reason,
                     before_json, after_json, int(gate_passed), gate_json, int(applied)),
                )
                aid = cur.lastrowid
            status = "적용" if applied else "미적용"
            logger.info(
                f"[LearningLog #{aid}] {adaptation_type} {status} | {trigger_reason}"
            )
            return aid
        except Exception as e:
            logger.error(f"적응 로그 저장 실패: {e}")
            return -1

    def get_recent_adaptations(self, limit: int = 20) -> list:
        """최근 N건의 적응 이력을 반환한다."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM adaptations ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def get_adaptations_by_type(self, adaptation_type: str) -> list:
        """특정 유형의 적응 이력을 반환한다."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM adaptations WHERE adaptation_type=? ORDER BY id DESC",
                (adaptation_type,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_applied_count(self) -> int:
        """실제 적용된 적응 총 건수."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM adaptations WHERE applied=1"
            ).fetchone()
        return row["cnt"] if row else 0

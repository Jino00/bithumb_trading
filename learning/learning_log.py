# 학습 로그 — 모든 적응 결정을 SQLite에 기록한다 (감사 추적용).
"""
테이블:
  adaptations              — 적응 이력 (유형, 사유, 이전값, 이후값, 게이트 결과, 적용 여부)
  adaptive_state           — 코인별 적응 상태 영속화 (재시작 시 복원)
  adaptation_effectiveness — 적응 전후 성과 비교 (BEFORE/AFTER 스냅샷)
  adaptation_memory        — 장기 기억 (뭐가 효과적이었나)
"""
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

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

CREATE TABLE IF NOT EXISTS adaptive_state (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    coin        TEXT    NOT NULL UNIQUE,
    state_json  TEXT    NOT NULL,
    updated_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS adaptation_effectiveness (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    adaptation_id   INTEGER NOT NULL,
    coin            TEXT,
    snapshot_type   TEXT    NOT NULL,
    window_trades   INTEGER,
    win_rate        REAL,
    profit_factor   REAL,
    avg_pnl_pct     REAL,
    measured_at     TEXT    NOT NULL,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS adaptation_memory (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    coin                TEXT,
    adaptation_type     TEXT    NOT NULL,
    parameter_key       TEXT    NOT NULL,
    value_json          TEXT    NOT NULL,
    effectiveness_score REAL    NOT NULL,
    times_applied       INTEGER DEFAULT 1,
    times_effective     INTEGER DEFAULT 0,
    last_applied_at     TEXT,
    created_at          TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(coin, adaptation_type, parameter_key)
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

    # ── 상태 영속화 (Phase 1) ─────────────────────────────────

    def save_state(self, coin: str, state_dict: dict) -> None:
        """코인별 AdaptiveState를 DB에 저장한다 (UPSERT)."""
        state_json = json.dumps(state_dict, ensure_ascii=False, default=str)
        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO adaptive_state (coin, state_json, updated_at)
                       VALUES (?, ?, datetime('now','localtime'))
                       ON CONFLICT(coin) DO UPDATE SET
                           state_json = excluded.state_json,
                           updated_at = excluded.updated_at""",
                    (coin, state_json),
                )
            logger.info(f"[LearningLog] 상태 저장 완료: {coin}")
        except Exception as e:
            logger.error(f"[LearningLog] 상태 저장 실패 ({coin}): {e}")

    def load_state(self, coin: str) -> Optional[dict]:
        """코인별 AdaptiveState를 DB에서 불러온다."""
        try:
            with self._conn() as conn:
                row = conn.execute(
                    "SELECT state_json FROM adaptive_state WHERE coin=?",
                    (coin,),
                ).fetchone()
            if row:
                state = json.loads(row["state_json"])
                logger.info(f"[LearningLog] 상태 복원 완료: {coin}")
                return state
            return None
        except Exception as e:
            logger.error(f"[LearningLog] 상태 복원 실패 ({coin}): {e}")
            return None

    # ── 효과성 추적 (Phase 4) ─────────────────────────────────

    def save_effectiveness_snapshot(
        self,
        adaptation_id: int,
        coin: Optional[str],
        snapshot_type: str,
        window_trades: int,
        win_rate: float,
        profit_factor: float,
        avg_pnl_pct: float,
    ) -> None:
        """적응 전후 성과 스냅샷을 저장한다."""
        ts = datetime.now().isoformat(timespec="seconds")
        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO adaptation_effectiveness
                       (adaptation_id, coin, snapshot_type, window_trades,
                        win_rate, profit_factor, avg_pnl_pct, measured_at)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (adaptation_id, coin, snapshot_type, window_trades,
                     win_rate, profit_factor, avg_pnl_pct, ts),
                )
            logger.debug(
                f"[LearningLog] 효과성 스냅샷 저장: "
                f"adaptation_id={adaptation_id} type={snapshot_type}"
            )
        except Exception as e:
            logger.error(f"[LearningLog] 효과성 스냅샷 저장 실패: {e}")

    def get_effectiveness_snapshots(
        self, adaptation_id: int
    ) -> dict[str, Any]:
        """특정 적응의 BEFORE/AFTER 스냅샷을 반환한다."""
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT * FROM adaptation_effectiveness
                   WHERE adaptation_id=? ORDER BY snapshot_type""",
                (adaptation_id,),
            ).fetchall()
        result: dict[str, Any] = {}
        for r in rows:
            result[r["snapshot_type"]] = dict(r)
        return result

    def get_unevaluated_adaptations(self, coin: Optional[str] = None) -> list:
        """AFTER 스냅샷이 없는 적용된 적응 목록을 반환한다."""
        query = """
            SELECT a.* FROM adaptations a
            LEFT JOIN adaptation_effectiveness ae
                ON a.id = ae.adaptation_id AND ae.snapshot_type = 'AFTER'
            WHERE a.applied = 1
                AND ae.id IS NULL
        """
        params: list = []
        if coin:
            query += " AND a.coin = ?"
            params.append(coin)
        query += " ORDER BY a.id DESC"
        with self._conn() as conn:
            rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

    # ── 장기 기억 (Phase 5) ───────────────────────────────────

    def save_memory(
        self,
        coin: Optional[str],
        adaptation_type: str,
        parameter_key: str,
        value_json: str,
        effectiveness_score: float,
    ) -> None:
        """적응 결과를 장기 기억에 저장한다 (UPSERT)."""
        ts = datetime.now().isoformat(timespec="seconds")
        is_effective = 1 if effectiveness_score > 0 else 0
        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO adaptation_memory
                       (coin, adaptation_type, parameter_key, value_json,
                        effectiveness_score, times_applied, times_effective,
                        last_applied_at)
                       VALUES (?,?,?,?,?,1,?,?)
                       ON CONFLICT(coin, adaptation_type, parameter_key)
                       DO UPDATE SET
                           value_json = excluded.value_json,
                           effectiveness_score = (
                               adaptation_memory.effectiveness_score * 0.7
                               + excluded.effectiveness_score * 0.3
                           ),
                           times_applied = adaptation_memory.times_applied + 1,
                           times_effective = adaptation_memory.times_effective
                               + excluded.times_effective,
                           last_applied_at = excluded.last_applied_at""",
                    (coin, adaptation_type, parameter_key, value_json,
                     effectiveness_score, is_effective, ts),
                )
        except Exception as e:
            logger.error(f"[LearningLog] 장기 기억 저장 실패: {e}")

    def get_memory(
        self,
        coin: Optional[str],
        adaptation_type: str,
        parameter_key: str,
    ) -> Optional[dict]:
        """특정 적응의 장기 기억을 조회한다."""
        with self._conn() as conn:
            row = conn.execute(
                """SELECT * FROM adaptation_memory
                   WHERE coin=? AND adaptation_type=? AND parameter_key=?""",
                (coin, adaptation_type, parameter_key),
            ).fetchone()
        return dict(row) if row else None

    def should_try_adaptation(
        self,
        coin: Optional[str],
        adaptation_type: str,
        parameter_key: str,
        min_success_rate: float = 0.3,
    ) -> bool:
        """과거 기억 기반으로 이 적응을 시도할지 판단한다."""
        memory = self.get_memory(coin, adaptation_type, parameter_key)
        if not memory or memory["times_applied"] < 3:
            return True  # 데이터 부족 → 시도 허용
        success_rate = memory["times_effective"] / memory["times_applied"]
        if success_rate < min_success_rate:
            logger.info(
                f"[LearningLog] 장기 기억 스킵: {adaptation_type}/{parameter_key} "
                f"성공률={success_rate:.0%} < {min_success_rate:.0%}"
            )
            return False
        return True

    def get_effective_adaptations(
        self, coin: Optional[str] = None, min_score: float = 0.0
    ) -> list:
        """효과적이었던 적응 기억 목록을 반환한다."""
        query = """SELECT * FROM adaptation_memory
                   WHERE effectiveness_score > ?"""
        params: list = [min_score]
        if coin:
            query += " AND coin = ?"
            params.append(coin)
        query += " ORDER BY effectiveness_score DESC"
        with self._conn() as conn:
            rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]

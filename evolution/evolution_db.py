# 진화 엔진 DB 래퍼 — evolved_params / evolution_history / evolution_state 테이블 접근.
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


_EVOLUTION_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS evolved_params (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id     TEXT    NOT NULL,
    coin            TEXT,
    regime          TEXT,
    params_json     TEXT    NOT NULL,
    robust_score    REAL    NOT NULL,
    baseline_score  REAL    NOT NULL,
    improvement_pct REAL    NOT NULL,
    validated       INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(strategy_id, coin, regime)
);

CREATE TABLE IF NOT EXISTS evolution_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id     TEXT    NOT NULL,
    coin            TEXT,
    regime          TEXT,
    candidate_json  TEXT    NOT NULL,
    baseline_json   TEXT    NOT NULL,
    candidate_score REAL,
    baseline_score  REAL,
    improvement_pct REAL,
    validated       INTEGER NOT NULL DEFAULT 0,
    applied         INTEGER NOT NULL DEFAULT 0,
    fail_reason     TEXT,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS evolution_state (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    state_json TEXT    NOT NULL,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
"""


class EvolutionDB:
    """진화 엔진 전용 SQLite 읽기/쓰기 클래스."""

    def __init__(self, db_path: str) -> None:
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._init_tables()

    def _init_tables(self) -> None:
        """진화 테이블이 없으면 자동 생성한다."""
        try:
            conn = sqlite3.connect(self._db_path)
            conn.executescript(_EVOLUTION_TABLES_SQL)
            conn.close()
        except Exception as e:
            logger.error(f"[EvoDB] 테이블 생성 실패: {e}")

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # ── evolved_params (현재 활성 파라미터) ─────────────────

    def save_evolved(
        self,
        strategy_id: str,
        params: dict,
        score: float,
        baseline_score: float,
        coin: Optional[str] = None,
        regime: Optional[str] = None,
    ) -> int:
        """
        진화된 파라미터를 저장한다 (UPSERT).

        같은 (strategy_id, coin, regime) 조합이면 덮어쓴다.
        """
        params_json = json.dumps(params, ensure_ascii=False)
        improvement = ((score - baseline_score) / abs(baseline_score) * 100
                       if baseline_score != 0 else 0.0)
        # SQLite에서 NULL != NULL이므로 UNIQUE 제약에 빈 문자열 사용
        coin_key = coin or ""
        regime_key = regime or ""
        try:
            with self._conn() as conn:
                cur = conn.execute(
                    """INSERT INTO evolved_params
                       (strategy_id, coin, regime, params_json,
                        robust_score, baseline_score, improvement_pct,
                        validated, active)
                       VALUES (?,?,?,?,?,?,?,1,1)
                       ON CONFLICT(strategy_id, coin, regime) DO UPDATE SET
                           params_json = excluded.params_json,
                           robust_score = excluded.robust_score,
                           baseline_score = excluded.baseline_score,
                           improvement_pct = excluded.improvement_pct,
                           validated = excluded.validated,
                           active = excluded.active,
                           created_at = datetime('now','localtime')""",
                    (strategy_id, coin_key, regime_key, params_json,
                     score, baseline_score, improvement),
                )
                row_id = cur.lastrowid
            logger.info(
                f"[EvoDB] 진화 파라미터 저장: {strategy_id} "
                f"score={score:.1f} (+{improvement:.1f}%)"
            )
            return row_id
        except Exception as e:
            logger.error(f"[EvoDB] 파라미터 저장 실패: {e}")
            return -1

    def load_evolved(
        self,
        strategy_id: str,
        coin: Optional[str] = None,
        regime: Optional[str] = None,
    ) -> Optional[dict]:
        """활성 진화 파라미터를 읽는다. 없으면 None."""
        try:
            with self._conn() as conn:
                # 코인+레짐 특화 우선
                if coin and regime:
                    row = conn.execute(
                        """SELECT params_json FROM evolved_params
                           WHERE strategy_id=? AND coin=? AND regime=?
                           AND active=1 AND validated=1""",
                        (strategy_id, coin, regime),
                    ).fetchone()
                    if row:
                        return json.loads(row["params_json"])

                # 글로벌 (coin='', regime='') 폴백
                row = conn.execute(
                    """SELECT params_json FROM evolved_params
                       WHERE strategy_id=? AND coin='' AND regime=''
                       AND active=1 AND validated=1""",
                    (strategy_id,),
                ).fetchone()
                if row:
                    return json.loads(row["params_json"])
        except Exception as e:
            logger.error(f"[EvoDB] 파라미터 읽기 실패: {e}")
        return None

    def deactivate(
        self,
        strategy_id: str,
        coin: Optional[str] = None,
        regime: Optional[str] = None,
    ) -> None:
        """진화 파라미터를 비활성화한다 (롤백 시 사용)."""
        try:
            coin_key = coin or ""
            with self._conn() as conn:
                if coin:
                    conn.execute(
                        """UPDATE evolved_params SET active=0
                           WHERE strategy_id=? AND coin=?""",
                        (strategy_id, coin_key),
                    )
                else:
                    conn.execute(
                        """UPDATE evolved_params SET active=0
                           WHERE strategy_id=? AND coin=''""",
                        (strategy_id,),
                    )
            logger.info(f"[EvoDB] 파라미터 비활성화: {strategy_id} coin={coin}")
        except Exception as e:
            logger.error(f"[EvoDB] 비활성화 실패: {e}")

    def list_active(self) -> list[dict[str, Any]]:
        """모든 활성 진화 파라미터를 반환한다."""
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT strategy_id, coin, regime, params_json,
                              robust_score, baseline_score, improvement_pct,
                              created_at
                       FROM evolved_params WHERE active=1 AND validated=1
                       ORDER BY strategy_id"""
                ).fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []

    # ── evolution_history (전체 이력) ──────────────────────

    def save_history(
        self,
        strategy_id: str,
        candidate_params: dict,
        baseline_params: dict,
        candidate_score: float,
        baseline_score: float,
        validated: bool,
        applied: bool,
        fail_reason: Optional[str] = None,
        coin: Optional[str] = None,
        regime: Optional[str] = None,
    ) -> None:
        """진화 시도를 이력에 기록한다."""
        improvement = ((candidate_score - baseline_score) / abs(baseline_score) * 100
                       if baseline_score != 0 else 0.0)
        try:
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO evolution_history
                       (strategy_id, coin, regime, candidate_json, baseline_json,
                        candidate_score, baseline_score, improvement_pct,
                        validated, applied, fail_reason)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (strategy_id, coin, regime,
                     json.dumps(candidate_params, ensure_ascii=False),
                     json.dumps(baseline_params, ensure_ascii=False),
                     candidate_score, baseline_score, improvement,
                     int(validated), int(applied), fail_reason),
                )
        except Exception as e:
            logger.error(f"[EvoDB] 이력 저장 실패: {e}")

    def get_history(self, strategy_id: str, limit: int = 20) -> list[dict]:
        """특정 전략의 최근 진화 이력."""
        try:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT * FROM evolution_history
                       WHERE strategy_id=? ORDER BY id DESC LIMIT ?""",
                    (strategy_id, limit),
                ).fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []

    # ── evolution_state (엔진 상태 영속화) ─────────────────

    def save_state(self, state_dict: dict) -> None:
        """진화 엔진 상태를 저장한다."""
        try:
            state_json = json.dumps(state_dict, ensure_ascii=False, default=str)
            with self._conn() as conn:
                conn.execute(
                    """INSERT INTO evolution_state (state_json)
                       VALUES (?)""",
                    (state_json,),
                )
        except Exception as e:
            logger.error(f"[EvoDB] 상태 저장 실패: {e}")

    def load_state(self) -> Optional[dict]:
        """가장 최근 엔진 상태를 불러온다."""
        try:
            with self._conn() as conn:
                row = conn.execute(
                    """SELECT state_json FROM evolution_state
                       ORDER BY id DESC LIMIT 1"""
                ).fetchone()
            if row:
                return json.loads(row["state_json"])
        except Exception as e:
            logger.error(f"[EvoDB] 상태 읽기 실패: {e}")
        return None

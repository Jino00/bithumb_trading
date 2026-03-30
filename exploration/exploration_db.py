"""탐색 변형 DB — 변형 생성/추적/승격 이력을 SQLite에 영속 저장."""
import json
import sqlite3
from datetime import datetime
from typing import Optional

import config


class ExplorationDB:
    """탐색 변형의 생명주기를 추적하는 SQLite 저장소."""

    def __init__(self, db_path: str = config.DB_PATH) -> None:
        self._db_path = db_path
        self._init_tables()

    def _init_tables(self) -> None:
        """exploration_variants + exploration_history 테이블 생성."""
        with sqlite3.connect(self._db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS exploration_variants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    variant_id TEXT UNIQUE NOT NULL,
                    variant_type TEXT NOT NULL,
                    base_strategy TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    description TEXT,
                    generation INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'ACTIVE',
                    coin TEXT,
                    trade_count INTEGER DEFAULT 0,
                    wins INTEGER DEFAULT 0,
                    losses INTEGER DEFAULT 0,
                    win_rate REAL DEFAULT 0.0,
                    profit_factor REAL DEFAULT 0.0,
                    total_pnl_krw REAL DEFAULT 0.0,
                    max_drawdown REAL DEFAULT 0.0,
                    created_at TEXT NOT NULL,
                    resolved_at TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS exploration_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    variant_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    detail_json TEXT,
                    created_at TEXT NOT NULL
                )
            """)

    def save_variant(self, variant_id: str, variant_type: str,
                     base_strategy: str, config_json: str,
                     description: str, coin: str,
                     generation: int = 1) -> None:
        """새 변형 저장."""
        now = datetime.now().isoformat()
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO exploration_variants "
                "(variant_id, variant_type, base_strategy, config_json, "
                "description, coin, generation, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)",
                (variant_id, variant_type, base_strategy,
                 config_json, description, coin, generation, now),
            )
        self._log_action(variant_id, "CREATED", description)

    def update_stats(self, variant_id: str, trade_count: int,
                     wins: int, losses: int, win_rate: float,
                     profit_factor: float, total_pnl_krw: float,
                     max_drawdown: float) -> None:
        """변형 성과 업데이트."""
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "UPDATE exploration_variants SET "
                "trade_count=?, wins=?, losses=?, win_rate=?, "
                "profit_factor=?, total_pnl_krw=?, max_drawdown=? "
                "WHERE variant_id=?",
                (trade_count, wins, losses, win_rate,
                 profit_factor, total_pnl_krw, max_drawdown,
                 variant_id),
            )

    def set_status(self, variant_id: str, status: str) -> None:
        """변형 상태 변경 (ACTIVE → PROMOTED / DISCARDED)."""
        now = datetime.now().isoformat()
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "UPDATE exploration_variants SET status=?, resolved_at=? "
                "WHERE variant_id=?",
                (status, now, variant_id),
            )
        self._log_action(variant_id, status, "")

    def get_active_variants(self) -> list:
        """활성 변형 목록 조회."""
        with sqlite3.connect(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM exploration_variants WHERE status='ACTIVE'"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_promoted_variants(self, limit: int = 20) -> list:
        """승격된 변형 이력 조회."""
        with sqlite3.connect(self._db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM exploration_variants "
                "WHERE status='PROMOTED' ORDER BY resolved_at DESC "
                "LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def _log_action(self, variant_id: str, action: str,
                    detail: str) -> None:
        """이력 기록."""
        now = datetime.now().isoformat()
        with sqlite3.connect(self._db_path) as conn:
            conn.execute(
                "INSERT INTO exploration_history "
                "(variant_id, action, detail_json, created_at) "
                "VALUES (?, ?, ?, ?)",
                (variant_id, action, json.dumps({"detail": detail}), now),
            )

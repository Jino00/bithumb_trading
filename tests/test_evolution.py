# 전략 진화 엔진 단위 테스트.
"""
neighbor_generator, evolution_db, safety_gate, param_space 등을 검증한다.
"""
import json
import os
import sqlite3
import tempfile

import pytest

import config
from evolution.param_space import STRATEGY_IDS, STRATEGY_PARAM_SPACE
from evolution.neighbor_generator import generate_neighbors
from evolution.evolution_db import EvolutionDB


# ── param_space 테스트 ─────────────────────────────────────


class TestParamSpace:
    """파라미터 공간 정의가 올바른지 확인한다."""

    def test_all_six_strategies_defined(self):
        assert set(STRATEGY_IDS) == {"S1", "S2", "S3", "S4", "S5", "S6"}

    def test_each_strategy_has_params(self):
        for sid in STRATEGY_IDS:
            assert len(STRATEGY_PARAM_SPACE[sid]) >= 4, \
                f"{sid}의 파라미터가 4개 미만"

    def test_param_tuple_format(self):
        """각 파라미터가 (default, min, max, step, type) 형식인지."""
        for sid, space in STRATEGY_PARAM_SPACE.items():
            for name, tup in space.items():
                assert len(tup) == 5, f"{sid}.{name}: 튜플 길이 != 5"
                default, lo, hi, step, ptype = tup
                assert lo <= default <= hi, \
                    f"{sid}.{name}: default {default}가 범위 [{lo}, {hi}] 밖"
                assert step > 0, f"{sid}.{name}: step <= 0"
                assert ptype in (int, float), \
                    f"{sid}.{name}: type이 int/float가 아님"


# ── neighbor_generator 테스트 ──────────────────────────────


class TestNeighborGenerator:
    """이웃 파라미터 생성기를 검증한다."""

    def _base_params(self):
        return {
            "rsi_low": 25.0,
            "rsi_high": 50.0,
            "sl_mult": 1.5,
            "tp_mult": 1.5,
            "min_atr_pct": 0.3,
        }

    def test_generates_correct_count(self):
        neighbors = generate_neighbors(
            self._base_params(), STRATEGY_PARAM_SPACE["S1"], n_candidates=8
        )
        assert len(neighbors) <= 8

    def test_generates_at_least_some(self):
        neighbors = generate_neighbors(
            self._base_params(), STRATEGY_PARAM_SPACE["S1"], n_candidates=12
        )
        assert len(neighbors) >= 4

    def test_neighbors_within_bounds(self):
        space = STRATEGY_PARAM_SPACE["S1"]
        neighbors = generate_neighbors(self._base_params(), space)
        for n in neighbors:
            for name, (default, lo, hi, step, ptype) in space.items():
                if name in n:
                    assert lo <= n[name] <= hi, \
                        f"{name}={n[name]}가 범위 [{lo}, {hi}] 밖"

    def test_no_exact_duplicates(self):
        neighbors = generate_neighbors(
            self._base_params(), STRATEGY_PARAM_SPACE["S1"], n_candidates=12
        )
        seen = set()
        for n in neighbors:
            key = frozenset(n.items())
            assert key not in seen, "중복 이웃 발견"
            seen.add(key)

    def test_at_least_one_differs_from_base(self):
        base = self._base_params()
        neighbors = generate_neighbors(base, STRATEGY_PARAM_SPACE["S1"])
        any_diff = False
        for n in neighbors:
            if n != base:
                any_diff = True
                break
        assert any_diff, "모든 이웃이 베이스와 동일"


# ── evolution_db 테스트 ────────────────────────────────────


class TestEvolutionDB:
    """진화 DB 읽기/쓰기를 검증한다."""

    @pytest.fixture
    def db(self, tmp_path):
        """임시 DB로 EvolutionDB 인스턴스 생성."""
        db_path = str(tmp_path / "test_trades.db")
        # 테이블 생성 (learning_log.py의 _CREATE_SQL 실행)
        from learning.learning_log import _CREATE_SQL
        conn = sqlite3.connect(db_path)
        conn.executescript(_CREATE_SQL)
        conn.close()
        return EvolutionDB(db_path)

    def test_save_and_load_evolved(self, db):
        params = {"rr_ratio": 3.5, "min_bearish": 4}
        db.save_evolved("S3", params, score=25.0, baseline_score=20.0)
        loaded = db.load_evolved("S3")
        assert loaded is not None
        assert loaded["rr_ratio"] == 3.5
        assert loaded["min_bearish"] == 4

    def test_load_returns_none_when_empty(self, db):
        assert db.load_evolved("S1") is None

    def test_deactivate(self, db):
        db.save_evolved("S1", {"rsi_low": 30.0}, score=10.0,
                        baseline_score=8.0)
        assert db.load_evolved("S1") is not None
        db.deactivate("S1")
        assert db.load_evolved("S1") is None

    def test_list_active(self, db):
        db.save_evolved("S1", {"a": 1}, score=10, baseline_score=8)
        db.save_evolved("S3", {"b": 2}, score=20, baseline_score=15)
        active = db.list_active()
        assert len(active) == 2

    def test_save_and_load_state(self, db):
        state = {"round": 5, "strategy_idx": 2}
        db.save_state(state)
        loaded = db.load_state()
        assert loaded is not None
        assert loaded["round"] == 5

    def test_save_history(self, db):
        db.save_history(
            strategy_id="S3",
            candidate_params={"rr_ratio": 3.5},
            baseline_params={"rr_ratio": 3.0},
            candidate_score=25.0,
            baseline_score=20.0,
            validated=True,
            applied=True,
        )
        history = db.get_history("S3")
        assert len(history) == 1
        assert history[0]["applied"] == 1

    def test_upsert_updates_existing(self, db):
        db.save_evolved("S3", {"rr_ratio": 3.0}, score=20, baseline_score=15)
        db.save_evolved("S3", {"rr_ratio": 4.0}, score=25, baseline_score=20)
        loaded = db.load_evolved("S3")
        assert loaded["rr_ratio"] == 4.0
        active = db.list_active()
        # UPSERT이므로 1개만 있어야 함
        s3_active = [a for a in active if a["strategy_id"] == "S3"]
        assert len(s3_active) == 1


# ── strategy_evaluator 브릿지 테스트 ───────────────────────


class TestEvaluatorBridge:
    """_get_default_params가 진화 파라미터를 올바르게 병합하는지 확인."""

    def test_without_evolved_returns_config(self):
        from monitor.strategy_evaluator import _get_default_params
        params = _get_default_params("S3")
        # config.py 기본값이 반환되어야 함
        assert "doji_body_ratio" in params
        assert "rr_ratio" in params

    def test_config_defaults_separate(self):
        from monitor.strategy_evaluator import _get_config_defaults
        params = _get_config_defaults("S1")
        assert "rsi_low" in params
        assert params["rsi_low"] == config.SCALP_RSI_PULLBACK_LOW

    def test_unknown_strategy_empty(self):
        from monitor.strategy_evaluator import _get_config_defaults
        assert _get_config_defaults("S99") == {}

# 자기 개선 학습 루프 테스트 — Phase 1~5 핵심 기능 검증.
"""
테스트 항목:
  1. 상태 영속화 (Phase 1)
  2. 새 규칙 EXIT_STRATEGY, RSI_TUNE (Phase 2)
  3. 최근 거래 가중치 (Phase 3)
  4. 효과성 추적 (Phase 4)
  5. 장기 기억 (Phase 5)
"""
import os
import tempfile
import unittest

from analyzer.analyzer import AnalysisReport, TradeAnalyzer
from learning.adaptation_memory import AdaptationMemory
from learning.adaptation_rules import (
    AdaptationProposal,
    rule_exit_strategy,
    rule_rsi_bucket,
)
from learning.adaptive_engine import AdaptiveState
from learning.effectiveness_tracker import EffectivenessTracker
from learning.learning_log import LearningLog
from strategy.rsi_strategy import RSIStrategy


# ── Phase 1: 상태 영속화 테스트 ──────────────────────────────


class TestAdaptiveStateSerialization(unittest.TestCase):
    """AdaptiveState의 to_dict / from_dict 직렬화 검증."""

    def test_round_trip(self):
        state = AdaptiveState()
        state.blocked_hours = {3, 15, 22}
        state.block_downtrend_buy = True
        state.trade_amount_multiplier = 0.7
        state.stop_loss_pct = 2.5
        state.take_profit_pct = 6.0
        state.adaptation_count = 12

        data = state.to_dict()
        restored = AdaptiveState.from_dict(data)

        self.assertEqual(restored.blocked_hours, {3, 15, 22})
        self.assertTrue(restored.block_downtrend_buy)
        self.assertAlmostEqual(restored.trade_amount_multiplier, 0.7)
        self.assertAlmostEqual(restored.stop_loss_pct, 2.5)
        self.assertAlmostEqual(restored.take_profit_pct, 6.0)
        self.assertEqual(restored.adaptation_count, 12)

    def test_default_values(self):
        state = AdaptiveState.from_dict({})
        self.assertEqual(state.blocked_hours, set())
        self.assertFalse(state.block_downtrend_buy)
        self.assertAlmostEqual(state.trade_amount_multiplier, 1.0)
        self.assertIsNone(state.stop_loss_pct)
        self.assertIsNone(state.take_profit_pct)


class TestLearningLogStatePersistence(unittest.TestCase):
    """LearningLog의 save_state/load_state 검증."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.log = LearningLog(self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_save_and_load_state(self):
        state = {"blocked_hours": [3, 15], "trade_amount_multiplier": 0.8}
        self.log.save_state("BTC", state)
        loaded = self.log.load_state("BTC")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded["blocked_hours"], [3, 15])
        self.assertAlmostEqual(loaded["trade_amount_multiplier"], 0.8)

    def test_load_nonexistent_returns_none(self):
        loaded = self.log.load_state("ETH")
        self.assertIsNone(loaded)

    def test_upsert_overwrites(self):
        self.log.save_state("BTC", {"value": 1})
        self.log.save_state("BTC", {"value": 2})
        loaded = self.log.load_state("BTC")
        self.assertEqual(loaded["value"], 2)


# ── Phase 2: 새 규칙 테스트 ──────────────────────────────────


def _make_report(**kwargs) -> AnalysisReport:
    """기본 AnalysisReport를 생성한다."""
    defaults = {
        "total_trades": 50,
        "win_rate": 60.0,
        "avg_profit_pct": 2.5,
        "avg_loss_pct": -1.5,
        "profit_factor": 1.5,
        "max_consecutive_losses": 3,
        "avg_hold_minutes": 120,
    }
    defaults.update(kwargs)
    return AnalysisReport(**defaults)


class TestRuleExitStrategy(unittest.TestCase):
    """Rule 5: EXIT_STRATEGY 규칙 검증."""

    def test_stop_loss_too_frequent(self):
        """손절 비율 > 40% → SL 확대 제안"""
        report = _make_report(exit_pattern={
            "STOP_LOSS": {"count": 25, "pct": 50.0, "avg_pnl": -3.0, "win_rate": 0},
            "TAKE_PROFIT": {"count": 15, "pct": 30.0, "avg_pnl": 5.0, "win_rate": 100},
            "RSI_SIGNAL": {"count": 10, "pct": 20.0, "avg_pnl": 1.0, "win_rate": 70},
        })
        proposal = rule_exit_strategy(report, current_sl=3.0, current_tp=5.0)
        self.assertIsNotNone(proposal)
        self.assertEqual(proposal.adaptation_type, "EXIT_STRATEGY")
        self.assertGreater(proposal.after_value["stop_loss_pct"], 3.0)

    def test_no_change_when_balanced(self):
        """청산 패턴이 균형적이면 제안 없음"""
        report = _make_report(exit_pattern={
            "STOP_LOSS": {"count": 10, "pct": 20.0, "avg_pnl": -3.0, "win_rate": 0},
            "TAKE_PROFIT": {"count": 20, "pct": 40.0, "avg_pnl": 5.0, "win_rate": 100},
            "RSI_SIGNAL": {"count": 20, "pct": 40.0, "avg_pnl": 1.0, "win_rate": 70},
        })
        proposal = rule_exit_strategy(report, current_sl=3.0, current_tp=5.0)
        self.assertIsNone(proposal)

    def test_insufficient_sample(self):
        """샘플 부족 시 제안 없음"""
        report = _make_report(exit_pattern={
            "STOP_LOSS": {"count": 2, "pct": 67.0, "avg_pnl": -3.0, "win_rate": 0},
            "TAKE_PROFIT": {"count": 1, "pct": 33.0, "avg_pnl": 5.0, "win_rate": 100},
        })
        proposal = rule_exit_strategy(report, current_sl=3.0, current_tp=5.0)
        self.assertIsNone(proposal)


class TestRuleRsiBucket(unittest.TestCase):
    """Rule 6: RSI_TUNE 규칙 검증."""

    def test_rsi_bucket_adjustment(self):
        """최고 성과 RSI 구간과 현재 설정의 차이 ≥ 3이면 조정"""
        report = _make_report(by_rsi_bucket={
            "20-25": {"total": 10, "win_rate": 85.0, "avg_pnl": 3.0},
            "25-30": {"total": 15, "win_rate": 70.0, "avg_pnl": 2.0},
            "30-35": {"total": 10, "win_rate": 50.0, "avg_pnl": 0.5},
        })
        strategy = RSIStrategy(14, 30, 70)
        proposal = rule_rsi_bucket(report, strategy)
        self.assertIsNotNone(proposal)
        self.assertEqual(proposal.adaptation_type, "RSI_TUNE")
        # 22.5 (20-25 중앙) vs 현재 oversold 30 → 차이 7.5 ≥ 3
        self.assertEqual(proposal.after_value["oversold"], 22)

    def test_no_significant_difference(self):
        """차이 < 3이면 제안 없음"""
        report = _make_report(by_rsi_bucket={
            "28-33": {"total": 10, "win_rate": 85.0, "avg_pnl": 3.0},
        })
        strategy = RSIStrategy(14, 30, 70)
        proposal = rule_rsi_bucket(report, strategy)
        self.assertIsNone(proposal)


# ── Phase 3: 최근 거래 가중치 테스트 ──────────────────────────


class TestRecencyWeighting(unittest.TestCase):
    """거래 분석 시 최근 거래 가중치 검증."""

    def test_weights_applied(self):
        """가중치가 선형으로 적용되는지 검증."""
        trades = [
            {"pnl_pct": 1.0, "entry_time": f"2024-01-{i+1:02d}T10:00:00"}
            for i in range(5)
        ]
        analyzer = TradeAnalyzer(trades)
        # 첫 번째 거래: min_weight, 마지막 거래: 1.0
        first_w = analyzer.trades[0].get("_weight", 1.0)
        last_w = analyzer.trades[-1].get("_weight", 1.0)
        self.assertLess(first_w, last_w)
        self.assertAlmostEqual(last_w, 1.0)

    def test_single_trade_weight_is_one(self):
        """거래 1건이면 가중치 1.0"""
        trades = [{"pnl_pct": 1.0, "entry_time": "2024-01-01T10:00:00"}]
        analyzer = TradeAnalyzer(trades)
        self.assertAlmostEqual(analyzer.trades[0]["_weight"], 1.0)


# ── Phase 4: 효과성 추적 테스트 ──────────────────────────────


class TestEffectivenessTracker(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.log = LearningLog(self.tmp.name)
        self.tracker = EffectivenessTracker(self.log)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_compute_stats(self):
        trades = [
            {"pnl_pct": 2.5},
            {"pnl_pct": -1.0},
            {"pnl_pct": 3.0},
            {"pnl_pct": 1.5},
        ]
        stats = self.tracker._compute_stats(trades)
        self.assertEqual(stats["window_trades"], 4)
        self.assertAlmostEqual(stats["win_rate"], 75.0)

    def test_snapshot_before_saves(self):
        """BEFORE 스냅샷이 DB에 저장되는지 검증"""
        aid = self.log.log_adaptation(
            "TEST", "reason", {}, {}, True, True, "BTC"
        )
        trades = [{"pnl_pct": 1.0}, {"pnl_pct": -0.5}]
        self.tracker.snapshot_before(aid, "BTC", trades)
        snapshots = self.log.get_effectiveness_snapshots(aid)
        self.assertIn("BEFORE", snapshots)
        self.assertEqual(snapshots["BEFORE"]["window_trades"], 2)


# ── Phase 5: 장기 기억 테스트 ─────────────────────────────────


class TestAdaptationMemory(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        self.log = LearningLog(self.tmp.name)
        self.memory = AdaptationMemory(self.log)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_record_and_retrieve(self):
        self.memory.record_outcome("BTC", "TIME_FILTER", "blocked_hours", [3], 5.0)
        mem = self.log.get_memory("BTC", "TIME_FILTER", "blocked_hours")
        self.assertIsNotNone(mem)
        self.assertGreater(mem["effectiveness_score"], 0)

    def test_should_try_with_few_samples(self):
        """데이터 부족 시 시도 허용"""
        result = self.log.should_try_adaptation("BTC", "TEST", "key")
        self.assertTrue(result)

    def test_filter_proposals_removes_failed(self):
        """성공률 < 30% 적응은 필터링"""
        # 3번 시도, 0번 성공 기록
        for _ in range(3):
            self.memory.record_outcome("BTC", "TIME_FILTER", "blocked_hours", [3], -5.0)

        proposal = AdaptationProposal(
            adaptation_type="TIME_FILTER",
            trigger_reason="test",
            before_value={},
            after_value={"blocked_hours": [3]},
            priority=2,
            requires_gate=False,
        )
        filtered = self.memory.filter_proposals("BTC", [proposal])
        self.assertEqual(len(filtered), 0)

    def test_effective_history(self):
        self.memory.record_outcome("BTC", "PARAM_TUNE", "rsi_params", {}, 5.0)
        self.memory.record_outcome("BTC", "TIME_FILTER", "hours", [3], -3.0)
        effective = self.memory.get_effective_history("BTC")
        self.assertEqual(len(effective), 1)  # 효과적인 것만


if __name__ == "__main__":
    unittest.main()

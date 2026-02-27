"""
AdaptiveEngine + adaptation_rules 단위 테스트
"""
import unittest
from unittest.mock import MagicMock, patch

from analyzer.analyzer import AnalysisReport
from learning.adaptation_rules import (
    AdaptationProposal,
    evaluate_all_rules,
    rule_param_tune,
    rule_position_size,
    rule_time_filter,
    rule_trend_filter,
)
from learning.adaptive_engine import AdaptiveEngine, AdaptiveState
from strategy.rsi_strategy import RSIStrategy
from strategy.strategy_gate import BacktestResult


def _make_report(**overrides) -> AnalysisReport:
    """테스트용 AnalysisReport 생성"""
    defaults = dict(
        total_trades=20,
        win_rate=60.0,
        avg_profit_pct=2.5,
        avg_loss_pct=-1.5,
        profit_factor=2.0,
        max_consecutive_losses=3,
        avg_hold_minutes=120.0,
        by_hour={},
        by_strategy={"RSIStrategy": {"total": 20, "win": 12, "win_rate": 60.0}},
        by_rsi_bucket={},
        by_trend={},
        by_volatility={},
        exit_pattern={},
        suggestions=[],
    )
    defaults.update(overrides)
    return AnalysisReport(**defaults)


def _make_backtest_result(**overrides) -> BacktestResult:
    defaults = dict(
        total_trades=120,
        winning_trades=96,
        losing_trades=24,
        win_rate=80.0,
        total_return_pct=50.0,
        max_drawdown_pct=10.0,
        avg_profit_pct=1.5,
        profit_factor=2.5,
    )
    defaults.update(overrides)
    return BacktestResult(**defaults)


class TestRuleParamTune(unittest.TestCase):

    def test_no_best_params(self):
        strategy = RSIStrategy(14, 30, 70)
        result = rule_param_tune(None, None, strategy)
        self.assertIsNone(result)

    def test_same_params_no_proposal(self):
        strategy = RSIStrategy(14, 30, 70)
        best = {"period": 14, "oversold": 30, "overbought": 70}
        br = _make_backtest_result()
        result = rule_param_tune(best, br, strategy)
        self.assertIsNone(result)

    def test_different_params_proposal(self):
        strategy = RSIStrategy(14, 30, 70)
        best = {"period": 12, "oversold": 25, "overbought": 75}
        br = _make_backtest_result()
        result = rule_param_tune(best, br, strategy)
        self.assertIsNotNone(result)
        self.assertEqual(result.adaptation_type, "PARAM_TUNE")
        self.assertTrue(result.requires_gate)
        self.assertEqual(result.after_value["period"], 12)


class TestRuleTimeFilter(unittest.TestCase):

    def test_no_bad_hours(self):
        report = _make_report(by_hour={
            10: {"total": 10, "win_rate": 60.0},
            14: {"total": 8, "win_rate": 55.0},
        })
        result = rule_time_filter(report)
        self.assertIsNone(result)

    def test_bad_hours_detected(self):
        report = _make_report(by_hour={
            3: {"total": 6, "win_rate": 30.0},  # 저성과
            10: {"total": 10, "win_rate": 60.0},
        })
        result = rule_time_filter(report)
        self.assertIsNotNone(result)
        self.assertEqual(result.adaptation_type, "TIME_FILTER")
        self.assertIn(3, result.after_value["blocked_hours"])

    def test_insufficient_sample_ignored(self):
        report = _make_report(by_hour={
            3: {"total": 2, "win_rate": 20.0},  # 샘플 부족
        })
        result = rule_time_filter(report)
        self.assertIsNone(result)


class TestRuleTrendFilter(unittest.TestCase):

    def test_no_downtrend_data(self):
        report = _make_report(by_trend={
            "UPTREND": {"total": 15, "win_rate": 70.0},
        })
        result = rule_trend_filter(report)
        self.assertIsNone(result)

    def test_downtrend_bad(self):
        report = _make_report(by_trend={
            "DOWNTREND": {"total": 10, "win_rate": 35.0},
        })
        result = rule_trend_filter(report)
        self.assertIsNotNone(result)
        self.assertEqual(result.adaptation_type, "TREND_FILTER")
        self.assertTrue(result.after_value["block_downtrend_buy"])

    def test_downtrend_ok(self):
        report = _make_report(by_trend={
            "DOWNTREND": {"total": 10, "win_rate": 55.0},
        })
        result = rule_trend_filter(report)
        self.assertIsNone(result)


class TestRulePositionSize(unittest.TestCase):

    def test_no_change_default(self):
        report = _make_report()
        result = rule_position_size(report)
        self.assertIsNone(result)

    def test_high_vol_low_performance(self):
        report = _make_report(by_volatility={
            "HIGH": {"total": 10, "win_rate": 30.0},
        })
        result = rule_position_size(report)
        self.assertIsNotNone(result)
        self.assertLessEqual(result.after_value["multiplier"], 0.5)

    def test_consecutive_losses(self):
        report = _make_report(max_consecutive_losses=6)
        result = rule_position_size(report)
        self.assertIsNotNone(result)
        self.assertLess(result.after_value["multiplier"], 1.0)

    def test_good_performance_expansion(self):
        report = _make_report(
            total_trades=30, win_rate=85.0,
            by_volatility={},
            max_consecutive_losses=1,
        )
        result = rule_position_size(report)
        self.assertIsNotNone(result)
        self.assertGreater(result.after_value["multiplier"], 1.0)

    def test_position_bound_min(self):
        report = _make_report(
            max_consecutive_losses=10,
            by_volatility={"HIGH": {"total": 10, "win_rate": 20.0}},
        )
        result = rule_position_size(report)
        self.assertIsNotNone(result)
        self.assertGreaterEqual(result.after_value["multiplier"], 0.3)


class TestEvaluateAllRules(unittest.TestCase):

    def test_multiple_proposals_sorted(self):
        report = _make_report(
            by_hour={3: {"total": 10, "win_rate": 25.0}},
            by_trend={"DOWNTREND": {"total": 8, "win_rate": 30.0}},
        )
        strategy = RSIStrategy(14, 30, 70)
        proposals = evaluate_all_rules(report, strategy)
        self.assertGreaterEqual(len(proposals), 2)
        # 우선순위 오름차순
        for i in range(len(proposals) - 1):
            self.assertLessEqual(proposals[i].priority, proposals[i + 1].priority)


class TestAdaptiveState(unittest.TestCase):

    def test_reset_filters(self):
        state = AdaptiveState()
        state.blocked_hours = {3, 4, 5}
        state.block_downtrend_buy = True
        state.trade_amount_multiplier = 0.5
        state.reset_filters()
        self.assertEqual(state.blocked_hours, set())
        self.assertFalse(state.block_downtrend_buy)
        self.assertEqual(state.trade_amount_multiplier, 1.0)


class TestAdaptiveEngineShouldBlock(unittest.TestCase):

    def setUp(self):
        self.strategy = RSIStrategy(14, 30, 70)
        self.engine = AdaptiveEngine(
            strategy=self.strategy,
            trade_logger=MagicMock(),
            learning_log=MagicMock(),
            gate=MagicMock(),
            client=MagicMock(),
        )

    def test_no_block_by_default(self):
        blocked, reason = self.engine.should_block_buy(10, "UPTREND")
        self.assertFalse(blocked)

    def test_block_bad_hour(self):
        self.engine._state.blocked_hours = {3, 4}
        blocked, reason = self.engine.should_block_buy(3, "UPTREND")
        self.assertTrue(blocked)
        self.assertIn("3시", reason)

    def test_block_downtrend(self):
        self.engine._state.block_downtrend_buy = True
        blocked, reason = self.engine.should_block_buy(10, "DOWNTREND")
        self.assertTrue(blocked)
        self.assertIn("하락", reason)

    @patch("learning.adaptive_engine.config")
    def test_disabled_no_block(self, mock_config):
        mock_config.ADAPTIVE_ENABLED = False
        self.engine._state.blocked_hours = {3}
        blocked, reason = self.engine.should_block_buy(3, "UPTREND")
        self.assertFalse(blocked)


class TestAdaptiveEngineGetTradeAmount(unittest.TestCase):

    def setUp(self):
        self.strategy = RSIStrategy(14, 30, 70)
        self.engine = AdaptiveEngine(
            strategy=self.strategy,
            trade_logger=MagicMock(),
            learning_log=MagicMock(),
            gate=MagicMock(),
            client=MagicMock(),
        )

    def test_default_multiplier(self):
        amount = self.engine.get_trade_amount(100_000)
        self.assertEqual(amount, 100_000)

    def test_reduced_multiplier(self):
        self.engine._state.trade_amount_multiplier = 0.5
        amount = self.engine.get_trade_amount(100_000)
        self.assertEqual(amount, 50_000)

    def test_expanded_multiplier(self):
        self.engine._state.trade_amount_multiplier = 1.5
        amount = self.engine.get_trade_amount(100_000)
        self.assertEqual(amount, 150_000)


if __name__ == "__main__":
    unittest.main(verbosity=2)

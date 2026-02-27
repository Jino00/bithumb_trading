"""
RiskManager 단위 테스트
"""
import unittest

from risk.risk_manager import RiskManager


class TestRiskManager(unittest.TestCase):

    def test_initial_state(self):
        rm = RiskManager(stop_loss_pct=3.0, take_profit_pct=5.0, max_drawdown_pct=20.0)
        self.assertFalse(rm.is_mdd_exceeded())
        self.assertFalse(rm.should_stop_loss(50_000_000))

    def test_stop_loss_triggered(self):
        rm = RiskManager(stop_loss_pct=3.0)
        rm.record_trade("BUY", 100_000)
        self.assertTrue(rm.should_stop_loss(96_000))  # -4%

    def test_stop_loss_not_triggered(self):
        rm = RiskManager(stop_loss_pct=3.0)
        rm.record_trade("BUY", 100_000)
        self.assertFalse(rm.should_stop_loss(98_000))  # -2%

    def test_take_profit_triggered(self):
        rm = RiskManager(take_profit_pct=5.0)
        rm.record_trade("BUY", 100_000)
        self.assertTrue(rm.should_take_profit(106_000))  # +6%

    def test_take_profit_not_triggered(self):
        rm = RiskManager(take_profit_pct=5.0)
        rm.record_trade("BUY", 100_000)
        self.assertFalse(rm.should_take_profit(103_000))  # +3%

    def test_mdd_exceeded(self):
        rm = RiskManager(max_drawdown_pct=10.0)
        # 시뮬레이션: 여러 차례 손실
        rm.record_trade("BUY", 100_000)
        rm.record_trade("SELL", 94_000)   # -6%
        rm.record_trade("BUY", 94_000)
        rm.record_trade("SELL", 88_000)   # -6.38%
        # 누적 equity 하락이 10%를 초과할 수 있음
        self.assertTrue(rm.is_mdd_exceeded())

    def test_equity_increases_after_profit(self):
        rm = RiskManager()
        rm.record_trade("BUY", 100_000)
        rm.record_trade("SELL", 110_000)
        status = rm.status()
        self.assertGreater(status["equity"], 1.0)

    def test_status_returns_dict(self):
        rm = RiskManager()
        status = rm.status()
        self.assertIn("equity", status)
        self.assertIn("peak_equity", status)
        self.assertIn("current_drawdown_pct", status)
        self.assertIn("total_trades", status)

    def test_no_position_no_stop_loss(self):
        rm = RiskManager(stop_loss_pct=3.0)
        self.assertFalse(rm.should_stop_loss(50_000))

    def test_no_position_no_take_profit(self):
        rm = RiskManager(take_profit_pct=5.0)
        self.assertFalse(rm.should_take_profit(50_000))


if __name__ == "__main__":
    unittest.main(verbosity=2)

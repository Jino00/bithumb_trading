"""
PaperClient 단위 테스트
"""
import unittest
from unittest.mock import MagicMock

from exchange.paper_client import PaperClient


class TestPaperClient(unittest.TestCase):

    def _make_paper_client(self, initial_krw=1_000_000):
        mock_real = MagicMock()
        mock_real.get_current_price.return_value = 50_000_000.0
        mock_real.get_ohlcv.return_value = MagicMock()
        mock_real.get_orderbook.return_value = {"bids": [], "asks": []}
        return PaperClient(mock_real, initial_krw=initial_krw)

    def test_initial_balance(self):
        pc = self._make_paper_client(initial_krw=2_000_000)
        self.assertEqual(pc.get_krw_balance(), 2_000_000)
        self.assertEqual(pc.get_coin_balance("BTC"), 0.0)

    def test_buy_deducts_krw(self):
        pc = self._make_paper_client(initial_krw=1_000_000)
        pc.buy("BTC", 0.01)  # 0.01 BTC * 50M = 500,000원
        self.assertEqual(pc.get_krw_balance(), 500_000)
        self.assertAlmostEqual(pc.get_coin_balance("BTC"), 0.01)

    def test_sell_adds_krw(self):
        pc = self._make_paper_client(initial_krw=1_000_000)
        pc.buy("BTC", 0.01)
        pc.sell("BTC", 0.01)
        self.assertAlmostEqual(pc.get_krw_balance(), 1_000_000)
        self.assertAlmostEqual(pc.get_coin_balance("BTC"), 0.0)

    def test_buy_insufficient_balance(self):
        pc = self._make_paper_client(initial_krw=100)
        with self.assertRaises(RuntimeError):
            pc.buy("BTC", 0.01)  # 500,000원 필요

    def test_sell_insufficient_coin(self):
        pc = self._make_paper_client()
        with self.assertRaises(RuntimeError):
            pc.sell("BTC", 0.01)  # 보유량 0

    def test_trade_count(self):
        pc = self._make_paper_client()
        self.assertEqual(pc.trade_count, 0)
        pc.buy("BTC", 0.01)
        self.assertEqual(pc.trade_count, 1)
        pc.sell("BTC", 0.01)
        self.assertEqual(pc.trade_count, 2)

    def test_balance_summary(self):
        pc = self._make_paper_client(initial_krw=1_000_000)
        pc.buy("BTC", 0.01)
        summary = pc.get_balance_summary("BTC")
        self.assertIn("krw", summary)
        self.assertIn("coin", summary)
        self.assertIn("total_krw", summary)
        self.assertAlmostEqual(summary["total_krw"], 1_000_000)

    def test_buy_returns_paper_order(self):
        pc = self._make_paper_client()
        result = pc.buy("BTC", 0.001)
        self.assertEqual(result["status"], "paper")
        self.assertIn("PAPER-BUY", result["order_id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

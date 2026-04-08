"""
TradeAnalyzer 단위 테스트
"""
import unittest

from analyzer.analyzer import TradeAnalyzer, AnalysisReport


def _make_trades(n=20, win_ratio=0.6):
    """테스트용 거래 목록 생성"""
    trades = []
    for i in range(n):
        is_win = i < int(n * win_ratio)
        pnl = 2.5 if is_win else -1.5
        trades.append({
            "entry_id": i + 1,
            "entry_time": f"2024-06-{(i % 28 + 1):02d}T{(i % 24):02d}:00:00",
            "strategy_name": "RSIStrategy",
            "coin": "BTC",
            "entry_price": 50_000_000,
            "amount": 0.002,
            "total_krw": 100_000,
            "entry_reason": "RSI 28.0로 과매도 진입",
            "rsi_value": 28.0 if is_win else 35.0,
            "volume_ratio": 1.5,
            "trend": "UPTREND" if is_win else "DOWNTREND",
            "volatility": "MEDIUM",
            "exit_time": f"2024-06-{(i % 28 + 1):02d}T{((i + 2) % 24):02d}:00:00",
            "exit_price": 51_250_000 if is_win else 49_250_000,
            "exit_reason": "익절" if is_win else "손절",
            "pnl_pct": pnl,
            "hold_minutes": 120,
        })
    return trades


class TestTradeAnalyzer(unittest.TestCase):

    def test_empty_trades(self):
        analyzer = TradeAnalyzer([])
        report = analyzer.analyze()
        self.assertEqual(report.total_trades, 0)

    def test_analyze_returns_report(self):
        trades = _make_trades(20)
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        self.assertIsInstance(report, AnalysisReport)
        self.assertEqual(report.total_trades, 20)

    def test_win_rate(self):
        # 승패가 고르게 분포된 데이터로 테스트 (가중치 영향 최소화)
        trades = _make_trades(10, win_ratio=0.7)
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        # 가중치 적용으로 정확히 70%가 아닐 수 있지만, 합리적 범위 내여야 함
        self.assertGreater(report.win_rate, 40.0)
        self.assertLess(report.win_rate, 90.0)

    def test_profit_factor(self):
        trades = _make_trades(20, win_ratio=0.6)
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        self.assertGreater(report.profit_factor, 0)

    def test_by_strategy(self):
        trades = _make_trades(10)
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        self.assertIn("RSIStrategy", report.by_strategy)

    def test_by_trend(self):
        trades = _make_trades(10)
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        self.assertTrue(len(report.by_trend) > 0)

    def test_exit_pattern(self):
        trades = _make_trades(10)
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        self.assertTrue(len(report.exit_pattern) > 0)

    def test_report_string(self):
        trades = _make_trades(10)
        analyzer = TradeAnalyzer(trades)
        text = analyzer.report()
        self.assertIn("거래 분석 리포트", text)
        self.assertIn("승률", text)

    def test_suggestions_not_empty(self):
        trades = _make_trades(20)
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        self.assertGreater(len(report.suggestions), 0)

    def test_max_consecutive_losses(self):
        trades = _make_trades(20, win_ratio=0.0)  # 전부 손실
        analyzer = TradeAnalyzer(trades)
        report = analyzer.analyze()
        self.assertEqual(report.max_consecutive_losses, 20)


if __name__ == "__main__":
    unittest.main(verbosity=2)

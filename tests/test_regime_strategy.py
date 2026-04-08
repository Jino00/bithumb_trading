"""
RegimeAwareStrategy 단위 테스트
"""
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from strategy.grid_strategy import GridStrategy
from strategy.market_regime import MarketRegime, MarketRegimeDetector, RegimeDetail
from strategy.regime_strategy import RegimeAwareStrategy
from strategy.rsi_strategy import RSIStrategy, SignalContext


def _make_test_df(rows: int = 100) -> pd.DataFrame:
    """테스트용 OHLCV DataFrame을 생성한다."""
    np.random.seed(42)
    close = 1000 + np.cumsum(np.random.normal(0, 2, rows))
    return pd.DataFrame({
        "open": close - np.random.uniform(-1, 1, rows),
        "high": close + np.random.uniform(1, 5, rows),
        "low": close - np.random.uniform(1, 5, rows),
        "close": close,
        "volume": np.random.uniform(100, 500, rows),
    })


class TestRegimeAwareStrategy(unittest.TestCase):

    def setUp(self):
        self.rsi = RSIStrategy(period=14, oversold=30, overbought=70)
        self.grid = GridStrategy(grid_count=10, range_period=50)
        self.detector = MarketRegimeDetector(
            adx_period=14, adx_trend_threshold=25, adx_range_threshold=20,
        )
        self.strategy = RegimeAwareStrategy(self.rsi, self.grid, self.detector)

    def test_range_bound_uses_grid(self):
        """횡보장에서 GridStrategy 신호를 사용한다."""
        mock_detail = RegimeDetail(
            regime=MarketRegime.RANGE_BOUND,
            adx_value=15.0, plus_di=12.0, minus_di=13.0, confidence="MEDIUM",
        )
        with patch.object(self.detector, "detect_with_detail", return_value=mock_detail):
            df = _make_test_df(100)
            ctx = self.strategy.generate_signal_with_context(df)
            self.assertIn("[횡보장→그리드]", ctx.reason)
            self.assertEqual(ctx.indicators.get("regime"), "RANGE_BOUND")

    def test_trending_up_uses_rsi(self):
        """상승추세에서 RSIStrategy 신호를 사용한다."""
        mock_detail = RegimeDetail(
            regime=MarketRegime.TRENDING_UP,
            adx_value=30.0, plus_di=25.0, minus_di=10.0, confidence="HIGH",
        )
        with patch.object(self.detector, "detect_with_detail", return_value=mock_detail):
            df = _make_test_df(100)
            ctx = self.strategy.generate_signal_with_context(df)
            self.assertIn("[상승추세→RSI]", ctx.reason)
            self.assertEqual(ctx.indicators.get("regime"), "TRENDING_UP")

    def test_trending_down_blocks_buy(self):
        """하락추세에서 BUY 신호를 HOLD로 변환한다."""
        mock_detail = RegimeDetail(
            regime=MarketRegime.TRENDING_DOWN,
            adx_value=30.0, plus_di=10.0, minus_di=25.0, confidence="HIGH",
        )

        # RSI가 BUY를 반환하도록 mock
        buy_ctx = SignalContext(
            signal="BUY", reason="RSI 25로 과매도 진입",
            rsi_value=25.0, volume_ratio=1.5, trend="DOWNTREND",
            volatility="MEDIUM",
        )
        with (
            patch.object(self.detector, "detect_with_detail", return_value=mock_detail),
            patch.object(self.rsi, "generate_signal_with_context", return_value=buy_ctx),
        ):
            df = _make_test_df(100)
            ctx = self.strategy.generate_signal_with_context(df)
            self.assertEqual(ctx.signal, "HOLD")
            self.assertIn("[하락추세→매수차단]", ctx.reason)

    def test_trending_down_allows_sell(self):
        """하락추세에서 SELL 신호는 통과시킨다."""
        mock_detail = RegimeDetail(
            regime=MarketRegime.TRENDING_DOWN,
            adx_value=30.0, plus_di=10.0, minus_di=25.0, confidence="HIGH",
        )

        sell_ctx = SignalContext(
            signal="SELL", reason="RSI 75로 과매수 청산",
            rsi_value=75.0, volume_ratio=1.0, trend="DOWNTREND",
            volatility="MEDIUM",
        )
        with (
            patch.object(self.detector, "detect_with_detail", return_value=mock_detail),
            patch.object(self.rsi, "generate_signal_with_context", return_value=sell_ctx),
        ):
            df = _make_test_df(100)
            ctx = self.strategy.generate_signal_with_context(df)
            self.assertEqual(ctx.signal, "SELL")
            self.assertIn("[하락추세→RSI청산]", ctx.reason)

    def test_overbought_property_delegation(self):
        """overbought 속성이 RSI 전략에 위임된다."""
        self.assertEqual(self.strategy.overbought, 70)
        self.strategy.overbought = 75
        self.assertEqual(self.rsi.overbought, 75)

    def test_period_property_delegation(self):
        """period 속성이 RSI 전략에 위임된다."""
        self.assertEqual(self.strategy.period, 14)
        self.strategy.period = 20
        self.assertEqual(self.rsi.period, 20)

    def test_oversold_property_delegation(self):
        """oversold 속성이 RSI 전략에 위임된다."""
        self.assertEqual(self.strategy.oversold, 30)
        self.strategy.oversold = 25
        self.assertEqual(self.rsi.oversold, 25)

    def test_current_regime_property(self):
        """current_regime이 마지막 감지 결과를 반환한다."""
        # 초기값
        self.assertEqual(self.strategy.current_regime, MarketRegime.RANGE_BOUND)

        mock_detail = RegimeDetail(
            regime=MarketRegime.TRENDING_UP,
            adx_value=30.0, plus_di=25.0, minus_di=10.0, confidence="HIGH",
        )
        with patch.object(self.detector, "detect_with_detail", return_value=mock_detail):
            df = _make_test_df(100)
            self.strategy.generate_signal_with_context(df)
            self.assertEqual(self.strategy.current_regime, MarketRegime.TRENDING_UP)

    def test_generate_signal_returns_signal_type(self):
        """generate_signal()은 Signal 타입 문자열을 반환한다."""
        df = _make_test_df(100)
        signal = self.strategy.generate_signal(df)
        self.assertIn(signal, ("BUY", "SELL", "HOLD"))

    def test_precompute_signals_returns_series(self):
        """precompute_signals()는 BUY/SELL/HOLD 시리즈를 반환한다."""
        df = _make_test_df(200)
        signals = self.strategy.precompute_signals(df)
        self.assertIsInstance(signals, pd.Series)
        self.assertEqual(len(signals), len(df))
        valid_signals = {"BUY", "SELL", "HOLD"}
        for s in signals.unique():
            self.assertIn(s, valid_signals)

    def test_name_property(self):
        """name 속성이 클래스명을 반환한다."""
        self.assertEqual(self.strategy.name, "RegimeAwareStrategy")

    def test_regime_indicators_added(self):
        """시장 상태 지표가 indicators에 추가된다."""
        mock_detail = RegimeDetail(
            regime=MarketRegime.RANGE_BOUND,
            adx_value=15.0, plus_di=12.0, minus_di=13.0, confidence="MEDIUM",
        )
        with patch.object(self.detector, "detect_with_detail", return_value=mock_detail):
            df = _make_test_df(100)
            ctx = self.strategy.generate_signal_with_context(df)
            self.assertIn("adx", ctx.indicators)
            self.assertIn("plus_di", ctx.indicators)
            self.assertIn("minus_di", ctx.indicators)
            self.assertIn("regime_confidence", ctx.indicators)


class TestGridStrategy(unittest.TestCase):
    """GridStrategy 기본 테스트."""

    def test_generate_signal_returns_valid(self):
        """generate_signal()은 유효한 Signal을 반환한다."""
        grid = GridStrategy(grid_count=10, range_period=50)
        df = _make_test_df(100)
        signal = grid.generate_signal(df)
        self.assertIn(signal, ("BUY", "SELL", "HOLD"))

    def test_insufficient_data_returns_hold(self):
        """데이터 부족 시 HOLD를 반환한다."""
        grid = GridStrategy(grid_count=10, range_period=50)
        small_df = _make_test_df(10)
        signal = grid.generate_signal(small_df)
        self.assertEqual(signal, "HOLD")

    def test_precompute_signals_returns_series(self):
        """precompute_signals()는 시리즈를 반환한다."""
        grid = GridStrategy(grid_count=10, range_period=50)
        df = _make_test_df(200)
        signals = grid.precompute_signals(df)
        self.assertIsInstance(signals, pd.Series)
        self.assertEqual(len(signals), len(df))

    def test_grid_levels_computation(self):
        """그리드 레벨이 올바르게 등분된다."""
        grid = GridStrategy(grid_count=5)
        levels = grid._compute_grid_levels(100.0, 200.0)
        self.assertEqual(len(levels), 6)  # 5등분 → 6개 경계점
        self.assertAlmostEqual(levels[0], 100.0)
        self.assertAlmostEqual(levels[-1], 200.0)
        # 등간격 확인
        for i in range(1, len(levels)):
            self.assertAlmostEqual(levels[i] - levels[i - 1], 20.0, places=5)


if __name__ == "__main__":
    unittest.main(verbosity=2)

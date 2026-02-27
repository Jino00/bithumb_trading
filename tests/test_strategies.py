"""
MACD / Bollinger 전략 단위 테스트
"""
import unittest
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from strategy.macd_strategy import MACDStrategy
from strategy.bollinger_strategy import BollingerStrategy


def _make_ohlcv(n: int = 300, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 50_000_000 + np.cumsum(rng.normal(0, 300_000, n))
    close = np.maximum(close, 1_000_000)
    noise = rng.uniform(0.003, 0.015, n)
    high = close * (1 + noise)
    low = close * (1 - noise)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    volume = rng.uniform(0.5, 20.0, n)
    index = [datetime(2024, 1, 1) + timedelta(hours=i) for i in range(n)]
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=index,
    )


class TestMACDStrategy(unittest.TestCase):

    def test_signal_is_valid(self):
        df = _make_ohlcv(300)
        strategy = MACDStrategy()
        signal = strategy.generate_signal(df)
        self.assertIn(signal, ["BUY", "SELL", "HOLD"])

    def test_hold_on_insufficient_data(self):
        df = _make_ohlcv(10)
        strategy = MACDStrategy()
        signal = strategy.generate_signal(df)
        self.assertEqual(signal, "HOLD")

    def test_precompute_signals_length(self):
        df = _make_ohlcv(300)
        strategy = MACDStrategy()
        signals = strategy.precompute_signals(df)
        self.assertEqual(len(signals), len(df))

    def test_precompute_signals_values(self):
        df = _make_ohlcv(300)
        strategy = MACDStrategy()
        signals = strategy.precompute_signals(df)
        valid = set(signals.unique())
        self.assertTrue(valid.issubset({"BUY", "SELL", "HOLD"}))

    def test_name_property(self):
        strategy = MACDStrategy()
        self.assertEqual(strategy.name, "MACDStrategy")


class TestBollingerStrategy(unittest.TestCase):

    def test_signal_is_valid(self):
        df = _make_ohlcv(300)
        strategy = BollingerStrategy()
        signal = strategy.generate_signal(df)
        self.assertIn(signal, ["BUY", "SELL", "HOLD"])

    def test_hold_on_insufficient_data(self):
        df = _make_ohlcv(10)
        strategy = BollingerStrategy()
        signal = strategy.generate_signal(df)
        self.assertEqual(signal, "HOLD")

    def test_precompute_signals_length(self):
        df = _make_ohlcv(300)
        strategy = BollingerStrategy()
        signals = strategy.precompute_signals(df)
        self.assertEqual(len(signals), len(df))

    def test_exit_at_upper_band(self):
        strategy = BollingerStrategy(exit_at_middle=False)
        self.assertFalse(strategy.exit_at_middle)

    def test_name_property(self):
        strategy = BollingerStrategy()
        self.assertEqual(strategy.name, "BollingerStrategy")


if __name__ == "__main__":
    unittest.main(verbosity=2)

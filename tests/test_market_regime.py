"""
MarketRegimeDetector 단위 테스트
"""
import unittest

import numpy as np
import pandas as pd

from strategy.market_regime import MarketRegime, MarketRegimeDetector, RegimeDetail


def _make_trending_df(direction: str = "up", rows: int = 100) -> pd.DataFrame:
    """ADX가 높은 추세 데이터를 생성한다."""
    np.random.seed(42)
    if direction == "up":
        close = np.cumsum(np.random.uniform(0.5, 2.0, rows)) + 1000
    else:
        close = 2000 - np.cumsum(np.random.uniform(0.5, 2.0, rows))
    high = close + np.random.uniform(1, 5, rows)
    low = close - np.random.uniform(1, 5, rows)
    volume = np.random.uniform(100, 500, rows)
    return pd.DataFrame({
        "open": close - np.random.uniform(-1, 1, rows),
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


def _make_ranging_df(rows: int = 100) -> pd.DataFrame:
    """ADX가 낮은 횡보 데이터를 생성한다."""
    np.random.seed(42)
    base = 1000.0
    close = base + np.sin(np.linspace(0, 10 * np.pi, rows)) * 5
    close += np.random.normal(0, 1, rows)
    high = close + np.random.uniform(1, 3, rows)
    low = close - np.random.uniform(1, 3, rows)
    volume = np.random.uniform(100, 500, rows)
    return pd.DataFrame({
        "open": close - np.random.uniform(-0.5, 0.5, rows),
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    })


class TestMarketRegimeDetector(unittest.TestCase):

    def test_trending_up_detection(self):
        """강한 상승 추세 시 TRENDING_UP을 반환해야 한다."""
        df = _make_trending_df("up", rows=200)
        detector = MarketRegimeDetector(
            adx_period=14, adx_trend_threshold=20, adx_range_threshold=15,
        )
        detail = detector.detect_with_detail(df)
        self.assertIsInstance(detail, RegimeDetail)
        self.assertEqual(detail.regime, MarketRegime.TRENDING_UP)
        self.assertGreater(detail.adx_value, 0)
        self.assertGreater(detail.plus_di, detail.minus_di)

    def test_trending_down_detection(self):
        """강한 하락 추세 시 TRENDING_DOWN을 반환해야 한다."""
        df = _make_trending_df("down", rows=200)
        detector = MarketRegimeDetector(
            adx_period=14, adx_trend_threshold=20, adx_range_threshold=15,
        )
        detail = detector.detect_with_detail(df)
        self.assertEqual(detail.regime, MarketRegime.TRENDING_DOWN)
        self.assertGreater(detail.minus_di, detail.plus_di)

    def test_range_bound_detection(self):
        """횡보장에서 RANGE_BOUND를 반환해야 한다."""
        df = _make_ranging_df(rows=200)
        detector = MarketRegimeDetector(
            adx_period=14, adx_trend_threshold=25, adx_range_threshold=20,
        )
        detail = detector.detect_with_detail(df)
        # 횡보 데이터에서 ADX가 낮아야 함
        self.assertLess(detail.adx_value, 30)

    def test_hysteresis_in_transition_zone(self):
        """전환 구간에서는 이전 상태를 유지한다 (히스테리시스)."""
        detector = MarketRegimeDetector(
            adx_period=14, adx_trend_threshold=25, adx_range_threshold=20,
        )
        # 초기 상태는 RANGE_BOUND
        self.assertEqual(detector._previous_regime, MarketRegime.RANGE_BOUND)

        # 전환 구간 (20 ≤ ADX < 25) — 이전 상태 유지
        result = detector._classify_regime(adx=22.0, plus_di=15, minus_di=10)
        self.assertEqual(result, MarketRegime.RANGE_BOUND)

        # 추세장으로 전환
        detector._previous_regime = MarketRegime.TRENDING_UP
        result = detector._classify_regime(adx=22.0, plus_di=15, minus_di=10)
        self.assertEqual(result, MarketRegime.TRENDING_UP)

    def test_detect_simple_returns_regime(self):
        """detect()는 MarketRegime 값만 반환한다."""
        df = _make_trending_df("up", rows=200)
        detector = MarketRegimeDetector(
            adx_period=14, adx_trend_threshold=20, adx_range_threshold=15,
        )
        regime = detector.detect(df)
        self.assertIsInstance(regime, MarketRegime)

    def test_insufficient_data_returns_previous(self):
        """데이터 부족 시 이전 상태를 반환한다."""
        detector = MarketRegimeDetector(adx_period=14)
        small_df = pd.DataFrame({
            "open": [100, 101], "high": [102, 103],
            "low": [99, 100], "close": [101, 102], "volume": [10, 20],
        })
        detail = detector.detect_with_detail(small_df)
        self.assertEqual(detail.regime, MarketRegime.RANGE_BOUND)
        self.assertEqual(detail.confidence, "LOW")

    def test_confidence_assessment(self):
        """ADX 강도에 따라 신뢰도가 올바르게 평가된다."""
        detector = MarketRegimeDetector(adx_trend_threshold=25, adx_range_threshold=20)

        # ADX >= 35 (threshold + 10) → HIGH
        self.assertEqual(detector._assess_confidence(36.0), "HIGH")
        # ADX = 25 (= threshold) → MEDIUM
        self.assertEqual(detector._assess_confidence(25.0), "MEDIUM")
        # ADX < 20 (range) → MEDIUM
        self.assertEqual(detector._assess_confidence(15.0), "MEDIUM")
        # 전환 구간 (20 ≤ ADX < 25) → LOW
        self.assertEqual(detector._assess_confidence(22.0), "LOW")


if __name__ == "__main__":
    unittest.main(verbosity=2)

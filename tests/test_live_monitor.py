"""
LiveMonitor 단위 테스트
"""
import sys
import os
import unittest

# main.py에서 LiveMonitor를 import하기 위해 프로젝트 루트를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import LiveMonitor


class TestLiveMonitor(unittest.TestCase):

    def test_initial_win_rate_is_100(self):
        lm = LiveMonitor(window=20, threshold=65.0, min_sample=5)
        self.assertEqual(lm.current_win_rate(), 100.0)

    def test_not_below_threshold_with_few_samples(self):
        lm = LiveMonitor(window=20, threshold=65.0, min_sample=5)
        lm.record(-1.0)  # 손실 1건
        lm.record(-2.0)  # 손실 2건
        self.assertFalse(lm.is_below_threshold())  # 샘플 부족

    def test_below_threshold_after_enough_losses(self):
        lm = LiveMonitor(window=20, threshold=65.0, min_sample=5)
        for _ in range(5):
            lm.record(-1.0)  # 5건 전부 손실
        self.assertTrue(lm.is_below_threshold())

    def test_win_rate_calculation(self):
        lm = LiveMonitor(window=10)
        for _ in range(7):
            lm.record(1.0)  # 수익
        for _ in range(3):
            lm.record(-1.0)  # 손실
        self.assertAlmostEqual(lm.current_win_rate(), 70.0)

    def test_window_rolling(self):
        lm = LiveMonitor(window=5, threshold=50.0, min_sample=3)
        for _ in range(5):
            lm.record(-1.0)  # 5건 손실
        self.assertTrue(lm.is_below_threshold())

        # 새 수익 거래 추가 → 이전 손실이 밀림
        for _ in range(5):
            lm.record(1.0)  # 5건 수익
        self.assertFalse(lm.is_below_threshold())
        self.assertEqual(lm.current_win_rate(), 100.0)

    def test_status_string(self):
        lm = LiveMonitor(window=10, threshold=65.0)
        lm.record(1.0)
        status = lm.status()
        self.assertIn("실전 승률", status)
        self.assertIn("정상", status)

    def test_status_warning(self):
        lm = LiveMonitor(window=10, threshold=65.0, min_sample=3)
        for _ in range(5):
            lm.record(-1.0)
        status = lm.status()
        self.assertIn("임계값 미달", status)


if __name__ == "__main__":
    unittest.main(verbosity=2)

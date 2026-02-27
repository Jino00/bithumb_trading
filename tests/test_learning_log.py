"""
LearningLog 단위 테스트 — SQLite 적응 기록 테스트
"""
import os
import tempfile
import unittest

from learning.learning_log import LearningLog


class TestLearningLog(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test_trades.db")
        self.log = LearningLog(self.db_path)

    def tearDown(self):
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def test_log_adaptation_and_retrieve(self):
        self.log.log_adaptation(
            adaptation_type="TIME_FILTER",
            trigger_reason="저성과 시간대: 3시",
            before_value={"blocked_hours": []},
            after_value={"blocked_hours": [3]},
            gate_passed=True,
            applied=True,
            coin="BTC",
        )
        records = self.log.get_recent_adaptations(limit=10)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["adaptation_type"], "TIME_FILTER")
        self.assertTrue(records[0]["applied"])

    def test_gate_detail_stored(self):
        detail = {"win_rate": 78.5, "fail_reasons": []}
        self.log.log_adaptation(
            adaptation_type="PARAM_TUNE",
            trigger_reason="그리드서치 파라미터 변경",
            before_value={"period": 14},
            after_value={"period": 12},
            gate_passed=True,
            applied=True,
            coin="BTC",
            gate_detail=detail,
        )
        records = self.log.get_recent_adaptations(limit=1)
        self.assertIn("78.5", records[0]["gate_detail"])

    def test_get_by_type(self):
        for i in range(3):
            self.log.log_adaptation(
                adaptation_type="POSITION_SIZE",
                trigger_reason=f"사유 {i}",
                before_value={"multiplier": 1.0},
                after_value={"multiplier": 0.5},
                gate_passed=True,
                applied=True,
                coin="BTC",
            )
        self.log.log_adaptation(
            adaptation_type="TREND_FILTER",
            trigger_reason="하락추세 차단",
            before_value={},
            after_value={},
            gate_passed=True,
            applied=True,
            coin="BTC",
        )
        pos_records = self.log.get_adaptations_by_type("POSITION_SIZE")
        self.assertEqual(len(pos_records), 3)

    def test_applied_count(self):
        self.log.log_adaptation(
            adaptation_type="TIME_FILTER",
            trigger_reason="테스트",
            before_value={}, after_value={},
            gate_passed=True, applied=True, coin="BTC",
        )
        self.log.log_adaptation(
            adaptation_type="TIME_FILTER",
            trigger_reason="테스트",
            before_value={}, after_value={},
            gate_passed=False, applied=False, coin="BTC",
        )
        self.assertEqual(self.log.get_applied_count(), 1)

    def test_empty_db(self):
        records = self.log.get_recent_adaptations()
        self.assertEqual(len(records), 0)
        self.assertEqual(self.log.get_applied_count(), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)

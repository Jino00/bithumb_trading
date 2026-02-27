"""
PortfolioManager 단위 테스트
"""
import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch, PropertyMock

import config
from portfolio.portfolio_manager import (
    BlacklistEntry,
    CoinSlot,
    PortfolioManager,
)
from screener.coin_screener import CoinScore
from strategy.rsi_strategy import RSIStrategy


def _make_score(symbol="BTC", range_pct=5.0, volume_krw=50e8) -> CoinScore:
    return CoinScore(
        symbol=symbol,
        close=50_000_000,
        volume_krw=volume_krw,
        range_pct=range_pct,
        high=51_000_000,
        low=49_000_000,
    )


def _make_slot(coin="BTC", draining=False, has_position=False) -> CoinSlot:
    """테스트용 CoinSlot 생성"""
    bot = MagicMock()
    bot.is_active = True
    bot._current_entry_id = 1 if has_position else None
    bot._active = True

    strategy = RSIStrategy(14, 30, 70)
    risk_manager = MagicMock()
    risk_manager.status.return_value = {"current_drawdown_pct": 5.0}
    live_monitor = MagicMock()
    live_monitor.current_win_rate.return_value = 70.0

    return CoinSlot(
        coin=coin,
        bot=bot,
        strategy=strategy,
        risk_manager=risk_manager,
        live_monitor=live_monitor,
        adaptive_engine=None,
        draining=draining,
    )


class TestCoinSlot(unittest.TestCase):

    def test_is_idle_draining_no_position(self):
        slot = _make_slot(draining=True, has_position=False)
        self.assertTrue(slot.is_idle())

    def test_is_idle_draining_with_position(self):
        slot = _make_slot(draining=True, has_position=True)
        self.assertFalse(slot.is_idle())

    def test_is_idle_not_draining(self):
        slot = _make_slot(draining=False, has_position=False)
        self.assertFalse(slot.is_idle())


class TestPortfolioManagerInit(unittest.TestCase):

    def test_default_init(self):
        pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
        )
        self.assertEqual(pm.max_positions, 5)
        self.assertEqual(pm.portfolio_mdd_pct, 25.0)
        self.assertEqual(pm.per_coin_allocation_pct, 20.0)
        self.assertEqual(len(pm._slots), 0)
        self.assertEqual(len(pm._blacklist), 0)

    def test_custom_init(self):
        pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
            max_positions=3,
            portfolio_mdd_pct=15.0,
            per_coin_allocation_pct=30.0,
            blacklist_ttl_hours=12,
        )
        self.assertEqual(pm.max_positions, 3)
        self.assertEqual(pm.portfolio_mdd_pct, 15.0)
        self.assertEqual(pm.per_coin_allocation_pct, 30.0)
        self.assertEqual(pm.blacklist_ttl_hours, 12)


class TestPortfolioManagerBlacklist(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
            blacklist_ttl_hours=24,
        )

    def test_add_to_blacklist(self):
        self.pm._add_to_blacklist("XRP", "게이트 미통과")
        self.assertIn("XRP", self.pm._blacklist)
        self.assertEqual(self.pm._blacklist["XRP"].reason, "게이트 미통과")

    def test_clean_expired_blacklist(self):
        self.pm._blacklist["OLD"] = BlacklistEntry(
            coin="OLD",
            reason="expired",
            expires_at=datetime.now() - timedelta(hours=1),
        )
        self.pm._blacklist["FRESH"] = BlacklistEntry(
            coin="FRESH",
            reason="recent",
            expires_at=datetime.now() + timedelta(hours=23),
        )
        self.pm._clean_blacklist()
        self.assertNotIn("OLD", self.pm._blacklist)
        self.assertIn("FRESH", self.pm._blacklist)

    def test_blacklist_prevents_activation(self):
        """블랙리스트 코인은 scan_and_update에서 후보에서 제외된다."""
        self.pm._add_to_blacklist("BTC", "이전 실패")
        screener = MagicMock()
        screener.scan.return_value = [_make_score("BTC")]
        self.pm.screener = screener

        # _try_activate_coin이 호출되지 않아야 함
        with patch.object(self.pm, "_try_activate_coin") as mock_activate:
            self.pm.scan_and_update()
            mock_activate.assert_not_called()


class TestPortfolioManagerDeactivate(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
        )

    def test_deactivate_no_position_removes_immediately(self):
        slot = _make_slot("BTC", has_position=False)
        self.pm._slots["BTC"] = slot
        result = self.pm.deactivate_coin("BTC", reason="테스트")
        self.assertTrue(result)
        self.assertNotIn("BTC", self.pm._slots)

    def test_deactivate_with_position_enters_drain(self):
        slot = _make_slot("ETH", has_position=True)
        self.pm._slots["ETH"] = slot
        result = self.pm.deactivate_coin("ETH", reason="테스트")
        self.assertTrue(result)
        self.assertIn("ETH", self.pm._slots)
        self.assertTrue(self.pm._slots["ETH"].draining)

    def test_deactivate_nonexistent_returns_false(self):
        result = self.pm.deactivate_coin("NONEXIST")
        self.assertFalse(result)


class TestPortfolioManagerDrainCleanup(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
        )

    def test_clean_drained_slots(self):
        """드레인 모드이고 포지션 없는 슬롯은 제거된다."""
        slot_idle = _make_slot("BTC", draining=True, has_position=False)
        slot_active = _make_slot("ETH", draining=False, has_position=True)
        slot_drain_pos = _make_slot("SOL", draining=True, has_position=True)

        self.pm._slots = {"BTC": slot_idle, "ETH": slot_active, "SOL": slot_drain_pos}
        self.pm._clean_drained_slots()

        self.assertNotIn("BTC", self.pm._slots)
        self.assertIn("ETH", self.pm._slots)
        self.assertIn("SOL", self.pm._slots)


class TestPortfolioManagerRunCycles(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
        )

    def test_run_all_cycles_calls_each_bot(self):
        slot_btc = _make_slot("BTC")
        slot_eth = _make_slot("ETH")
        self.pm._slots = {"BTC": slot_btc, "ETH": slot_eth}

        self.pm.run_all_cycles()

        slot_btc.bot.run_cycle.assert_called_once()
        slot_eth.bot.run_cycle.assert_called_once()

    def test_run_all_cycles_skips_drained_idle(self):
        """드레인 모드 + 포지션 없음인 슬롯은 실행하지 않는다."""
        slot = _make_slot("BTC", draining=True, has_position=False)
        self.pm._slots = {"BTC": slot}

        self.pm.run_all_cycles()

        slot.bot.run_cycle.assert_not_called()

    def test_run_all_cycles_runs_draining_with_position(self):
        """드레인 모드이지만 포지션 있으면 청산 기회를 위해 실행한다."""
        slot = _make_slot("SOL", draining=True, has_position=True)
        self.pm._slots = {"SOL": slot}

        self.pm.run_all_cycles()

        slot.bot.run_cycle.assert_called_once()

    def test_run_all_cycles_detects_bot_deactivation(self):
        """봇이 자체 비활성화되면 드레인 모드로 전환."""
        slot = _make_slot("BTC")
        slot.bot.is_active = False  # 봇이 비활성화됨
        self.pm._slots = {"BTC": slot}

        with patch.object(self.pm, "deactivate_coin") as mock_deactivate:
            self.pm.run_all_cycles()
            mock_deactivate.assert_called_once_with("BTC", reason="봇 자체 비활성화")


class TestPortfolioManagerEquity(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
            per_coin_allocation_pct=20.0,
            portfolio_mdd_pct=25.0,
        )

    def test_update_equity_profit(self):
        self.pm.update_portfolio_equity(10.0)  # 10% 수익
        # 20% 배분 → 포트폴리오 영향 = 10 * 0.2 / 100 = 0.02
        expected = 1.0 * (1 + 0.02)
        self.assertAlmostEqual(self.pm._portfolio_equity, expected, places=6)
        self.assertEqual(self.pm._total_trades, 1)

    def test_update_equity_loss(self):
        self.pm.update_portfolio_equity(-5.0)  # 5% 손실
        expected = 1.0 * (1 - 0.01)
        self.assertAlmostEqual(self.pm._portfolio_equity, expected, places=6)

    def test_portfolio_mdd_not_exceeded(self):
        self.assertFalse(self.pm._is_portfolio_mdd_exceeded())

    def test_portfolio_mdd_exceeded(self):
        self.pm._portfolio_equity = 0.7  # 30% 하락
        self.pm._portfolio_peak = 1.0
        self.assertTrue(self.pm._is_portfolio_mdd_exceeded())

    def test_calculate_allocation(self):
        with patch.object(config, "TRADE_AMOUNT", 100_000):
            result = self.pm._calculate_allocation()
            self.assertEqual(result, 20_000)  # 100_000 * 20%


class TestPortfolioManagerScanSlots(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
            max_positions=3,
        )

    def test_scan_respects_max_positions(self):
        """이미 슬롯이 가득 차면 활성화를 시도하지 않는다."""
        self.pm._slots = {
            "BTC": _make_slot("BTC"),
            "ETH": _make_slot("ETH"),
            "SOL": _make_slot("SOL"),
        }
        screener = MagicMock()
        self.pm.screener = screener

        result = self.pm.scan_and_update()

        self.assertEqual(result, [])
        screener.scan.assert_not_called()

    def test_scan_excludes_already_active(self):
        """이미 활성인 코인은 후보에서 제외."""
        self.pm._slots = {"BTC": _make_slot("BTC")}
        screener = MagicMock()
        screener.scan.return_value = [
            _make_score("BTC"),
            _make_score("ETH"),
        ]
        self.pm.screener = screener

        with patch.object(self.pm, "_try_activate_coin", return_value=True) as mock_act:
            self.pm.scan_and_update()
            # BTC는 이미 활성이므로 ETH만 시도
            mock_act.assert_called_once()
            called_score = mock_act.call_args[0][0]
            self.assertEqual(called_score.symbol, "ETH")

    def test_scan_portfolio_mdd_blocks(self):
        """포트폴리오 MDD 초과 시 신규 활성화 차단."""
        self.pm._portfolio_equity = 0.5
        self.pm._portfolio_peak = 1.0

        screener = MagicMock()
        self.pm.screener = screener

        result = self.pm.scan_and_update()
        self.assertEqual(result, [])
        screener.scan.assert_not_called()


class TestPortfolioManagerCheckStale(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
        )

    def test_deactivates_stale_coins(self):
        """스크리너 결과에 없는 코인은 비활성화."""
        self.pm._slots = {
            "BTC": _make_slot("BTC"),
            "XRP": _make_slot("XRP"),
        }
        current_scores = [_make_score("BTC")]

        with patch.object(self.pm, "deactivate_coin", return_value=True) as mock_deact:
            deactivated = self.pm.check_and_deactivate_stale(current_scores)
            self.assertEqual(deactivated, ["XRP"])
            mock_deact.assert_called_once_with("XRP", reason="스크리너 탈락 (거래량/변동성 부족)")

    def test_skips_draining_coins(self):
        """이미 드레이닝 중인 코인은 건너뛴다."""
        self.pm._slots = {
            "XRP": _make_slot("XRP", draining=True),
        }
        current_scores = []

        with patch.object(self.pm, "deactivate_coin") as mock_deact:
            deactivated = self.pm.check_and_deactivate_stale(current_scores)
            self.assertEqual(deactivated, [])
            mock_deact.assert_not_called()


class TestPortfolioManagerStatus(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
        )

    def test_active_coins_excludes_draining(self):
        self.pm._slots = {
            "BTC": _make_slot("BTC"),
            "ETH": _make_slot("ETH", draining=True),
        }
        self.assertEqual(self.pm.active_coins, ["BTC"])

    def test_all_coins_includes_draining(self):
        self.pm._slots = {
            "BTC": _make_slot("BTC"),
            "ETH": _make_slot("ETH", draining=True),
        }
        self.assertEqual(sorted(self.pm.all_coins), ["BTC", "ETH"])

    def test_has_position(self):
        self.pm._slots = {
            "BTC": _make_slot("BTC", has_position=True),
            "ETH": _make_slot("ETH", has_position=False),
        }
        self.assertTrue(self.pm.has_position("BTC"))
        self.assertFalse(self.pm.has_position("ETH"))
        self.assertFalse(self.pm.has_position("NONEXIST"))

    def test_status_returns_dict(self):
        self.pm._slots = {"BTC": _make_slot("BTC")}
        status = self.pm.status()
        self.assertIn("active_coins", status)
        self.assertIn("total_slots", status)
        self.assertIn("portfolio_equity", status)
        self.assertIn("slots", status)
        self.assertIn("BTC", status["slots"])

    def test_status_text_returns_string(self):
        self.pm._slots = {"BTC": _make_slot("BTC")}
        text = self.pm.status_text()
        self.assertIn("BTC", text)
        self.assertIn("활성 코인", text)


class TestPortfolioManagerAdaptation(unittest.TestCase):

    def setUp(self):
        self.pm = PortfolioManager(
            client=MagicMock(),
            trade_logger=MagicMock(),
        )

    def test_run_all_adaptations(self):
        engine_mock = MagicMock()
        engine_mock.run_adaptation_cycle.return_value = []

        slot = _make_slot("BTC")
        slot.adaptive_engine = engine_mock
        self.pm._slots = {"BTC": slot}

        self.pm.run_all_adaptations()

        engine_mock.run_adaptation_cycle.assert_called_once()

    def test_skip_draining_slots(self):
        engine_mock = MagicMock()

        slot = _make_slot("BTC", draining=True)
        slot.adaptive_engine = engine_mock
        self.pm._slots = {"BTC": slot}

        self.pm.run_all_adaptations()

        engine_mock.run_adaptation_cycle.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""
백테스트 / 전략 / 로거 단위 테스트
실제 API 없이 합성 OHLCV 데이터로 검증한다.
"""
import os
import tempfile
import unittest
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from backtest.backtest_engine import BacktestEngine
from logger.trade_logger import TradeLogger
from strategy.rsi_strategy import RSIStrategy, SignalContext
from strategy.strategy_gate import BacktestResult, StrategyGate


# ── 테스트용 합성 OHLCV ────────────────────────────────────────────────────────

def _make_ohlcv(n: int = 500, seed: int = 42) -> pd.DataFrame:
    """랜덤 워크 기반 합성 OHLCV — 실제 가격 움직임과 유사하게 생성"""
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


# ── BacktestEngine 테스트 ─────────────────────────────────────────────────────

class TestBacktestEngine(unittest.TestCase):

    def setUp(self):
        self.df = _make_ohlcv(500)
        self.strategy = RSIStrategy(period=14, oversold=30, overbought=70)
        self.engine = BacktestEngine(self.strategy)

    def test_returns_backtest_result(self):
        result = self.engine.run(self.df)
        self.assertIsInstance(result, BacktestResult)

    def test_total_trades_nonnegative(self):
        result = self.engine.run(self.df)
        self.assertGreaterEqual(result.total_trades, 0)

    def test_win_rate_range(self):
        result = self.engine.run(self.df)
        self.assertGreaterEqual(result.win_rate, 0.0)
        self.assertLessEqual(result.win_rate, 100.0)

    def test_win_loss_sum_equals_total(self):
        result = self.engine.run(self.df)
        self.assertEqual(
            result.winning_trades + result.losing_trades, result.total_trades
        )

    def test_max_drawdown_nonnegative(self):
        result = self.engine.run(self.df)
        self.assertGreaterEqual(result.max_drawdown_pct, 0.0)

    def test_profit_factor_nonnegative(self):
        result = self.engine.run(self.df)
        self.assertGreaterEqual(result.profit_factor, 0.0)

    def test_empty_dataframe_returns_zero_result(self):
        empty_df = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        result = self.engine.run(empty_df)
        self.assertEqual(result.total_trades, 0)
        self.assertEqual(result.win_rate, 0.0)

    def test_grid_search_returns_best_params(self):
        gs = self.engine.grid_search(
            self.df,
            param_grid={
                "period": [7, 14],
                "oversold": [25, 30],
                "overbought": [70, 75],
            },
        )
        self.assertIn("period", gs.best_params)
        self.assertIn("oversold", gs.best_params)
        self.assertIn("overbought", gs.best_params)
        self.assertGreater(len(gs.all_results), 0)

    def test_grid_search_skips_invalid_combos(self):
        """oversold >= overbought 조합은 건너뛰어야 한다"""
        gs = self.engine.grid_search(
            self.df,
            param_grid={
                "period": [14],
                "oversold": [70],   # oversold == overbought → 스킵
                "overbought": [70],
            },
        )
        # 유효 조합이 없으므로 all_results는 비어있을 수 있음
        for params, _ in gs.all_results:
            self.assertLess(params["oversold"], params["overbought"])


# ── StrategyGate 테스트 ───────────────────────────────────────────────────────

class TestStrategyGate(unittest.TestCase):

    def _make_result(
        self,
        win_rate=80.0,
        total_trades=150,
        mdd=10.0,
        pf=2.0,
    ) -> BacktestResult:
        wins = int(total_trades * win_rate / 100)
        return BacktestResult(
            total_trades=total_trades,
            winning_trades=wins,
            losing_trades=total_trades - wins,
            win_rate=win_rate,
            total_return_pct=20.0,
            max_drawdown_pct=mdd,
            avg_profit_pct=0.5,
            profit_factor=pf,
        )

    def test_all_conditions_pass(self):
        gate = StrategyGate()
        result = self._make_result()
        self.assertTrue(gate.validate(result))

    def test_fail_low_win_rate(self):
        gate = StrategyGate(min_win_rate=75.0)
        result = self._make_result(win_rate=70.0)
        check = gate.check(result)
        self.assertFalse(check.passed)
        self.assertFalse(check.win_rate_pass)
        self.assertIn("승률", " ".join(check.fail_reasons))

    def test_fail_insufficient_trades(self):
        gate = StrategyGate(min_trades=100)
        result = self._make_result(total_trades=50)
        check = gate.check(result)
        self.assertFalse(check.passed)
        self.assertFalse(check.min_trades_pass)

    def test_fail_high_mdd(self):
        gate = StrategyGate(max_mdd=20.0)
        result = self._make_result(mdd=25.0)
        check = gate.check(result)
        self.assertFalse(check.passed)
        self.assertFalse(check.mdd_pass)

    def test_fail_low_profit_factor(self):
        gate = StrategyGate(min_profit_factor=1.5)
        result = self._make_result(pf=1.2)
        check = gate.check(result)
        self.assertFalse(check.passed)
        self.assertFalse(check.profit_factor_pass)

    def test_multiple_fails_reported(self):
        gate = StrategyGate(min_win_rate=75.0, min_trades=100, min_profit_factor=1.5)
        result = self._make_result(win_rate=60.0, total_trades=50, pf=1.0)
        check = gate.check(result)
        self.assertFalse(check.passed)
        self.assertGreaterEqual(len(check.fail_reasons), 2)

    def test_summary_contains_pass(self):
        gate = StrategyGate()
        result = self._make_result()
        summary = gate.summary(result)
        self.assertIn("PASS", summary)

    def test_summary_contains_fail(self):
        gate = StrategyGate(min_win_rate=90.0)
        result = self._make_result(win_rate=70.0)
        summary = gate.summary(result)
        self.assertIn("FAIL", summary)


# ── RSIStrategy 테스트 ────────────────────────────────────────────────────────

class TestRSIStrategy(unittest.TestCase):

    def test_hold_on_insufficient_data(self):
        df = _make_ohlcv(10)
        strategy = RSIStrategy(period=14)
        signal = strategy.generate_signal(df)
        self.assertEqual(signal, "HOLD")

    def test_signal_is_valid(self):
        df = _make_ohlcv(300)
        strategy = RSIStrategy(period=14, oversold=30, overbought=70)
        signal = strategy.generate_signal(df)
        self.assertIn(signal, ["BUY", "SELL", "HOLD"])

    def test_rsi_series_length(self):
        df = _make_ohlcv(200)
        strategy = RSIStrategy(period=14)
        rsi = strategy.calculate_rsi(df)
        self.assertEqual(len(rsi), len(df))

    def test_signal_with_context_returns_reason(self):
        df = _make_ohlcv(300)
        strategy = RSIStrategy(period=14)
        ctx = strategy.generate_signal_with_context(df)
        self.assertIsInstance(ctx, SignalContext)
        self.assertIsInstance(ctx.reason, str)
        self.assertGreater(len(ctx.reason), 0)

    def test_context_has_all_fields(self):
        df = _make_ohlcv(300)
        strategy = RSIStrategy(period=14)
        ctx = strategy.generate_signal_with_context(df)
        self.assertIn(ctx.signal, ["BUY", "SELL", "HOLD"])
        self.assertIn(ctx.trend, ["UPTREND", "DOWNTREND", "SIDEWAYS"])
        self.assertIn(ctx.volatility, ["HIGH", "MEDIUM", "LOW"])
        self.assertGreater(ctx.volume_ratio, 0)
        self.assertIn("rsi", ctx.indicators)

    def test_buy_reason_contains_rsi(self):
        """RSI가 oversold 이하인 구간을 인위적으로 만들어 BUY reason 검증"""
        # 급락 데이터 생성
        rng = np.random.default_rng(0)
        n = 100
        close = np.concatenate([
            50_000_000 + np.cumsum(rng.normal(0, 100_000, 60)),
            np.linspace(50_000_000, 40_000_000, 40),  # 급락
        ])
        close = np.maximum(close, 1_000_000)
        high = close * 1.005
        low = close * 0.995
        open_ = np.roll(close, 1); open_[0] = close[0]
        volume = rng.uniform(1, 5, n)
        index = [datetime(2024, 1, 1) + timedelta(hours=i) for i in range(n)]
        df = pd.DataFrame(
            {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
            index=index,
        )
        strategy = RSIStrategy(period=14, oversold=50)  # 관대한 기준
        ctx = strategy.generate_signal_with_context(df)
        if ctx.signal == "BUY":
            self.assertIn("과매도", ctx.reason)

    def test_exit_reason_stop_loss(self):
        reason = RSIStrategy.build_exit_reason(
            rsi=None, pnl_pct=-3.5, stop_loss_pct=3.0,
            take_profit_pct=5.0, overbought=70,
        )
        self.assertIn("손절", reason)

    def test_exit_reason_take_profit(self):
        reason = RSIStrategy.build_exit_reason(
            rsi=None, pnl_pct=5.5, stop_loss_pct=3.0,
            take_profit_pct=5.0, overbought=70,
        )
        self.assertIn("익절", reason)

    def test_exit_reason_rsi_overbought(self):
        reason = RSIStrategy.build_exit_reason(
            rsi=75.0, pnl_pct=2.0, stop_loss_pct=3.0,
            take_profit_pct=5.0, overbought=70,
        )
        self.assertIn("RSI", reason)


# ── TradeLogger 테스트 ────────────────────────────────────────────────────────

class TestTradeLogger(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        db_path = os.path.join(self.tmpdir, "test.db")
        self.logger = TradeLogger(db_path)

    def test_log_entry_returns_id(self):
        entry_id = self.logger.log_entry(
            strategy_name="RSIStrategy",
            coin="BTC",
            price=50_000_000,
            amount=0.002,
            reason="RSI 28.5로 과매도 진입",
            rsi_value=28.5,
            volume_ratio=1.7,
            trend="UPTREND",
            volatility="MEDIUM",
        )
        self.assertGreater(entry_id, 0)

    def test_log_exit_linked_to_entry(self):
        entry_id = self.logger.log_entry(
            strategy_name="RSIStrategy",
            coin="BTC",
            price=50_000_000,
            amount=0.002,
        )
        self.logger.log_exit(
            entry_id=entry_id,
            coin="BTC",
            price=52_500_000,
            amount=0.002,
            exit_reason="RSI 72.1로 과매수 청산",
            pnl_pct=5.0,
            hold_minutes=120,
        )
        trades = self.logger.get_completed_trades()
        self.assertEqual(len(trades), 1)
        self.assertAlmostEqual(trades[0]["pnl_pct"], 5.0)

    def test_get_open_entry(self):
        entry_id = self.logger.log_entry(
            strategy_name="RSIStrategy", coin="BTC",
            price=50_000_000, amount=0.002,
        )
        open_entry = self.logger.get_open_entry("BTC")
        self.assertIsNotNone(open_entry)
        self.assertEqual(open_entry["id"], entry_id)

    def test_open_entry_none_after_exit(self):
        entry_id = self.logger.log_entry(
            strategy_name="RSIStrategy", coin="BTC",
            price=50_000_000, amount=0.002,
        )
        self.logger.log_exit(
            entry_id=entry_id, coin="BTC",
            price=51_000_000, amount=0.002,
            exit_reason="익절", pnl_pct=2.0, hold_minutes=60,
        )
        open_entry = self.logger.get_open_entry("BTC")
        self.assertIsNone(open_entry)

    def test_log_event(self):
        self.logger.log_event("MDD_EXCEEDED", "BTC", {"drawdown": 22.5})
        events = self.logger.get_all_events("MDD_EXCEEDED")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["event_type"], "MDD_EXCEEDED")

    def test_get_recent_completed(self):
        for i in range(5):
            eid = self.logger.log_entry(
                strategy_name="RSI", coin="BTC",
                price=50_000_000 + i * 100_000, amount=0.001,
            )
            self.logger.log_exit(
                entry_id=eid, coin="BTC",
                price=50_000_000 + i * 100_000 + 500_000,
                amount=0.001, exit_reason="익절", pnl_pct=1.0, hold_minutes=60,
            )
        recent = self.logger.get_recent_completed(limit=3)
        self.assertEqual(len(recent), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""MarketMonitor 단위 테스트."""
import numpy as np
import pandas as pd
import pytest

from monitor.market_monitor import (
    MarketMonitor,
    MonitorTrigger,
    TriggerType,
    MONITOR_ATR_LOOKBACK,
    MONITOR_ATR_SPIKE_MULT,
    MONITOR_PERF_MIN_TRADES,
    MONITOR_VOL_MA_PERIOD,
    MONITOR_VOL_SPIKE_MULT,
    MONITOR_VOL_DRY_MULT,
)


def _make_df(n: int = 100, base_close: float = 80_000_000) -> pd.DataFrame:
    """테스트용 OHLCV DataFrame 생성."""
    close = np.full(n, base_close, dtype=float)
    return pd.DataFrame({
        "open": close * 0.999,
        "high": close * 1.005,
        "low": close * 0.995,
        "close": close,
        "volume": np.full(n, 100.0),
        "atr": np.full(n, base_close * 0.01),  # 1% ATR
    })


class _FakeTrade:
    """모니터 테스트용 가짜 Trade."""
    def __init__(self, pnl_pct: float):
        self.pnl_pct = pnl_pct


class TestMarketMonitorInit:
    """초기화 및 속성 테스트."""

    def test_initial_regime_unknown(self):
        m = MarketMonitor()
        assert m.current_regime == "UNKNOWN"

    def test_trigger_history_empty(self):
        m = MarketMonitor()
        assert m.trigger_history == []


class TestRegimeChangeDetection:
    """레짐 변경 감지 테스트."""

    def test_first_call_no_trigger(self):
        m = MarketMonitor()
        regimes = np.array(["BULL", "BULL", "BULL"])
        triggers = m.check(_make_df(3), regimes, [])
        assert len(triggers) == 0
        assert m.current_regime == "BULL"

    def test_same_regime_no_trigger(self):
        m = MarketMonitor()
        regimes = np.array(["SIDEWAYS", "SIDEWAYS"])
        m.check(_make_df(2), regimes, [])
        triggers = m.check(_make_df(2), regimes, [])
        assert not any(t.trigger_type == TriggerType.REGIME_CHANGE for t in triggers)

    def test_regime_change_triggers(self):
        m = MarketMonitor()
        # 첫 호출: BULL 설정
        regimes1 = np.array(["BULL"])
        m.check(_make_df(1), regimes1, [])

        # 두 번째: BEAR로 전환
        regimes2 = np.array(["BEAR"])
        df = _make_df(MONITOR_ATR_LOOKBACK + 5)  # ATR 체크 통과용
        triggers = m.check(df, regimes2, [])

        regime_triggers = [t for t in triggers if t.trigger_type == TriggerType.REGIME_CHANGE]
        assert len(regime_triggers) == 1
        assert regime_triggers[0].severity == "HIGH"
        assert regime_triggers[0].old_value == "BULL"
        assert regime_triggers[0].new_value == "BEAR"

    def test_empty_regimes_no_trigger(self):
        m = MarketMonitor()
        triggers = m.check(_make_df(1), np.array([]), [])
        assert not any(t.trigger_type == TriggerType.REGIME_CHANGE for t in triggers)


class TestVolatilityDetection:
    """변동성 스파이크 감지 테스트."""

    def test_no_atr_column_skips(self):
        m = MarketMonitor()
        df = _make_df(60)
        df.drop(columns=["atr"], inplace=True)
        regimes = np.array(["SIDEWAYS"] * 60)
        m.check(df, regimes, [])  # 레짐 초기화
        triggers = m.check(df, regimes, [])
        assert not any(t.trigger_type == TriggerType.VOLATILITY_SPIKE for t in triggers)

    def test_normal_atr_no_trigger(self):
        m = MarketMonitor()
        df = _make_df(MONITOR_ATR_LOOKBACK + 5)
        regimes = np.array(["SIDEWAYS"] * len(df))
        m.check(df, regimes, [])  # 레짐 초기화
        triggers = m.check(df, regimes, [])
        assert not any(t.trigger_type == TriggerType.VOLATILITY_SPIKE for t in triggers)

    def test_atr_spike_triggers(self):
        m = MarketMonitor()
        n = MONITOR_ATR_LOOKBACK + 5
        df = _make_df(n)
        # 마지막 봉 ATR을 극단적으로 높임
        atr_vals = df["atr"].values.copy()
        atr_vals[-1] = atr_vals[0] * (MONITOR_ATR_SPIKE_MULT + 1)
        df["atr"] = atr_vals

        regimes = np.array(["SIDEWAYS"] * n)
        m.check(df, regimes, [])  # 레짐 초기화
        triggers = m.check(df, regimes, [])
        vol_triggers = [t for t in triggers if t.trigger_type == TriggerType.VOLATILITY_SPIKE]
        assert len(vol_triggers) == 1
        assert vol_triggers[0].severity == "MEDIUM"


class TestPerformanceDetection:
    """성과 하락 감지 테스트."""

    def test_insufficient_trades_skips(self):
        m = MarketMonitor()
        trades = [_FakeTrade(1.0)] * (MONITOR_PERF_MIN_TRADES - 1)
        regimes = np.array(["SIDEWAYS"])
        m.check(_make_df(1), regimes, [])  # 레짐 초기화
        triggers = m.check(_make_df(1), regimes, trades)
        assert not any(t.trigger_type == TriggerType.PERFORMANCE_DEGRADATION for t in triggers)

    def test_good_performance_no_trigger(self):
        m = MarketMonitor()
        trades = [_FakeTrade(2.0)] * MONITOR_PERF_MIN_TRADES
        regimes = np.array(["SIDEWAYS"])
        m.check(_make_df(1), regimes, [])
        triggers = m.check(_make_df(1), regimes, trades)
        assert not any(t.trigger_type == TriggerType.PERFORMANCE_DEGRADATION for t in triggers)

    def test_bad_performance_triggers(self):
        m = MarketMonitor()
        # 5건 모두 손실
        trades = [_FakeTrade(-1.0)] * MONITOR_PERF_MIN_TRADES
        regimes = np.array(["SIDEWAYS"])
        m.check(_make_df(1), regimes, [])
        triggers = m.check(_make_df(1), regimes, trades)
        perf_triggers = [t for t in triggers if t.trigger_type == TriggerType.PERFORMANCE_DEGRADATION]
        assert len(perf_triggers) == 1
        assert perf_triggers[0].severity == "HIGH"


class TestVolumeDetection:
    """거래량 이상 감지 테스트."""

    def test_no_volume_column_skips(self):
        m = MarketMonitor()
        df = _make_df(30)
        df.drop(columns=["volume"], inplace=True)
        regimes = np.array(["SIDEWAYS"] * 30)
        m.check(df, regimes, [])
        triggers = m.check(df, regimes, [])
        assert not any(t.trigger_type == TriggerType.VOLUME_ANOMALY for t in triggers)

    def test_normal_volume_no_trigger(self):
        m = MarketMonitor()
        n = MONITOR_VOL_MA_PERIOD + 5
        df = _make_df(n)
        regimes = np.array(["SIDEWAYS"] * n)
        m.check(df, regimes, [])
        triggers = m.check(df, regimes, [])
        assert not any(t.trigger_type == TriggerType.VOLUME_ANOMALY for t in triggers)

    def test_volume_spike_triggers(self):
        m = MarketMonitor()
        n = MONITOR_VOL_MA_PERIOD + 5
        df = _make_df(n)
        vol = df["volume"].values.copy()
        vol[-1] = vol[0] * (MONITOR_VOL_SPIKE_MULT + 1)  # 4x
        df["volume"] = vol

        regimes = np.array(["SIDEWAYS"] * n)
        m.check(df, regimes, [])
        triggers = m.check(df, regimes, [])
        vol_triggers = [t for t in triggers if t.trigger_type == TriggerType.VOLUME_ANOMALY]
        assert len(vol_triggers) == 1

    def test_volume_dry_triggers(self):
        m = MarketMonitor()
        n = MONITOR_VOL_MA_PERIOD + 5
        df = _make_df(n)
        vol = df["volume"].values.copy()
        vol[-1] = vol[0] * (MONITOR_VOL_DRY_MULT * 0.5)  # 매우 낮음
        df["volume"] = vol

        regimes = np.array(["SIDEWAYS"] * n)
        m.check(df, regimes, [])
        triggers = m.check(df, regimes, [])
        vol_triggers = [t for t in triggers if t.trigger_type == TriggerType.VOLUME_ANOMALY]
        assert len(vol_triggers) == 1


class TestTriggerHistory:
    """트리거 이력 추적 테스트."""

    def test_triggers_accumulated(self):
        m = MarketMonitor()
        # 레짐 전환 2회
        m.check(_make_df(1), np.array(["BULL"]), [])
        m.check(_make_df(1), np.array(["BEAR"]), [])
        m.check(_make_df(1), np.array(["SIDEWAYS"]), [])
        assert len(m.trigger_history) == 2  # 2번 전환


class TestMonitorTriggerDataclass:
    """MonitorTrigger 데이터클래스 테스트."""

    def test_fields(self):
        t = MonitorTrigger(
            trigger_type=TriggerType.REGIME_CHANGE,
            description="test",
            severity="HIGH",
            old_value="BULL",
            new_value="BEAR",
        )
        assert t.trigger_type == TriggerType.REGIME_CHANGE
        assert t.severity == "HIGH"
        assert t.old_value == "BULL"
        assert t.new_value == "BEAR"

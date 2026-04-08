"""실시간 시장 상태를 모니터링하고 리밸런싱 트리거를 발생시킨다."""
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

import numpy as np
import pandas as pd

import config


class TriggerType(Enum):
    """모니터링 트리거 유형."""
    REGIME_CHANGE = "REGIME_CHANGE"
    VOLATILITY_SPIKE = "VOLATILITY_SPIKE"
    PERFORMANCE_DEGRADATION = "PERFORMANCE_DEGRADATION"
    VOLUME_ANOMALY = "VOLUME_ANOMALY"


@dataclass
class MonitorTrigger:
    """시장 모니터링 트리거 이벤트."""
    trigger_type: TriggerType
    description: str
    severity: str       # "HIGH" / "MEDIUM" / "LOW"
    old_value: str
    new_value: str


# ── 모니터 설정 상수 ────────────────────────────────────────
MONITOR_ATR_SPIKE_MULT = 2.0       # ATR 스파이크 판정 배수
MONITOR_ATR_LOOKBACK = 50          # ATR 평균 비교 기간 (봉)
MONITOR_PERF_MIN_TRADES = 5        # 성과 판단 최소 거래 수
MONITOR_PERF_MIN_WR = 20.0         # 성과 하락 승률 기준 %
MONITOR_VOL_SPIKE_MULT = 3.0       # 거래량 급등 배수
MONITOR_VOL_DRY_MULT = 0.05        # 거래량 고갈 배수 (완화: 0.2→0.05)
MONITOR_VOL_MA_PERIOD = 20         # 거래량 이동평균 기간


class MarketMonitor:
    """4가지 조건을 실시간 감시하여 전략 리밸런싱 트리거를 발생시킨다.

    트리거 조건:
      1. 레짐 변경: 앙상블 레짐 전환 (BULL/SIDEWAYS/BEAR)
      2. 변동성 스파이크: ATR/가격 > 50봉 평균의 2배
      3. 성과 하락: 최근 5건 승률 < 20%
      4. 거래량 이상: 거래량 > 20MA×3 또는 < 20MA×0.2
    """

    def __init__(self) -> None:
        self._previous_regime: Optional[str] = None
        self._trigger_history: List[MonitorTrigger] = []

    @property
    def current_regime(self) -> str:
        """현재 감지된 레짐."""
        return self._previous_regime or "UNKNOWN"

    @property
    def trigger_history(self) -> List[MonitorTrigger]:
        """발생한 트리거 이력."""
        return self._trigger_history

    def check(
        self,
        df: pd.DataFrame,
        regimes: np.ndarray,
        recent_trades: list,
    ) -> List[MonitorTrigger]:
        """4가지 시장 조건을 점검하고 발동된 트리거 목록을 반환한다."""
        triggers: List[MonitorTrigger] = []
        for checker in [
            lambda: self._check_regime_change(regimes),
            lambda: self._check_volatility(df),
            lambda: self._check_performance(recent_trades),
            lambda: self._check_volume(df),
        ]:
            trigger = checker()
            if trigger is not None:
                triggers.append(trigger)
                self._trigger_history.append(trigger)
        return triggers

    def _check_regime_change(self, regimes: np.ndarray) -> Optional[MonitorTrigger]:
        """레짐 전환을 감지한다."""
        if len(regimes) == 0:
            return None
        current = str(regimes[-1])
        if self._previous_regime is None:
            self._previous_regime = current
            return None
        if current != self._previous_regime:
            old = self._previous_regime
            self._previous_regime = current
            return MonitorTrigger(
                trigger_type=TriggerType.REGIME_CHANGE,
                description=f"레짐 전환: {old} -> {current}",
                severity="HIGH",
                old_value=old,
                new_value=current,
            )
        return None

    def _check_volatility(self, df: pd.DataFrame) -> Optional[MonitorTrigger]:
        """ATR/가격 비율이 급등했는지 확인한다."""
        if "atr" not in df.columns or len(df) < MONITOR_ATR_LOOKBACK:
            return None
        atr = df["atr"].values
        close = df["close"].values
        current_atr_pct = atr[-1] / close[-1] * 100 if close[-1] > 0 else 0
        lookback = min(MONITOR_ATR_LOOKBACK, len(atr))
        safe_close = np.where(close[-lookback:] > 0, close[-lookback:], 1)
        avg_atr_pct = np.mean(atr[-lookback:] / safe_close) * 100
        if avg_atr_pct > 0 and current_atr_pct > avg_atr_pct * MONITOR_ATR_SPIKE_MULT:
            return MonitorTrigger(
                trigger_type=TriggerType.VOLATILITY_SPIKE,
                description=(
                    f"변동성 급등: ATR% {current_atr_pct:.2f} > "
                    f"평균 {avg_atr_pct:.2f} x {MONITOR_ATR_SPIKE_MULT}"
                ),
                severity="MEDIUM",
                old_value=f"{avg_atr_pct:.2f}%",
                new_value=f"{current_atr_pct:.2f}%",
            )
        return None

    def _check_performance(self, recent_trades: list) -> Optional[MonitorTrigger]:
        """최근 거래 승률이 급락했는지 확인한다."""
        if len(recent_trades) < MONITOR_PERF_MIN_TRADES:
            return None
        last_n = recent_trades[-MONITOR_PERF_MIN_TRADES:]
        wins = sum(1 for t in last_n if getattr(t, "pnl_pct", 0) > 0)
        wr = wins / MONITOR_PERF_MIN_TRADES * 100
        if wr < MONITOR_PERF_MIN_WR:
            return MonitorTrigger(
                trigger_type=TriggerType.PERFORMANCE_DEGRADATION,
                description=(
                    f"성과 하락: 최근 {MONITOR_PERF_MIN_TRADES}건 "
                    f"승률 {wr:.0f}% < {MONITOR_PERF_MIN_WR}%"
                ),
                severity="HIGH",
                old_value="",
                new_value=f"{wr:.0f}%",
            )
        return None

    def _check_volume(self, df: pd.DataFrame) -> Optional[MonitorTrigger]:
        """거래량 이상(급등/고갈)을 감지한다."""
        if "volume" not in df.columns or len(df) < MONITOR_VOL_MA_PERIOD + 1:
            return None
        vol = df["volume"].values
        vol_ma = np.mean(vol[-(MONITOR_VOL_MA_PERIOD + 1):-1])
        if vol_ma <= 0:
            return None
        current_vol = vol[-1]
        ratio = current_vol / vol_ma
        if ratio > MONITOR_VOL_SPIKE_MULT:
            return MonitorTrigger(
                trigger_type=TriggerType.VOLUME_ANOMALY,
                description=f"거래량 급등: {ratio:.1f}x > {MONITOR_VOL_SPIKE_MULT}x",
                severity="MEDIUM",
                old_value=f"{vol_ma:.0f}",
                new_value=f"{current_vol:.0f}",
            )
        if ratio < MONITOR_VOL_DRY_MULT:
            return MonitorTrigger(
                trigger_type=TriggerType.VOLUME_ANOMALY,
                description=f"거래량 고갈: {ratio:.2f}x < {MONITOR_VOL_DRY_MULT}x",
                severity="LOW",
                old_value=f"{vol_ma:.0f}",
                new_value=f"{current_vol:.0f}",
            )
        return None

"""그리드 전략 — 횡보장에서 범위 내 반복 매수/매도를 수행한다."""
import logging

import numpy as np
import pandas as pd

from strategy.base_strategy import BaseStrategy, Signal
from strategy.rsi_strategy import SignalContext

logger = logging.getLogger(__name__)


class GridStrategy(BaseStrategy):
    """
    빗썸 오토트레이딩 스타일의 그리드 전략.

    최근 N캔들의 고가/저가로 범위를 자동 설정하고,
    그 범위를 grid_count 등분하여 매수/매도 레벨을 배치한다.

    - 가격이 가장 가까운 하위 그리드 레벨 아래로 내려가면 BUY
    - 가격이 가장 가까운 상위 그리드 레벨 위로 올라가면 SELL
    - 범위 밖이면 HOLD

    Args:
        grid_count:          그리드 개수 (기본 10)
        range_period:        범위 계산에 쓰는 캔들 수 (기본 50)
        profit_per_grid_pct: 그리드당 목표 수익 % (기본 0.5)
    """

    def __init__(
        self,
        grid_count: int = 10,
        range_period: int = 50,
        profit_per_grid_pct: float = 0.5,
    ) -> None:
        self.grid_count = grid_count
        self.range_period = range_period
        self.profit_per_grid_pct = profit_per_grid_pct

    # ── BaseStrategy 인터페이스 ──────────────────────────────

    def generate_signal(self, df: pd.DataFrame) -> Signal:
        """단순 Signal 반환."""
        ctx = self.generate_signal_with_context(df)
        return ctx.signal

    def generate_signal_with_context(self, df: pd.DataFrame) -> SignalContext:
        """신호 + 컨텍스트를 반환한다."""
        if df is None or len(df) < self.range_period:
            return self._hold_context(
                f"데이터 부족 ({len(df) if df is not None else 0}개 < {self.range_period}개)"
            )

        try:
            close = df["close"].astype(float)
            high = df["high"].astype(float)
            low = df["low"].astype(float)

            # 범위 설정: 최근 range_period 캔들의 고/저
            recent_high = float(high.iloc[-self.range_period:].max())
            recent_low = float(low.iloc[-self.range_period:].min())

            if recent_high <= recent_low:
                return self._hold_context("고가 = 저가 → 범위 설정 불가")

            current_price = float(close.iloc[-1])
            grid_levels = self._compute_grid_levels(recent_low, recent_high)
            signal, reason = self._evaluate_grid_signal(
                current_price, grid_levels, recent_low, recent_high
            )

            # 거래량 비율 (간단 계산)
            volume = df["volume"].astype(float)
            vol_ratio = self._calc_volume_ratio(volume)

            indicators = {
                "grid_low": round(recent_low, 2),
                "grid_high": round(recent_high, 2),
                "grid_count": self.grid_count,
                "current_price": round(current_price, 2),
                "grid_levels_count": len(grid_levels),
                "volume_ratio": round(vol_ratio, 3),
            }

            return SignalContext(
                signal=signal,
                reason=reason,
                rsi_value=50.0,          # 그리드 전략은 RSI 미사용
                volume_ratio=round(vol_ratio, 3),
                trend="SIDEWAYS",        # 횡보장 전제
                volatility="MEDIUM",
                indicators=indicators,
            )

        except Exception as e:
            logger.error(f"그리드 신호 계산 오류: {e}")
            return self._hold_context(f"계산 오류: {e}")

    def precompute_signals(self, df: pd.DataFrame) -> pd.Series:
        """
        백테스트용 벡터화 신호 계산.

        각 캔들마다 최근 range_period 범위의 그리드를 계산하여
        BUY/SELL/HOLD를 결정한다.
        """
        signals = pd.Series("HOLD", index=df.index, dtype=str)
        close = df["close"].astype(float)
        high = df["high"].astype(float)
        low = df["low"].astype(float)

        for i in range(self.range_period, len(df)):
            window_high = float(high.iloc[i - self.range_period:i].max())
            window_low = float(low.iloc[i - self.range_period:i].min())

            if window_high <= window_low:
                continue

            price = float(close.iloc[i])
            grid_levels = self._compute_grid_levels(window_low, window_high)
            signal, _ = self._evaluate_grid_signal(
                price, grid_levels, window_low, window_high
            )
            signals.iloc[i] = signal

        return signals

    # ── 내부 메서드 ──────────────────────────────────────────

    def _compute_grid_levels(
        self, range_low: float, range_high: float
    ) -> list:
        """범위를 grid_count 등분한 가격 레벨 리스트를 반환한다."""
        return list(
            np.linspace(range_low, range_high, self.grid_count + 1)
        )

    def _evaluate_grid_signal(
        self,
        price: float,
        grid_levels: list,
        range_low: float,
        range_high: float,
    ) -> tuple:
        """
        현재 가격과 그리드 레벨을 비교하여 신호를 결정한다.

        Returns:
            (signal, reason)
        """
        # 범위 밖이면 HOLD
        if price <= range_low or price >= range_high:
            return "HOLD", (
                f"가격 {price:,.0f}이 그리드 범위 "
                f"({range_low:,.0f}~{range_high:,.0f}) 밖"
            )

        # 가장 가까운 하위/상위 그리드 레벨 찾기
        below_levels = [lv for lv in grid_levels if lv <= price]
        above_levels = [lv for lv in grid_levels if lv > price]

        if not below_levels or not above_levels:
            return "HOLD", "그리드 레벨 계산 오류"

        nearest_below = max(below_levels)
        nearest_above = min(above_levels)

        # 가격이 하위 레벨에 가까우면 (하위 1/3 구간) BUY
        grid_span = nearest_above - nearest_below
        if grid_span <= 0:
            return "HOLD", "그리드 간격 0"

        position_in_grid = (price - nearest_below) / grid_span

        if position_in_grid < 0.33:
            return "BUY", (
                f"그리드 하단 접근 "
                f"(가격 {price:,.0f}, 하위레벨 {nearest_below:,.0f}, "
                f"위치 {position_in_grid:.0%})"
            )
        elif position_in_grid > 0.67:
            return "SELL", (
                f"그리드 상단 접근 "
                f"(가격 {price:,.0f}, 상위레벨 {nearest_above:,.0f}, "
                f"위치 {position_in_grid:.0%})"
            )

        return "HOLD", (
            f"그리드 중앙 대기 (위치 {position_in_grid:.0%})"
        )

    def _calc_volume_ratio(self, volume: pd.Series) -> float:
        """현재 거래량 / 최근 20봉 평균 거래량."""
        window = min(20, len(volume) - 1)
        if window <= 0:
            return 1.0
        avg = volume.iloc[-(window + 1):-1].mean()
        current = volume.iloc[-1]
        return float(current / avg) if avg > 0 else 1.0

    def _hold_context(self, reason: str) -> SignalContext:
        """기본 HOLD 컨텍스트를 반환한다."""
        return SignalContext(
            signal="HOLD",
            reason=reason,
            rsi_value=50.0,
            volume_ratio=1.0,
            trend="SIDEWAYS",
            volatility="MEDIUM",
        )

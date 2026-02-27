"""
MACD 전략 구현

진입 조건: MACD 라인이 시그널 라인을 상향 돌파 (골든 크로스)
청산 조건: MACD 라인이 시그널 라인을 하향 돌파 (데드 크로스)
"""
import logging
from typing import Optional

import pandas as pd
import ta

from strategy.base_strategy import BaseStrategy, Signal

logger = logging.getLogger(__name__)


class MACDStrategy(BaseStrategy):
    """
    MACD 크로스오버 전략.

    Args:
        fast_period: 빠른 EMA 기간 (기본 12)
        slow_period: 느린 EMA 기간 (기본 26)
        signal_period: 시그널 라인 기간 (기본 9)
    """

    def __init__(
        self,
        fast_period: int = 12,
        slow_period: int = 26,
        signal_period: int = 9,
    ) -> None:
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.signal_period = signal_period

    def generate_signal(self, df: pd.DataFrame) -> Signal:
        min_rows = self.slow_period + self.signal_period + 5
        if df is None or len(df) < min_rows:
            return "HOLD"

        try:
            close = df["close"].astype(float)
            macd_ind = ta.trend.MACD(
                close=close,
                window_fast=self.fast_period,
                window_slow=self.slow_period,
                window_sign=self.signal_period,
            )
            macd_line = macd_ind.macd()
            signal_line = macd_ind.macd_signal()

            # 최근 2개 캔들의 MACD-Signal 차이
            curr_diff = macd_line.iloc[-1] - signal_line.iloc[-1]
            prev_diff = macd_line.iloc[-2] - signal_line.iloc[-2]

            # 골든 크로스: 이전에 아래 → 현재 위
            if prev_diff <= 0 and curr_diff > 0:
                return "BUY"
            # 데드 크로스: 이전에 위 → 현재 아래
            if prev_diff >= 0 and curr_diff < 0:
                return "SELL"

            return "HOLD"

        except Exception as e:
            logger.error(f"MACD 신호 계산 오류: {e}")
            return "HOLD"

    def precompute_signals(self, df: pd.DataFrame) -> pd.Series:
        """백테스트용 O(n) 전체 신호 사전 계산"""
        close = df["close"].astype(float)
        macd_ind = ta.trend.MACD(
            close=close,
            window_fast=self.fast_period,
            window_slow=self.slow_period,
            window_sign=self.signal_period,
        )
        macd_line = macd_ind.macd()
        signal_line = macd_ind.macd_signal()

        diff = macd_line - signal_line
        prev_diff = diff.shift(1)

        signals = pd.Series("HOLD", index=df.index, dtype=str)
        # 골든 크로스
        signals[(prev_diff <= 0) & (diff > 0)] = "BUY"
        # 데드 크로스
        signals[(prev_diff >= 0) & (diff < 0)] = "SELL"
        # NaN 구간
        signals[diff.isna() | prev_diff.isna()] = "HOLD"

        return signals

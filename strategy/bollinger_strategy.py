"""
볼린저 밴드 전략 구현

진입 조건: 가격이 하단 밴드를 하향 돌파 후 복귀 (반등 포착)
청산 조건: 가격이 중간 밴드(SMA) 또는 상단 밴드 돌파
"""
import logging

import pandas as pd
import ta

from strategy.base_strategy import BaseStrategy, Signal

logger = logging.getLogger(__name__)


class BollingerStrategy(BaseStrategy):
    """
    볼린저 밴드 평균 회귀 전략.

    Args:
        window: 볼린저 밴드 SMA 기간 (기본 20)
        std_dev: 표준편차 배수 (기본 2.0)
        exit_at_middle: True면 중간밴드에서 청산, False면 상단밴드에서 청산
    """

    def __init__(
        self,
        window: int = 20,
        std_dev: float = 2.0,
        exit_at_middle: bool = True,
    ) -> None:
        self.window = window
        self.std_dev = std_dev
        self.exit_at_middle = exit_at_middle

    def generate_signal(self, df: pd.DataFrame) -> Signal:
        min_rows = self.window + 5
        if df is None or len(df) < min_rows:
            return "HOLD"

        try:
            close = df["close"].astype(float)
            bb = ta.volatility.BollingerBands(
                close=close, window=self.window, window_dev=self.std_dev
            )
            lower = bb.bollinger_lband()
            middle = bb.bollinger_mavg()
            upper = bb.bollinger_hband()

            curr_close = close.iloc[-1]
            prev_close = close.iloc[-2]
            curr_lower = lower.iloc[-1]
            prev_lower = lower.iloc[-2]

            # 매수: 이전에 하단밴드 아래 → 현재 복귀 (반등)
            if prev_close <= prev_lower and curr_close > curr_lower:
                return "BUY"

            # 매도: 중간밴드 또는 상단밴드 돌파
            if self.exit_at_middle:
                if curr_close >= middle.iloc[-1]:
                    return "SELL"
            else:
                if curr_close >= upper.iloc[-1]:
                    return "SELL"

            return "HOLD"

        except Exception as e:
            logger.error(f"볼린저 신호 계산 오류: {e}")
            return "HOLD"

    def precompute_signals(self, df: pd.DataFrame) -> pd.Series:
        """백테스트용 O(n) 전체 신호 사전 계산"""
        close = df["close"].astype(float)
        bb = ta.volatility.BollingerBands(
            close=close, window=self.window, window_dev=self.std_dev
        )
        lower = bb.bollinger_lband()
        middle = bb.bollinger_mavg()
        upper = bb.bollinger_hband()

        prev_close = close.shift(1)
        prev_lower = lower.shift(1)

        signals = pd.Series("HOLD", index=df.index, dtype=str)

        # 매수: 이전에 하단밴드 이하 → 현재 복귀
        buy_cond = (prev_close <= prev_lower) & (close > lower)
        signals[buy_cond] = "BUY"

        # 매도
        if self.exit_at_middle:
            sell_cond = close >= middle
        else:
            sell_cond = close >= upper
        signals[sell_cond] = "SELL"

        # NaN 구간
        signals[lower.isna() | prev_close.isna()] = "HOLD"

        return signals

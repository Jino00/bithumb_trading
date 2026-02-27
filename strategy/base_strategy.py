"""
전략 추상 기본 클래스
새 전략은 반드시 BaseStrategy를 상속하고 generate_signal()을 구현해야 한다.
"""
from abc import ABC, abstractmethod
from typing import Literal

import pandas as pd

Signal = Literal["BUY", "SELL", "HOLD"]


class BaseStrategy(ABC):
    """
    모든 트레이딩 전략의 기본 클래스.

    구현 필수:
        generate_signal(df) -> Signal
    """

    @abstractmethod
    def generate_signal(self, df: pd.DataFrame) -> Signal:
        """
        캔들 데이터를 받아 매수/매도/홀딩 신호를 반환한다.

        Args:
            df: OHLCV DataFrame (columns: open, high, low, close, volume)

        Returns:
            'BUY' | 'SELL' | 'HOLD'
        """

    @property
    def name(self) -> str:
        return self.__class__.__name__

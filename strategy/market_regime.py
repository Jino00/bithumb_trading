"""시장 상태 감지기 — ADX 기반으로 추세장/횡보장을 판별한다."""
import logging
from dataclasses import dataclass
from enum import Enum

import pandas as pd
import ta


logger = logging.getLogger(__name__)


class MarketRegime(Enum):
    """시장 상태 분류."""
    TRENDING_UP = "TRENDING_UP"
    TRENDING_DOWN = "TRENDING_DOWN"
    RANGE_BOUND = "RANGE_BOUND"


@dataclass
class RegimeDetail:
    """시장 상태 감지 결과 상세."""
    regime: MarketRegime
    adx_value: float
    plus_di: float
    minus_di: float
    confidence: str          # HIGH / MEDIUM / LOW


class MarketRegimeDetector:
    """
    ADX(Average Directional Index)로 시장 상태를 감지한다.

    판정 기준:
        ADX >= adx_trend_threshold  → 추세장 (DI로 방향 판별)
        ADX < adx_range_threshold   → 횡보장
        그 사이(전환 구간)           → 이전 상태 유지 (히스테리시스)

    Args:
        adx_period:           ADX 계산 기간 (기본 14)
        adx_trend_threshold:  추세장 판정 ADX 값 (기본 25.0)
        adx_range_threshold:  횡보장 판정 ADX 값 (기본 20.0)
    """

    def __init__(
        self,
        adx_period: int = 14,
        adx_trend_threshold: float = 25.0,
        adx_range_threshold: float = 20.0,
    ) -> None:
        self.adx_period = adx_period
        self.adx_trend_threshold = adx_trend_threshold
        self.adx_range_threshold = adx_range_threshold
        self._previous_regime: MarketRegime = MarketRegime.RANGE_BOUND

    def detect(self, df: pd.DataFrame) -> MarketRegime:
        """현재 시장 상태를 반환한다."""
        detail = self.detect_with_detail(df)
        return detail.regime

    def detect_with_detail(self, df: pd.DataFrame) -> RegimeDetail:
        """시장 상태와 상세 지표를 반환한다."""
        min_rows = self.adx_period + 5
        if df is None or len(df) < min_rows:
            logger.warning(
                f"데이터 부족 ({len(df) if df is not None else 0}개 < {min_rows}개)"
            )
            return RegimeDetail(
                regime=self._previous_regime,
                adx_value=0.0,
                plus_di=0.0,
                minus_di=0.0,
                confidence="LOW",
            )

        try:
            high = df["high"].astype(float)
            low = df["low"].astype(float)
            close = df["close"].astype(float)

            adx_indicator = ta.trend.ADXIndicator(
                high=high, low=low, close=close, window=self.adx_period
            )
            adx_value = float(adx_indicator.adx().iloc[-1])
            plus_di = float(adx_indicator.adx_pos().iloc[-1])
            minus_di = float(adx_indicator.adx_neg().iloc[-1])

            regime = self._classify_regime(adx_value, plus_di, minus_di)
            confidence = self._assess_confidence(adx_value)

            self._previous_regime = regime

            logger.debug(
                f"ADX={adx_value:.1f} +DI={plus_di:.1f} -DI={minus_di:.1f} "
                f"→ {regime.value} ({confidence})"
            )

            return RegimeDetail(
                regime=regime,
                adx_value=round(adx_value, 2),
                plus_di=round(plus_di, 2),
                minus_di=round(minus_di, 2),
                confidence=confidence,
            )

        except Exception as e:
            logger.error(f"시장 상태 감지 오류: {e}")
            return RegimeDetail(
                regime=self._previous_regime,
                adx_value=0.0,
                plus_di=0.0,
                minus_di=0.0,
                confidence="LOW",
            )

    def _classify_regime(
        self, adx: float, plus_di: float, minus_di: float
    ) -> MarketRegime:
        """ADX + DI로 시장 상태를 분류한다."""
        if adx >= self.adx_trend_threshold:
            # 추세장 — DI 방향으로 판별
            if plus_di > minus_di:
                return MarketRegime.TRENDING_UP
            return MarketRegime.TRENDING_DOWN

        if adx < self.adx_range_threshold:
            return MarketRegime.RANGE_BOUND

        # 전환 구간 (range_threshold ≤ ADX < trend_threshold) → 이전 상태 유지
        return self._previous_regime

    def _assess_confidence(self, adx: float) -> str:
        """ADX 강도에 따른 신뢰도 평가."""
        if adx >= self.adx_trend_threshold + 10:
            return "HIGH"
        if adx >= self.adx_trend_threshold:
            return "MEDIUM"
        if adx < self.adx_range_threshold:
            return "MEDIUM"
        # 전환 구간
        return "LOW"

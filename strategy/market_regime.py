"""시장 상태 감지기 — ADX 기반 + 7채널 앙상블로 추세장/횡보장을 판별한다."""
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import List

import numpy as np
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


@dataclass
class EnsembleDetail:
    """앙상블 레짐 감지 결과 상세."""
    regime: MarketRegime
    weighted_score: float
    channel_scores: List[float] = field(default_factory=list)
    channel_names: List[str] = field(default_factory=lambda: [
        "ema_alignment", "ema_slope", "adx_direction",
        "macd_histogram", "bb_position", "rsi_level", "volume_direction",
    ])
    confidence: str = "MEDIUM"


class EnsembleRegimeDetector:
    """
    7채널 가중 앙상블로 시장 레짐을 감지한다.

    채널: EMA정렬, EMA기울기, ADX방향, MACD히스토그램, BB위치, RSI레벨, 거래량방향
    각 채널 -1.0(BEAR) ~ +1.0(BULL) 스코어 → 가중 합산 → 임계값으로 분류.
    """

    CHANNEL_NAMES = [
        "ema_alignment", "ema_slope", "adx_direction",
        "macd_histogram", "bb_position", "rsi_level", "volume_direction",
    ]

    def __init__(
        self,
        weights: List[float] | None = None,
        bull_threshold: float = 0.3,
        bear_threshold: float = -0.3,
        ema_slope_window: int = 5,
        volume_ma_period: int = 20,
    ) -> None:
        self.weights = weights or [0.20, 0.15, 0.15, 0.15, 0.10, 0.10, 0.15]
        self.bull_threshold = bull_threshold
        self.bear_threshold = bear_threshold
        self.ema_slope_window = ema_slope_window
        self.volume_ma_period = volume_ma_period

    def detect(self, df: pd.DataFrame) -> MarketRegime:
        """현재 시장 레짐을 반환한다."""
        detail = self.detect_with_detail(df)
        return detail.regime

    def detect_with_detail(self, df: pd.DataFrame) -> EnsembleDetail:
        """시장 레짐과 채널별 상세 스코어를 반환한다."""
        if df is None or len(df) < 210:
            return EnsembleDetail(
                regime=MarketRegime.RANGE_BOUND,
                weighted_score=0.0,
                confidence="LOW",
            )
        try:
            scores = self._compute_all_scores(df)
            ws = sum(w * s for w, s in zip(self.weights, scores))
            regime = self._classify(ws)
            confidence = self._assess_confidence(ws)
            return EnsembleDetail(
                regime=regime,
                weighted_score=round(ws, 4),
                channel_scores=[round(s, 4) for s in scores],
                confidence=confidence,
            )
        except Exception as e:
            logger.error(f"앙상블 레짐 감지 오류: {e}")
            return EnsembleDetail(
                regime=MarketRegime.RANGE_BOUND,
                weighted_score=0.0,
                confidence="LOW",
            )

    def detect_at(self, df: pd.DataFrame, idx: int) -> MarketRegime:
        """특정 인덱스 시점의 레짐을 반환한다 (백테스트용)."""
        if idx < 210:
            return MarketRegime.RANGE_BOUND
        sub = df.iloc[:idx + 1]
        return self.detect(sub)

    def detect_at_with_scores(
        self, df: pd.DataFrame, idx: int
    ) -> tuple[MarketRegime, float, list[float]]:
        """특정 인덱스 시점의 레짐 + 점수 + 채널 스코어 (백테스트용)."""
        if idx < 210:
            return MarketRegime.RANGE_BOUND, 0.0, [0.0] * 7
        sub = df.iloc[:idx + 1]
        detail = self.detect_with_detail(sub)
        return detail.regime, detail.weighted_score, detail.channel_scores

    # ── 채널 스코어 계산 ────────────────────────────────────

    def _compute_all_scores(self, df: pd.DataFrame) -> List[float]:
        """7개 채널 스코어를 한꺼번에 계산한다."""
        close = df["close"].astype(float)
        high = df["high"].astype(float)
        low = df["low"].astype(float)
        volume = df["volume"].astype(float)

        return [
            self._score_ema_alignment(close),
            self._score_ema_slope(close),
            self._score_adx(high, low, close),
            self._score_macd(close),
            self._score_bb_position(close),
            self._score_rsi_level(close),
            self._score_volume(close, volume),
        ]

    def _score_ema_alignment(self, close: pd.Series) -> float:
        """EMA 정렬 상태 → -1.0 ~ +1.0."""
        ema20 = close.ewm(span=20).mean().iloc[-1]
        ema50 = close.ewm(span=50).mean().iloc[-1]
        ema200 = close.ewm(span=200).mean().iloc[-1]
        if ema20 > ema50 > ema200:
            return 1.0
        if ema20 < ema50 < ema200:
            return -1.0
        if ema20 > ema50:
            return 0.5
        if ema20 < ema50:
            return -0.5
        return 0.0

    def _score_ema_slope(self, close: pd.Series) -> float:
        """EMA50 기울기 → -1.0 ~ +1.0."""
        ema50 = close.ewm(span=50).mean()
        window = self.ema_slope_window
        if len(ema50) < window + 1:
            return 0.0
        slope_pct = (ema50.iloc[-1] / ema50.iloc[-window] - 1.0) * 100
        return float(np.clip(slope_pct / 2.0, -1.0, 1.0))

    def _score_adx(
        self, high: pd.Series, low: pd.Series, close: pd.Series
    ) -> float:
        """ADX + DI 방향 → -1.0 ~ +1.0."""
        adx_ind = ta.trend.ADXIndicator(high=high, low=low, close=close, window=14)
        adx = float(adx_ind.adx().iloc[-1])
        plus_di = float(adx_ind.adx_pos().iloc[-1])
        minus_di = float(adx_ind.adx_neg().iloc[-1])
        if adx < 20:
            return 0.0
        direction = 1.0 if plus_di > minus_di else -1.0
        strength = min(adx / 50.0, 1.0)
        return direction * strength

    def _score_macd(self, close: pd.Series) -> float:
        """MACD 히스토그램 방향 + 기울기 → -1.0 ~ +1.0."""
        macd_ind = ta.trend.MACD(close=close)
        hist = macd_ind.macd_diff()
        if len(hist) < 3:
            return 0.0
        h_now = float(hist.iloc[-1])
        h_prev = float(hist.iloc[-2])
        price = float(close.iloc[-1])
        if price == 0:
            return 0.0
        norm = h_now / price * 1000
        direction = 1.0 if h_now > 0 else -1.0
        momentum = 1.0 if (h_now > h_prev and h_now > 0) or (h_now < h_prev and h_now < 0) else 0.5
        return float(np.clip(direction * abs(norm) * momentum, -1.0, 1.0))

    def _score_bb_position(self, close: pd.Series) -> float:
        """BB 내 종가 위치 → -1.0 ~ +1.0."""
        bb = ta.volatility.BollingerBands(close=close, window=20, window_dev=2)
        upper = float(bb.bollinger_hband().iloc[-1])
        lower = float(bb.bollinger_lband().iloc[-1])
        mid = float(bb.bollinger_mavg().iloc[-1])
        price = float(close.iloc[-1])
        band_width = upper - lower
        if band_width == 0:
            return 0.0
        position = (price - mid) / (band_width / 2)
        return float(np.clip(position, -1.0, 1.0))

    def _score_rsi_level(self, close: pd.Series) -> float:
        """RSI 레벨 → -1.0 ~ +1.0."""
        rsi = ta.momentum.RSIIndicator(close=close, window=14).rsi()
        rsi_val = float(rsi.iloc[-1])
        return float(np.clip((rsi_val - 50) / 50, -1.0, 1.0))

    def _score_volume(self, close: pd.Series, volume: pd.Series) -> float:
        """거래량 방향 (양봉/음봉 * 거래량비율) → -1.0 ~ +1.0."""
        vol_ma = volume.rolling(self.volume_ma_period).mean()
        if len(vol_ma) < 2 or float(vol_ma.iloc[-1]) == 0:
            return 0.0
        vol_ratio = float(volume.iloc[-1]) / float(vol_ma.iloc[-1])
        price_change = float(close.iloc[-1]) - float(close.iloc[-2])
        direction = 1.0 if price_change > 0 else -1.0
        return float(np.clip(direction * min(vol_ratio, 2.0) / 2.0, -1.0, 1.0))

    # ── 분류 + 신뢰도 ───────────────────────────────────────

    def _classify(self, weighted_score: float) -> MarketRegime:
        """가중 합산 점수로 레짐 분류."""
        if weighted_score > self.bull_threshold:
            return MarketRegime.TRENDING_UP
        if weighted_score < self.bear_threshold:
            return MarketRegime.TRENDING_DOWN
        return MarketRegime.RANGE_BOUND

    def _assess_confidence(self, ws: float) -> str:
        """가중 점수 절대값 기준 신뢰도."""
        abs_ws = abs(ws)
        if abs_ws > 0.6:
            return "HIGH"
        if abs_ws > 0.3:
            return "MEDIUM"
        return "LOW"

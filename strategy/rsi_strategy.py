"""
RSI 전략 구현

진입 조건: RSI < oversold (기본 30) — 과매도 신호
청산 조건: RSI > overbought (기본 70) — 과매수 신호
보조 지표: 거래량 비율, 추세(EMA), 변동성(ATR)

generate_signal()             → Signal (BaseStrategy 인터페이스 호환)
generate_signal_with_context() → SignalContext (지표 스냅샷 + 자연어 이유 포함)
"""
import logging
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd
import ta

import config
from strategy.base_strategy import BaseStrategy, Signal

logger = logging.getLogger(__name__)


# ── 신호 컨텍스트 ─────────────────────────────────────────────────────────────

@dataclass
class SignalContext:
    """전략 신호와 모든 지표 스냅샷을 함께 반환한다."""
    signal: Signal
    reason: str                        # 자연어 이유 (예: "RSI 27.3으로 과매도 진입, 거래량 1.8배 급증")
    rsi_value: float
    volume_ratio: float                # 현재 거래량 / 20봉 평균
    trend: str                         # UPTREND / DOWNTREND / SIDEWAYS
    volatility: str                    # HIGH / MEDIUM / LOW
    indicators: dict = field(default_factory=dict)  # 전체 지표 스냅샷


# ── RSI 전략 ──────────────────────────────────────────────────────────────────

class RSIStrategy(BaseStrategy):
    """
    RSI + 보조 지표(EMA 추세, ATR 변동성, 거래량) 기반 전략.

    Args:
        period:     RSI 계산 기간 (기본 14)
        oversold:   매수 임계값 (기본 30.0)
        overbought: 매도 임계값 (기본 70.0)
        ema_short:  단기 EMA (기본 20)
        ema_long:   장기 EMA (기본 50)
        vol_window: 거래량 비교 기간 (기본 20)
        atr_period: ATR 기간 (기본 14)
    """

    def __init__(
        self,
        period: int = 14,
        oversold: float = 30.0,
        overbought: float = 70.0,
        ema_short: int = 20,
        ema_long: int = 50,
        vol_window: int = 20,
        atr_period: int = 14,
    ) -> None:
        self.period = period
        self.oversold = oversold
        self.overbought = overbought
        self.ema_short = ema_short
        self.ema_long = ema_long
        self.vol_window = vol_window
        self.atr_period = atr_period

    # ── BaseStrategy 인터페이스 ────────────────────────────

    def generate_signal(self, df: pd.DataFrame) -> Signal:
        """단순 Signal 반환 (BacktestEngine 호환)"""
        ctx = self.generate_signal_with_context(df)
        return ctx.signal

    # ── 상세 컨텍스트 신호 ─────────────────────────────────

    def generate_signal_with_context(self, df: pd.DataFrame) -> SignalContext:
        """
        신호와 함께 모든 지표 스냅샷 및 자연어 이유를 반환한다.

        Returns:
            SignalContext
        """
        min_rows = max(self.period, self.ema_long, self.vol_window, self.atr_period) + 5
        if df is None or len(df) < min_rows:
            return SignalContext(
                signal="HOLD",
                reason=f"데이터 부족 ({len(df) if df is not None else 0}개 < {min_rows}개 필요)",
                rsi_value=50.0,
                volume_ratio=1.0,
                trend="SIDEWAYS",
                volatility="MEDIUM",
            )

        try:
            close = df["close"].astype(float)
            high = df["high"].astype(float)
            low = df["low"].astype(float)
            volume = df["volume"].astype(float)

            # ── 지표 계산 ──────────────────────────────────
            rsi = self._calc_rsi(close)
            ema_s, ema_l = self._calc_ema(close)
            vol_ratio = self._calc_volume_ratio(volume)
            atr_pct = self._calc_atr_pct(high, low, close)
            trend = self._detect_trend(ema_s, ema_l)
            volatility = self._classify_volatility(atr_pct)

            indicators = {
                "rsi": round(float(rsi), 2),
                "ema_short": round(float(ema_s), 2),
                "ema_long": round(float(ema_l), 2),
                "volume_ratio": round(float(vol_ratio), 3),
                "atr_pct": round(float(atr_pct), 4),
                "trend": trend,
                "volatility": volatility,
                "close": round(float(close.iloc[-1]), 2),
            }

            # ── 신호 결정 ──────────────────────────────────
            signal: Signal = "HOLD"
            if rsi < self.oversold:
                signal = "BUY"
            elif rsi > self.overbought:
                signal = "SELL"

            reason = self._build_reason(signal, rsi, vol_ratio, trend, atr_pct)

            logger.debug(
                f"RSI={rsi:.1f} vol_ratio={vol_ratio:.2f} "
                f"trend={trend} volatility={volatility} → {signal}"
            )

            return SignalContext(
                signal=signal,
                reason=reason,
                rsi_value=round(float(rsi), 2),
                volume_ratio=round(float(vol_ratio), 3),
                trend=trend,
                volatility=volatility,
                indicators=indicators,
            )

        except Exception as e:
            logger.error(f"신호 계산 오류: {e}")
            return SignalContext(
                signal="HOLD",
                reason=f"계산 오류: {e}",
                rsi_value=50.0,
                volume_ratio=1.0,
                trend="SIDEWAYS",
                volatility="MEDIUM",
            )

    # ── 지표 계산 내부 메서드 ──────────────────────────────

    def calculate_rsi(self, df: pd.DataFrame) -> pd.Series:
        """전체 RSI 시리즈 반환 (백테스트 엔진용)"""
        return self._calc_rsi_series(df["close"].astype(float))

    def precompute_signals(self, df: pd.DataFrame) -> pd.Series:
        """
        DataFrame 전체에 대해 신호를 한 번에 계산한다 (백테스트 최적화용).
        O(n) — 개별 캔들마다 RSI를 재계산하지 않는다.

        Returns:
            pd.Series[str]: 인덱스별 'BUY' | 'SELL' | 'HOLD'
        """
        close = df["close"].astype(float)
        rsi = self._calc_rsi_series(close)

        signals = pd.Series("HOLD", index=df.index, dtype=str)
        signals[rsi < self.oversold] = "BUY"
        signals[rsi > self.overbought] = "SELL"
        # RSI가 NaN인 구간(워밍업)은 HOLD
        signals[rsi.isna()] = "HOLD"
        return signals

    def _calc_rsi(self, close: pd.Series) -> float:
        """최신 RSI 값 반환"""
        return self._calc_rsi_series(close).iloc[-1]

    def _calc_rsi_series(self, close: pd.Series) -> pd.Series:
        return ta.momentum.RSIIndicator(close=close, window=self.period).rsi()

    def _calc_ema(self, close: pd.Series):
        """(단기 EMA 최신값, 장기 EMA 최신값)"""
        ema_s = close.ewm(span=self.ema_short, adjust=False).mean().iloc[-1]
        ema_l = close.ewm(span=self.ema_long, adjust=False).mean().iloc[-1]
        return ema_s, ema_l

    def _calc_volume_ratio(self, volume: pd.Series) -> float:
        """현재 거래량 / 최근 vol_window봉 평균 거래량"""
        if len(volume) < self.vol_window + 1:
            return 1.0
        avg = volume.iloc[-(self.vol_window + 1):-1].mean()
        current = volume.iloc[-1]
        return float(current / avg) if avg > 0 else 1.0

    def _calc_atr_pct(self, high: pd.Series, low: pd.Series, close: pd.Series) -> float:
        """ATR(%) — 현재 변동성을 가격 대비 비율로 표현"""
        atr_series = ta.volatility.AverageTrueRange(
            high=high, low=low, close=close, window=self.atr_period
        ).average_true_range()
        atr = atr_series.iloc[-1]
        price = close.iloc[-1]
        return float(atr / price * 100) if price > 0 else 0.0

    def _detect_trend(self, ema_s: float, ema_l: float) -> str:
        """EMA 크로스로 추세 분류"""
        diff_pct = (ema_s - ema_l) / ema_l * 100 if ema_l else 0
        if diff_pct > config.EMA_TREND_THRESHOLD:
            return "UPTREND"
        elif diff_pct < -config.EMA_TREND_THRESHOLD:
            return "DOWNTREND"
        return "SIDEWAYS"

    def _classify_volatility(self, atr_pct: float) -> str:
        """ATR%로 변동성 등급 분류"""
        if atr_pct >= config.ATR_HIGH_VOLATILITY:
            return "HIGH"
        elif atr_pct >= config.ATR_MEDIUM_VOLATILITY:
            return "MEDIUM"
        return "LOW"

    # ── 자연어 이유 생성 ───────────────────────────────────

    def _build_reason(
        self,
        signal: Signal,
        rsi: float,
        vol_ratio: float,
        trend: str,
        atr_pct: float,
    ) -> str:
        """
        신호별 자연어 설명 생성.
        예: "RSI 27.3으로 과매도 진입, 거래량 1.8배 급증, 상승 추세"
        """
        parts = []

        if signal == "BUY":
            parts.append(f"RSI {rsi:.1f}로 과매도 진입 (기준: {self.oversold})")
            if vol_ratio >= config.VOLUME_HIGH_RATIO:
                parts.append(f"거래량 {vol_ratio:.1f}배 급증")
            elif vol_ratio < config.VOLUME_LOW_RATIO:
                parts.append(f"거래량 저조 ({vol_ratio:.1f}배)")
            if trend == "UPTREND":
                parts.append("상승 추세 확인")
            elif trend == "DOWNTREND":
                parts.append("하락 추세 중 역추세 진입")
            if atr_pct >= config.ATR_HIGH_VOLATILITY:
                parts.append(f"고변동성 구간 (ATR {atr_pct:.1f}%)")

        elif signal == "SELL":
            parts.append(f"RSI {rsi:.1f}로 과매수 청산 (기준: {self.overbought})")
            if vol_ratio >= config.VOLUME_HIGH_RATIO:
                parts.append(f"거래량 {vol_ratio:.1f}배 급증")
            if trend == "DOWNTREND":
                parts.append("하락 추세 전환 감지")

        else:
            parts.append(
                f"RSI {rsi:.1f} — 진입 조건 미충족 "
                f"(매수<{self.oversold}, 매도>{self.overbought})"
            )

        return ", ".join(parts)

    @staticmethod
    def build_exit_reason(
        rsi: Optional[float],
        pnl_pct: float,
        stop_loss_pct: float,
        take_profit_pct: float,
        overbought: float,
    ) -> str:
        """
        청산 이유 자연어 생성 (main.py에서 호출).

        Args:
            rsi: 청산 시점 RSI (None이면 가격 기반 청산)
            pnl_pct: 현재 손익률 %
            stop_loss_pct: 손절 기준 %
            take_profit_pct: 익절 기준 %
            overbought: RSI 과매수 기준
        """
        if pnl_pct <= -stop_loss_pct:
            return f"손절 -{stop_loss_pct:.1f}% 도달 (pnl={pnl_pct:.2f}%)"
        if pnl_pct >= take_profit_pct:
            return f"익절 +{take_profit_pct:.1f}% 도달 (pnl={pnl_pct:.2f}%)"
        if rsi is not None and rsi > overbought:
            return f"RSI {rsi:.1f}로 과매수 청산 (pnl={pnl_pct:.2f}%)"
        return f"전략 청산 신호 (pnl={pnl_pct:.2f}%)"

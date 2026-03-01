"""복합 전략 — 시장 상태에 따라 RSI/Grid 전략을 자동 전환한다."""
import logging

import pandas as pd

from strategy.base_strategy import BaseStrategy, Signal
from strategy.grid_strategy import GridStrategy
from strategy.market_regime import MarketRegime, MarketRegimeDetector, RegimeDetail
from strategy.rsi_strategy import RSIStrategy, SignalContext

logger = logging.getLogger(__name__)


class RegimeAwareStrategy(BaseStrategy):
    """
    시장 상태(Regime)에 따라 서브 전략을 자동 전환한다.

    매핑:
        RANGE_BOUND   → GridStrategy  (횡보장: 그리드 반복 매매)
        TRENDING_UP   → RSIStrategy   (상승추세: RSI 역추세 진입)
        TRENDING_DOWN → HOLD          (하락추세: 매수 차단, 기존 포지션만 청산)

    TradingBot에 투명하게 작동한다 (BaseStrategy 인터페이스 + 호환 속성 위임).
    """

    def __init__(
        self,
        rsi_strategy: RSIStrategy,
        grid_strategy: GridStrategy,
        detector: MarketRegimeDetector,
    ) -> None:
        self.rsi_strategy = rsi_strategy
        self.grid_strategy = grid_strategy
        self.detector = detector
        self._current_regime: MarketRegime = MarketRegime.RANGE_BOUND
        self._last_detail: RegimeDetail | None = None

    # ── BaseStrategy 인터페이스 ──────────────────────────────

    def generate_signal(self, df: pd.DataFrame) -> Signal:
        """단순 Signal 반환."""
        ctx = self.generate_signal_with_context(df)
        return ctx.signal

    def generate_signal_with_context(self, df: pd.DataFrame) -> SignalContext:
        """시장 상태를 감지하고 해당 전략의 신호를 반환한다."""
        detail = self.detector.detect_with_detail(df)
        self._current_regime = detail.regime
        self._last_detail = detail

        regime_info = (
            f"[Regime] {detail.regime.value} "
            f"(ADX={detail.adx_value:.1f}, conf={detail.confidence})"
        )
        logger.info(regime_info)

        if detail.regime == MarketRegime.RANGE_BOUND:
            ctx = self.grid_strategy.generate_signal_with_context(df)
            ctx.reason = f"[횡보장→그리드] {ctx.reason}"
            self._add_regime_indicators(ctx, detail)
            return ctx

        if detail.regime == MarketRegime.TRENDING_UP:
            ctx = self.rsi_strategy.generate_signal_with_context(df)
            ctx.reason = f"[상승추세→RSI] {ctx.reason}"
            self._add_regime_indicators(ctx, detail)
            return ctx

        # TRENDING_DOWN → HOLD (매수 차단) + 기존 포지션은 SELL 신호만 전달
        ctx = self.rsi_strategy.generate_signal_with_context(df)
        if ctx.signal == "BUY":
            ctx = SignalContext(
                signal="HOLD",
                reason=(
                    f"[하락추세→매수차단] ADX={detail.adx_value:.1f}, "
                    f"-DI={detail.minus_di:.1f} > +DI={detail.plus_di:.1f}"
                ),
                rsi_value=ctx.rsi_value,
                volume_ratio=ctx.volume_ratio,
                trend="DOWNTREND",
                volatility=ctx.volatility,
                indicators=ctx.indicators,
            )
        else:
            ctx.reason = f"[하락추세→RSI청산] {ctx.reason}"

        self._add_regime_indicators(ctx, detail)
        return ctx

    def precompute_signals(self, df: pd.DataFrame) -> pd.Series:
        """
        백테스트용 벡터화 신호 계산.

        각 캔들마다 시장 상태를 판별하고 해당 전략의 신호를 사용한다.
        """
        signals = pd.Series("HOLD", index=df.index, dtype=str)
        rsi_signals = self.rsi_strategy.precompute_signals(df)
        grid_signals = self.grid_strategy.precompute_signals(df)

        # ADX 계산
        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)

        import ta

        adx_ind = ta.trend.ADXIndicator(
            high=high, low=low, close=close,
            window=self.detector.adx_period,
        )
        adx_series = adx_ind.adx()
        plus_di_series = adx_ind.adx_pos()
        minus_di_series = adx_ind.adx_neg()

        for i in range(len(df)):
            adx_val = adx_series.iloc[i]
            if pd.isna(adx_val):
                signals.iloc[i] = "HOLD"
                continue

            plus_di = plus_di_series.iloc[i]
            minus_di = minus_di_series.iloc[i]

            if adx_val >= self.detector.adx_trend_threshold:
                if plus_di > minus_di:
                    # TRENDING_UP → RSI
                    signals.iloc[i] = rsi_signals.iloc[i]
                else:
                    # TRENDING_DOWN → BUY 차단, SELL만 통과
                    if rsi_signals.iloc[i] == "SELL":
                        signals.iloc[i] = "SELL"
                    else:
                        signals.iloc[i] = "HOLD"
            elif adx_val < self.detector.adx_range_threshold:
                # RANGE_BOUND → Grid
                signals.iloc[i] = grid_signals.iloc[i]
            else:
                # 전환 구간 → HOLD (안전)
                signals.iloc[i] = "HOLD"

        return signals

    # ── RSI 호환 속성 위임 (TradingBot._check_exit 호환) ────

    @property
    def overbought(self) -> float:
        """RSI 과매수 기준 — TradingBot._check_exit에서 사용."""
        return self.rsi_strategy.overbought

    @property
    def period(self) -> int:
        """RSI 기간 — AdaptiveEngine._apply_param_tune 호환."""
        return self.rsi_strategy.period

    @period.setter
    def period(self, value: int) -> None:
        self.rsi_strategy.period = value

    @property
    def oversold(self) -> float:
        """RSI 과매도 기준 — AdaptiveEngine._apply_param_tune 호환."""
        return self.rsi_strategy.oversold

    @oversold.setter
    def oversold(self, value: float) -> None:
        self.rsi_strategy.oversold = value

    @overbought.setter
    def overbought(self, value: float) -> None:
        self.rsi_strategy.overbought = value

    # ── 상태 조회 ───────────────────────────────────────────

    @property
    def current_regime(self) -> MarketRegime:
        """현재 감지된 시장 상태."""
        return self._current_regime

    @property
    def last_regime_detail(self) -> RegimeDetail | None:
        """마지막 감지 상세."""
        return self._last_detail

    # ── 내부 헬퍼 ───────────────────────────────────────────

    @staticmethod
    def _add_regime_indicators(ctx: SignalContext, detail: RegimeDetail) -> None:
        """SignalContext의 indicators에 시장 상태 정보를 추가한다."""
        if ctx.indicators is None:
            ctx.indicators = {}
        ctx.indicators["regime"] = detail.regime.value
        ctx.indicators["adx"] = detail.adx_value
        ctx.indicators["plus_di"] = detail.plus_di
        ctx.indicators["minus_di"] = detail.minus_di
        ctx.indicators["regime_confidence"] = detail.confidence

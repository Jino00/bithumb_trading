"""레짐별 최적 전략을 자동 전환하는 LONG-only 메타 전략.

S2 거래량돌파(BULL) + S3 하이킨아시(SIDEWAYS) + S5 과매도반등(BEAR) + S6 SMMA리테스트.
backtest_scalp.py 학습 루프를 통해 검증 완료.
"""
import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pandas as pd
import ta

import config
from strategy.base_strategy import BaseStrategy, Signal
from strategy.market_regime import EnsembleRegimeDetector, MarketRegime

logger = logging.getLogger(__name__)


@dataclass
class ScalpSignalContext:
    """스캘프 전략 신호와 컨텍스트."""
    signal: Signal
    reason: str
    sub_strategy: str  # "S2_Volume", "S3_HA", "HOLD_BEAR"
    regime: str        # "BULL", "SIDEWAYS", "BEAR"
    sl_pct: float = 0.0   # 진입가 대비 손절 %
    tp_pct: float = 0.0   # 진입가 대비 익절 %
    ha_weak_min_pct: float = 0.0  # HA_WEAK 청산 최소 이익 % (S3 전용)


class ScalpStrategy(BaseStrategy):
    """6전략 레짐 전환 메타 전략 (LONG-only).

    레짐별 최적 매칭:
      BULL     → S2 거래량 폭발 돌파 또는 S6 SMMA 리테스트
      SIDEWAYS → S3 하이킨아시 패턴 (핵심: +9.64%, PF 1.78) 또는 S6 SMMA 리테스트
      BEAR     → S5 과매도 반등 (역추세 평균회귀)

    S3 핵심 파라미터 (Round 8 비용포함 최적화):
      doji=0.05, flat=0.002, rr=3.0, min_b=3, ha_weak=1.0, min_atr=0.3
    """

    def __init__(self, regime_detector: Optional[EnsembleRegimeDetector] = None):
        self.regime_detector = regime_detector or EnsembleRegimeDetector()
        # S3 파라미터 (Round 8 비용포함 최적화 완료)
        self.s3_doji_ratio = config.SCALP_HA_DOJI_BODY_RATIO
        self.s3_flat_tol = config.SCALP_HA_FLAT_WICK_TOL
        self.s3_rr = config.SCALP_HA_RR_RATIO
        self.s3_min_bearish = config.SCALP_HA_MIN_BEARISH_CANDLES
        self.s3_ha_weak_min_pct = config.SCALP_HA_WEAK_MIN_PCT
        self.s3_min_atr_pct = config.SCALP_HA_MIN_ATR_PCT
        # S2 파라미터
        self.s2_explosion = config.SCALP_VOL_EXPLOSION_MULT
        self.s2_dry_ratio = config.SCALP_VOL_DRY_RATIO
        self.s2_rr = config.SCALP_VOL_RR_RATIO
        self.s2_box_lookback = config.SCALP_VOL_BOX_LOOKBACK
        # S5 파라미터 (BEAR 과매도 반등)
        self.s5_rsi_threshold = config.SCALP_BEAR_RSI_THRESHOLD
        self.s5_rsi_period = config.SCALP_BEAR_RSI_PERIOD
        self.s5_bb_period = config.SCALP_BEAR_BB_PERIOD
        self.s5_bb_std = config.SCALP_BEAR_BB_STD
        self.s5_vol_spike = config.SCALP_BEAR_VOL_SPIKE
        self.s5_sl_pct = config.SCALP_BEAR_SL_PCT
        self.s5_tp_pct = config.SCALP_BEAR_TP_PCT
        # S6 파라미터 (SMMA 리테스트 + 프렉탈)
        self.s6_smma_short = config.SCALP_SMMA_SHORT
        self.s6_smma_mid = config.SCALP_SMMA_MID
        self.s6_smma_long = config.SCALP_SMMA_LONG
        self.s6_rr = config.SCALP_SMMA_RR_RATIO
        self.s6_tangle_tol = config.SCALP_SMMA_TANGLE_TOL
        self.s6_retest_tol = config.SCALP_SMMA_RETEST_TOL
        # 공통
        self.cooldown = config.SCALP_COOLDOWN_BARS
        self.use_regime = config.SCALP_USE_REGIME_FILTER
        # 상태
        self._last_signal_bar = -999
        self._box_active = False
        self._box_high = 0.0
        self._box_low = 0.0
        self._explosion_idx = 0

    def generate_signal(self, df: pd.DataFrame) -> Signal:
        """BaseStrategy 인터페이스 — 단순 Signal 반환."""
        ctx = self.generate_signal_with_context(df)
        return ctx.signal

    def generate_signal_with_context(self, df: pd.DataFrame) -> ScalpSignalContext:
        """레짐 감지 → 최적 전략 자동 선택 → 신호 생성."""
        if df is None or len(df) < 60:
            return ScalpSignalContext("HOLD", "데이터 부족", "NONE", "UNKNOWN")

        # 레짐 감지
        regime_detail = self.regime_detector.detect(df)
        regime = regime_detail.regime

        if regime == MarketRegime.TRENDING_DOWN:
            return self._signal_s5_bear_bounce(df)

        regime_str = "BULL" if regime == MarketRegime.TRENDING_UP else "SIDEWAYS"

        # 레짐별 전략 선택 + S6 보조 신호
        if regime == MarketRegime.TRENDING_UP:
            ctx = self._signal_s2_volume(df, regime_str)
        else:
            ctx = self._signal_s3_heikin_ashi(df, regime_str)

        # 주 전략이 HOLD이면 S6 SMMA 리테스트 시도
        if ctx.signal == "HOLD":
            s6_ctx = self._signal_s6_smma_retest(df, regime_str)
            if s6_ctx.signal == "BUY":
                return s6_ctx

        return ctx

    def _signal_s3_heikin_ashi(self, df: pd.DataFrame, regime: str) -> ScalpSignalContext:
        """S3: 하이킨아시 도지 → 평평한 양봉 반전 패턴."""
        c = df["close"].astype(float)
        o = df["open"].astype(float)
        h = df["high"].astype(float)
        lo = df["low"].astype(float)
        n = len(df)

        # 저변동성 필터: ATR/가격 비율이 너무 낮으면 비용 커버 불가
        if self.s3_min_atr_pct > 0:
            atr = ta.volatility.AverageTrueRange(h, lo, c, window=14).average_true_range()
            i_last = n - 1
            if not pd.isna(atr.iloc[i_last]) and c.iloc[i_last] > 0:
                atr_pct = atr.iloc[i_last] / c.iloc[i_last] * 100
                if atr_pct < self.s3_min_atr_pct:
                    return ScalpSignalContext(
                        "HOLD", f"저변동성 ({atr_pct:.2f}% < {self.s3_min_atr_pct}%)",
                        "S3_HA", regime
                    )

        # 하이킨아시 계산
        ha_close = (o + h + lo + c) / 4
        ha_open = pd.Series(np.zeros(n), index=df.index)
        ha_open.iloc[0] = (o.iloc[0] + c.iloc[0]) / 2
        for j in range(1, n):
            ha_open.iloc[j] = (ha_open.iloc[j - 1] + ha_close.iloc[j - 1]) / 2

        i = n - 1  # 최신 봉

        # 최신 봉이 평평한 양봉인지 확인
        if ha_close.iloc[i] <= ha_open.iloc[i]:
            return ScalpSignalContext("HOLD", "HA 양봉 아님", "S3_HA", regime)

        ha_l_val = min(lo.iloc[i], min(ha_open.iloc[i], ha_close.iloc[i]))
        if ha_open.iloc[i] > 0 and abs(ha_l_val - ha_open.iloc[i]) / ha_open.iloc[i] > self.s3_flat_tol:
            return ScalpSignalContext("HOLD", "HA 평평한 바닥 아님", "S3_HA", regime)

        # 이전 봉(i-1)이 도지인지 확인
        prev = i - 1
        if prev < self.s3_min_bearish + 1:
            return ScalpSignalContext("HOLD", "데이터 부족", "S3_HA", regime)

        ha_body = abs(ha_close.iloc[prev] - ha_open.iloc[prev])
        ha_range = max(h.iloc[prev], max(ha_open.iloc[prev], ha_close.iloc[prev])) - \
                   min(lo.iloc[prev], min(ha_open.iloc[prev], ha_close.iloc[prev]))
        if ha_range == 0 or ha_body / ha_range > self.s3_doji_ratio:
            return ScalpSignalContext("HOLD", "도지 패턴 아님", "S3_HA", regime)

        # 도지 전 N봉이 음봉인지
        bearish_count = sum(
            1 for j in range(prev - self.s3_min_bearish, prev)
            if ha_close.iloc[j] < ha_open.iloc[j]
        )
        if bearish_count < self.s3_min_bearish:
            return ScalpSignalContext("HOLD", "선행 하락 부족", "S3_HA", regime)

        # 매수 신호
        ep = float(c.iloc[i])
        doji_low = float(min(lo.iloc[prev], min(ha_open.iloc[prev], ha_close.iloc[prev])))
        risk = ep - doji_low
        if risk <= 0:
            return ScalpSignalContext("HOLD", "리스크 비양수", "S3_HA", regime)

        sl_pct = risk / ep * 100
        tp_pct = sl_pct * self.s3_rr
        reason = (f"S3 하이킨아시 반전: {self.s3_min_bearish}봉 하락 후 도지→양봉, "
                  f"SL {sl_pct:.1f}%, TP {tp_pct:.1f}%")

        return ScalpSignalContext(
            "BUY", reason, "S3_HA", regime, sl_pct, tp_pct,
            ha_weak_min_pct=self.s3_ha_weak_min_pct
        )

    def _signal_s2_volume(self, df: pd.DataFrame, regime: str) -> ScalpSignalContext:
        """S2: 거래량 폭발 → 박스권 → 메마름 → 돌파."""
        c = df["close"].astype(float)
        o = df["open"].astype(float)
        h = df["high"].astype(float)
        lo = df["low"].astype(float)
        v = df["volume"].astype(float)
        n = len(df)
        i = n - 1

        vol_ma = v.rolling(config.SCALP_VOL_MA_PERIOD).mean()
        if pd.isna(vol_ma.iloc[i]) or vol_ma.iloc[i] == 0:
            return ScalpSignalContext("HOLD", "거래량 MA 부족", "S2_Volume", regime)

        # 박스 활성화 확인
        if not self._box_active:
            if v.iloc[i] > vol_ma.iloc[i] * self.s2_explosion and c.iloc[i] > o.iloc[i]:
                self._box_active = True
                self._explosion_idx = i
                self._box_high = float(h.iloc[i])
                self._box_low = float(lo.iloc[i])
                return ScalpSignalContext(
                    "HOLD", f"거래량 폭발 감지 ({v.iloc[i]/vol_ma.iloc[i]:.1f}x), 박스 형성 대기",
                    "S2_Volume", regime
                )
            return ScalpSignalContext("HOLD", "거래량 폭발 없음", "S2_Volume", regime)

        elapsed = i - self._explosion_idx
        if elapsed > self.s2_box_lookback:
            self._box_active = False
            return ScalpSignalContext("HOLD", "박스 기간 초과", "S2_Volume", regime)

        # 돌파 체크 (박스 업데이트 전에!)
        if elapsed >= 3:
            dry_start = max(self._explosion_idx + 1, i - 4)
            dry_count = sum(
                1 for j in range(dry_start, i)
                if not pd.isna(vol_ma.iloc[j]) and vol_ma.iloc[j] > 0
                and v.iloc[j] < vol_ma.iloc[j] * self.s2_dry_ratio
            )
            dry_total = i - dry_start
            if dry_total > 0 and dry_count >= dry_total * 0.5:
                if c.iloc[i] > self._box_high and c.iloc[i] > o.iloc[i]:
                    ep = float(c.iloc[i])
                    risk = ep - self._box_low
                    if risk > 0 and risk / ep < 0.10:
                        sl_pct = risk / ep * 100
                        tp_pct = sl_pct * self.s2_rr
                        self._box_active = False
                        reason = (f"S2 거래량 돌파: 박스 상단({self._box_high:.0f}) 돌파, "
                                  f"SL {sl_pct:.1f}%, TP {tp_pct:.1f}%")
                        return ScalpSignalContext("BUY", reason, "S2_Volume", regime, sl_pct, tp_pct)

        # 돌파 없으면 박스 업데이트
        self._box_high = max(self._box_high, float(h.iloc[i]))
        self._box_low = min(self._box_low, float(lo.iloc[i]))
        return ScalpSignalContext(
            "HOLD", f"박스 형성 중 (H:{self._box_high:.0f}, L:{self._box_low:.0f})",
            "S2_Volume", regime
        )

    def _signal_s5_bear_bounce(self, df: pd.DataFrame) -> ScalpSignalContext:
        """S5: BEAR 레짐 과매도 반등 (역추세 평균회귀)."""
        c = df["close"].astype(float)
        o = df["open"].astype(float)
        v = df["volume"].astype(float)
        n = len(df)
        i = n - 1

        # RSI 계산
        rsi = ta.momentum.RSIIndicator(c, window=self.s5_rsi_period).rsi()
        if pd.isna(rsi.iloc[i]) or pd.isna(rsi.iloc[i - 1]):
            return ScalpSignalContext("HOLD", "RSI 데이터 부족", "S5_Bear", "BEAR")

        # 조건 1: RSI 과매도
        if rsi.iloc[i] >= self.s5_rsi_threshold:
            return ScalpSignalContext(
                "HOLD", f"RSI {rsi.iloc[i]:.1f} ≥ {self.s5_rsi_threshold}", "S5_Bear", "BEAR"
            )

        # 조건 2: 볼린저밴드 하단 이탈
        bb = ta.volatility.BollingerBands(
            c, window=self.s5_bb_period, window_dev=self.s5_bb_std
        )
        bb_lower = bb.bollinger_lband()
        if pd.isna(bb_lower.iloc[i]) or c.iloc[i] >= bb_lower.iloc[i]:
            return ScalpSignalContext(
                "HOLD", "BB 하단밴드 미이탈", "S5_Bear", "BEAR"
            )

        # 조건 3: 거래량 스파이크 (투매 클라이맥스)
        vol_ma = v.rolling(config.SCALP_VOL_MA_PERIOD).mean()
        if pd.isna(vol_ma.iloc[i]) or vol_ma.iloc[i] == 0:
            return ScalpSignalContext("HOLD", "거래량 MA 부족", "S5_Bear", "BEAR")
        if v.iloc[i] < vol_ma.iloc[i] * self.s5_vol_spike:
            return ScalpSignalContext(
                "HOLD", f"거래량 스파이크 부족 ({v.iloc[i]/vol_ma.iloc[i]:.1f}x)",
                "S5_Bear", "BEAR"
            )

        # 조건 4: 양봉 (반등 시작 확인)
        if c.iloc[i] <= o.iloc[i]:
            return ScalpSignalContext("HOLD", "양봉 아님", "S5_Bear", "BEAR")

        # 조건 5: RSI 상승 전환
        if rsi.iloc[i] <= rsi.iloc[i - 1]:
            return ScalpSignalContext("HOLD", "RSI 상승 전환 아님", "S5_Bear", "BEAR")

        # 모든 조건 충족 → 매수 신호
        reason = (
            f"S5 과매도 반등: RSI={rsi.iloc[i]:.1f}, "
            f"BB하단 이탈, 거래량 {v.iloc[i]/vol_ma.iloc[i]:.1f}x, "
            f"SL {self.s5_sl_pct:.1f}%, TP {self.s5_tp_pct:.1f}%"
        )
        return ScalpSignalContext(
            "BUY", reason, "S5_Bear", "BEAR",
            self.s5_sl_pct, self.s5_tp_pct
        )

    def _compute_smma(self, series: pd.Series, period: int) -> pd.Series:
        """SMMA(평활 이동 평균선) 계산."""
        vals = series.values.astype(float)
        n = len(vals)
        smma = np.zeros(n)
        if n < period:
            return pd.Series(smma, index=series.index)
        smma[period - 1] = np.mean(vals[:period])
        for j in range(period, n):
            smma[j] = (smma[j - 1] * (period - 1) + vals[j]) / period
        smma[:period - 1] = smma[period - 1]
        return pd.Series(smma, index=series.index)

    def _signal_s6_smma_retest(self, df: pd.DataFrame, regime: str) -> ScalpSignalContext:
        """S6: SMMA 리테스트 + 프렉탈 (아티브리아 이평선 매매법)."""
        c = df["close"].astype(float)
        o = df["open"].astype(float)
        h = df["high"].astype(float)
        lo = df["low"].astype(float)
        n = len(df)

        if n < self.s6_smma_long + 10:
            return ScalpSignalContext("HOLD", "데이터 부족", "S6_SMMA", regime)

        # SMMA 계산
        smma21 = self._compute_smma(c, self.s6_smma_short)
        smma50 = self._compute_smma(c, self.s6_smma_mid)
        smma200 = self._compute_smma(c, self.s6_smma_long)

        i = n - 1

        # 조건 1: SMMA 정배열 (21 > 50 > 200)
        if not (smma21.iloc[i] > smma50.iloc[i] > smma200.iloc[i]):
            return ScalpSignalContext("HOLD", "SMMA 정배열 아님", "S6_SMMA", regime)

        # 조건 2: MA 꼬임 방지
        spread_21_50 = abs(smma21.iloc[i] - smma50.iloc[i]) / smma50.iloc[i]
        spread_50_200 = abs(smma50.iloc[i] - smma200.iloc[i]) / smma200.iloc[i]
        if spread_21_50 < self.s6_tangle_tol or spread_50_200 < self.s6_tangle_tol:
            return ScalpSignalContext("HOLD", "SMMA 간격 부족 (꼬임)", "S6_SMMA", regime)

        # 조건 3: 리테스트 — 저가가 21선/50선 근처까지 눌림
        touch_21 = lo.iloc[i] <= smma21.iloc[i] * (1 + self.s6_retest_tol)
        touch_50 = lo.iloc[i] <= smma50.iloc[i] * (1 + self.s6_retest_tol)
        if not (touch_21 or touch_50):
            return ScalpSignalContext("HOLD", "SMMA 리테스트 없음", "S6_SMMA", regime)

        # 조건 4: Williams Fractal (불리시) — 최근 5봉 이내 확인
        has_fractal = False
        fractal_low = float(lo.iloc[i])
        for fb in range(max(2, i - 4), i + 1):
            if fb + 2 < n and fb >= 2:
                fl = float(lo.iloc[fb])
                if (fl < lo.iloc[fb - 1] and fl < lo.iloc[fb - 2]
                        and fl < lo.iloc[fb + 1] and fl < lo.iloc[fb + 2]):
                    has_fractal = True
                    fractal_low = fl
                    break
        if not has_fractal:
            return ScalpSignalContext("HOLD", "프렉탈 신호 없음", "S6_SMMA", regime)

        # 조건 5: 양봉 확인 (반등 시작)
        if c.iloc[i] <= o.iloc[i]:
            return ScalpSignalContext("HOLD", "양봉 아님", "S6_SMMA", regime)

        # 매수 신호
        ep = float(c.iloc[i])
        risk = ep - fractal_low
        if risk <= 0 or risk / ep > 0.05:
            return ScalpSignalContext("HOLD", "리스크 비정상", "S6_SMMA", regime)

        sl_pct = risk / ep * 100
        tp_pct = sl_pct * self.s6_rr
        touch_level = "21선" if touch_21 else "50선"
        reason = (
            f"S6 SMMA 리테스트: {touch_level} 눌림 + 프렉탈 확인, "
            f"SL {sl_pct:.1f}%, TP {tp_pct:.1f}%"
        )
        return ScalpSignalContext("BUY", reason, "S6_SMMA", regime, sl_pct, tp_pct)

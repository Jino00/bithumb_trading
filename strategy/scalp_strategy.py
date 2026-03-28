"""레짐별 7전략 폭포식 선택 LONG-only 메타 전략.

S1 RSI(BEAR) + S2 Volume(BULL) + S3 HA(SIDEWAYS) + S4 VWAP + S5 Bear + S6 SMMA + S7 SMC.
2026-03-15: 전 전략 활성화, 폭포식 탐색으로 거래 빈도 극대화.
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

    def generate_signal_with_context(
        self, df: pd.DataFrame, strategy_scores: dict = None
    ) -> ScalpSignalContext:
        """레짐 감지 → 전략 폭포식 탐색 → 첫 BUY 신호 반환.

        strategy_scores가 주어지면 인사이트 학습 승률 기반으로
        워터폴 우선순위를 동적으로 재정렬한다.
        """
        if df is None or len(df) < 60:
            return ScalpSignalContext("HOLD", "데이터 부족", "NONE", "UNKNOWN")

        # ── 도지 캔들 필터 (NotebookLM 인사이트) ──
        last = df.iloc[-1]
        body = abs(last["close"] - last["open"])
        wick = last["high"] - last["low"]
        if wick > 0 and body / wick < config.SCALP_DOJI_BODY_RATIO:
            return ScalpSignalContext(
                "HOLD", "도지 캔들 — 방향성 불확실", "NONE", "UNKNOWN"
            )

        regime = self.regime_detector.detect(df)

        if regime == MarketRegime.TRENDING_DOWN:
            return self._waterfall_bear(df, strategy_scores)

        regime_str = "BULL" if regime == MarketRegime.TRENDING_UP else "SIDEWAYS"

        # ── 200 EMA 추세 필터 (완화: SIDEWAYS에서는 적용 안 함) ──
        # 이전: EMA200 아래면 무조건 차단 → 거래 기회 과도 감소
        # 변경: BULL에서만 적용 (SIDEWAYS는 레인지 바운스 가능)
        if regime == MarketRegime.TRENDING_UP:
            ema200 = df["close"].ewm(
                span=config.SCALP_EMA_TREND_FILTER, adjust=False
            ).mean()
            if df["close"].iloc[-1] < ema200.iloc[-1]:
                return ScalpSignalContext(
                    "HOLD", "200 EMA 아래 — 추세 필터 차단",
                    "NONE", regime_str,
                )

        if regime == MarketRegime.TRENDING_UP:
            candidates = self._bull_candidates(df, regime_str)
        else:
            candidates = self._sideways_candidates(df, regime_str)

        return self._run_waterfall(candidates, strategy_scores, regime_str)

    def _bull_candidates(self, df, regime_str) -> list:
        """BULL 레짐 전략 후보 리스트 (S6 제거: 18% 승률)."""
        return [
            ("S2_Volume", lambda: self._signal_s2_volume(df, regime_str)),
            ("S3_HA", lambda: self._signal_s3_heikin_ashi(df, regime_str)),
            ("S1_RSI", lambda: self._signal_s1_rsi_pullback(df, regime_str)),
        ]

    def _sideways_candidates(self, df, regime_str) -> list:
        """SIDEWAYS 레짐 전략 후보 리스트 (S6 제외: 승률 14%)."""
        return [
            ("S3_HA", lambda: self._signal_s3_heikin_ashi(df, regime_str)),
            ("S2_Volume", lambda: self._signal_s2_volume(df, regime_str)),
            ("S1_RSI", lambda: self._signal_s1_rsi_pullback(df, regime_str)),
        ]

    def _waterfall_bear(self, df, strategy_scores) -> ScalpSignalContext:
        """BEAR 레짐 워터폴: S5 → S1."""
        candidates = [
            ("S5_Bear", lambda: self._signal_s5_bear_bounce(df)),
            ("S1_RSI", lambda: self._signal_s1_rsi_pullback(df, "BEAR")),
        ]
        return self._run_waterfall(candidates, strategy_scores, "BEAR")

    def _run_waterfall(self, candidates, strategy_scores, regime_str):
        """인사이트 점수로 재정렬 후 첫 BUY 신호를 반환."""
        if strategy_scores:
            candidates.sort(
                key=lambda x: strategy_scores.get(x[0], 50),
                reverse=True,
            )
        for _, signal_fn in candidates:
            ctx = signal_fn()
            if ctx.signal == "BUY":
                return ctx
        return ScalpSignalContext(
            "HOLD", f"{regime_str} 전략 신호 없음", "NONE", regime_str
        )

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

    def _signal_s7_smc(self, df: pd.DataFrame, regime: str) -> ScalpSignalContext:
        """S7: Smart Money Concepts — Order Block + FVG + Liquidity Sweep 실시간 신호."""
        from strategy.smc_strategy import (
            detect_swing_points, detect_order_blocks,
            detect_fvg, detect_liquidity_sweep, detect_bos,
        )

        c = df["close"].astype(float)
        o = df["open"].astype(float)
        h = df["high"].astype(float)
        lo = df["low"].astype(float)
        n = len(df)

        if n < 60:
            return ScalpSignalContext("HOLD", "데이터 부족", "S7_SMC", regime)

        # ATR 기반 변동성 필터 (df에 없으면 자체 계산)
        atr_col = df.get("atr")
        if atr_col is None or len(atr_col) == 0:
            atr_col = ta.volatility.AverageTrueRange(
                h, lo, c, window=14
            ).average_true_range()

        i = n - 1
        atr_val = float(atr_col.iloc[i])
        price = float(c.iloc[i])
        if price <= 0 or atr_val <= 0:
            return ScalpSignalContext("HOLD", "가격/ATR 이상", "S7_SMC", regime)

        atr_pct = atr_val / price * 100
        if atr_pct < config.SMC_MIN_ATR_PCT:
            return ScalpSignalContext("HOLD", f"변동성 부족 ({atr_pct:.2f}%)", "S7_SMC", regime)

        # 양봉 확인
        if float(c.iloc[i]) <= float(o.iloc[i]):
            return ScalpSignalContext("HOLD", "양봉 아님", "S7_SMC", regime)

        # SMC 구조 감지
        swing_highs, swing_lows = detect_swing_points(
            h.values, lo.values, lookback=5
        )
        order_blocks = detect_order_blocks(
            df, lookback=config.SMC_OB_LOOKBACK,
            min_move_pct=config.SMC_OB_MIN_MOVE_PCT,
        )
        fvgs = detect_fvg(df, min_gap_pct=config.SMC_FVG_MIN_GAP_PCT)
        sweep_signal = detect_liquidity_sweep(
            df, swing_lows, sweep_pct=config.SMC_LIQUIDITY_SWEEP_PCT,
        )
        bos_signal = detect_bos(df, swing_highs)

        # BOS 확인 (최근 10봉 이내)
        recent_bos = any(bos_signal[max(0, i - 10):i + 1])
        if not recent_bos:
            return ScalpSignalContext("HOLD", "BOS 미확인", "S7_SMC", regime)

        # 진입 조건 체크 (3가지 중 하나)
        entry_reason = ""

        # 1. Order Block 리테스트
        for ob in order_blocks:
            if not ob.is_valid or ob.idx >= i - 3:
                continue
            if float(lo.iloc[i]) <= ob.ob_high and float(c.iloc[i]) >= ob.ob_low:
                entry_reason = "OB 리테스트"
                break

        # 2. FVG 메꿈
        if not entry_reason:
            for fvg in fvgs:
                if fvg.filled or fvg.idx >= i - 3:
                    continue
                if float(lo.iloc[i]) <= fvg.gap_high and float(c.iloc[i]) >= fvg.gap_low:
                    entry_reason = "FVG 메꿈"
                    break

        # 3. Liquidity Sweep
        if not entry_reason and sweep_signal[i]:
            entry_reason = "유동성 스윕"

        if not entry_reason:
            return ScalpSignalContext("HOLD", "SMC 진입 조건 미충족", "S7_SMC", regime)

        # SL/TP 계산 (ATR 기반)
        sl_pct = atr_val * config.SMC_ATR_SL_MULT / price * 100
        tp_pct = sl_pct * config.SMC_RR_RATIO

        reason = (
            f"S7 SMC: {entry_reason} + BOS 확인, "
            f"SL {sl_pct:.1f}%, TP {tp_pct:.1f}%"
        )
        return ScalpSignalContext("BUY", reason, "S7_SMC", regime, sl_pct, tp_pct)

    def _signal_s1_rsi_pullback(self, df: pd.DataFrame, regime: str) -> ScalpSignalContext:
        """S1: RSI 과매도 풀백 — BEAR 보조전략."""
        c = df["close"].astype(float)
        o = df["open"].astype(float)
        n = len(df)

        if n < 60:
            return ScalpSignalContext("HOLD", "데이터 부족", "S1_RSI", regime)

        # RSI 계산 — S1은 SCALP_RSI_PERIOD 사용 (S5의 BEAR_RSI_PERIOD와 다름)
        rsi = ta.momentum.RSIIndicator(c, window=config.SCALP_RSI_PERIOD).rsi()
        if rsi is None or len(rsi) < 2:
            return ScalpSignalContext("HOLD", "RSI 계산 실패", "S1_RSI", regime)

        i = n - 1
        current_rsi = float(rsi.iloc[i])

        # EMA 추세 확인
        ema_short = c.ewm(span=config.SCALP_EMA_SHORT, adjust=False).mean()
        ema_long = c.ewm(span=config.SCALP_EMA_LONG, adjust=False).mean()

        # RSI 풀백 구간 (과매도 후 반등 시작)
        in_pullback = (config.SCALP_RSI_PULLBACK_LOW <= current_rsi
                       <= config.SCALP_RSI_PULLBACK_HIGH)

        # 과매도 바운스: RSI가 과매도 후 반등
        was_oversold = any(
            float(rsi.iloc[j]) < config.SCALP_RSI_OVERSOLD
            for j in range(max(0, i - 5), i)
        )

        # RSI 하락 추세: 최근 RSI가 내려오고 있으면 풀백으로 간주
        rsi_declining = float(rsi.iloc[i]) < float(rsi.iloc[max(0, i-3)])

        # BULL/SIDEWAYS: 풀백 구간이면 진입 허용 (과매도 이력 또는 RSI 하락 추세)
        if regime in ("BULL", "TRENDING_UP", "SIDEWAYS"):
            if not in_pullback:
                return ScalpSignalContext("HOLD", f"RSI 풀백 밖 ({current_rsi:.0f})", "S1_RSI", regime)
            if not (was_oversold or rsi_declining):
                return ScalpSignalContext("HOLD", f"RSI 하락추세 아님 ({current_rsi:.0f})", "S1_RSI", regime)
        else:
            # BEAR: 과매도 이력 필수
            if not (in_pullback and was_oversold):
                return ScalpSignalContext("HOLD", f"RSI 조건 미충족 ({current_rsi:.0f})", "S1_RSI", regime)

        # 양봉 확인
        if float(c.iloc[i]) <= float(o.iloc[i]):
            return ScalpSignalContext("HOLD", "양봉 아님", "S1_RSI", regime)

        # ATR 기반 SL/TP (df에 없으면 자체 계산)
        atr_col = df.get("atr")
        if atr_col is None or len(atr_col) == 0:
            h = df["high"].astype(float)
            lo_s = df["low"].astype(float)
            atr_col = ta.volatility.AverageTrueRange(
                h, lo_s, c, window=14
            ).average_true_range()

        atr_val = float(atr_col.iloc[i])
        price = float(c.iloc[i])
        if price <= 0 or atr_val <= 0:
            return ScalpSignalContext("HOLD", "가격 이상", "S1_RSI", regime)

        sl_pct = atr_val * config.SCALP_ATR_SL_MULT / price * 100
        tp_pct = atr_val * config.SCALP_ATR_TP_MULT / price * 100

        reason = (
            f"S1 RSI 풀백: RSI {current_rsi:.0f} (과매도 후 반등), "
            f"SL {sl_pct:.1f}%, TP {tp_pct:.1f}%"
        )
        return ScalpSignalContext("BUY", reason, "S1_RSI", regime, sl_pct, tp_pct)

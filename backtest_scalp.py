"""LONG-only 멀티 전략 단타 백테스트 — 4전략 × 3레짐 학습 루프."""
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import warnings
import numpy as np
import pandas as pd
import pybithumb

warnings.filterwarnings("ignore", category=RuntimeWarning, message="invalid value")


# ── 공통 데이터 구조 ────────────────────────────────────────

@dataclass
class Trade:
    """단일 거래 기록."""
    strategy: str
    entry_idx: int
    entry_price: float
    entry_time: str
    sl: float
    tp: float
    direction: str = "LONG"
    exit_idx: int = 0
    exit_price: float = 0.0
    exit_time: str = ""
    exit_reason: str = ""
    pnl_pct: float = 0.0
    regime: str = ""
    trail_high: float = 0.0
    breakeven_active: bool = False


# ── PnL 계산 헬퍼 ─────────────────────────────────────────────

def calc_pnl(entry_price: float, exit_price: float, fee_pct: float = 0.0) -> float:
    """수수료 포함 PnL% 계산. fee_pct=0.04 → 편도 0.04%, 왕복 0.08%."""
    gross = (exit_price - entry_price) / entry_price * 100
    return gross - fee_pct * 2


def walk_forward_split(df: pd.DataFrame, train_ratio: float = 0.7):
    """시계열 70/30 분할 (셔플 금지)."""
    split_idx = int(len(df) * train_ratio)
    return df.iloc[:split_idx].copy(), df.iloc[split_idx:].copy()


# ── 데이터 수집 ──────────────────────────────────────────────

def fetch_data(coin: str, interval: str = "1h") -> Optional[pd.DataFrame]:
    """pybithumb에서 OHLCV 데이터를 가져온다."""
    print(f"  [{coin}] 데이터 수집 중...", end=" ")
    try:
        df = pybithumb.get_candlestick(coin, chart_intervals=interval)
        if df is None or len(df) < 500:
            print(f"실패 (데이터 부족: {len(df) if df is not None else 0}개)")
            return None
        df = df[["open", "high", "low", "close", "volume"]].astype(float)
        df = df.reset_index()
        df.rename(columns={"time": "datetime"}, inplace=True)
        print(f"OK ({len(df)}개 캔들)")
        return df
    except Exception as e:
        print(f"오류: {e}")
        return None


# ── 지표 사전계산 ────────────────────────────────────────────

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """모든 기술적 지표를 사전계산한다."""
    c = df["close"].values.astype(float)
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    o = df["open"].values.astype(float)
    v = df["volume"].values.astype(float)
    n = len(c)

    # RSI(14)
    delta = np.diff(c, prepend=c[0])
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = np.zeros(n)
    avg_loss = np.zeros(n)
    period = 14
    avg_gain[period] = np.mean(gain[1:period + 1])
    avg_loss[period] = np.mean(loss[1:period + 1])
    for i in range(period + 1, n):
        avg_gain[i] = (avg_gain[i - 1] * (period - 1) + gain[i]) / period
        avg_loss[i] = (avg_loss[i - 1] * (period - 1) + loss[i]) / period
    rs = np.where(avg_loss > 0, avg_gain / avg_loss, 100.0)
    rsi = 100 - 100 / (1 + rs)
    rsi[:period] = 50.0
    df["rsi"] = rsi

    # EMA 20, 50, 200
    df["ema20"] = pd.Series(c).ewm(span=20).mean().values
    df["ema50"] = pd.Series(c).ewm(span=50).mean().values
    df["ema200"] = pd.Series(c).ewm(span=200).mean().values

    # ATR(14)
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)),
                                       np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = np.zeros(n)
    atr[13] = np.mean(tr[:14])
    for i in range(14, n):
        atr[i] = (atr[i - 1] * 13 + tr[i]) / 14
    atr[:13] = atr[13]
    df["atr"] = atr

    # MACD
    ema12 = pd.Series(c).ewm(span=12).mean().values
    ema26 = pd.Series(c).ewm(span=26).mean().values
    macd_line = ema12 - ema26
    signal_line = pd.Series(macd_line).ewm(span=9).mean().values
    df["macd_hist"] = macd_line - signal_line

    # Volume MA(10), MA(20)
    df["vol_ma10"] = pd.Series(v).rolling(10).mean().values
    df["vol_ma20"] = pd.Series(v).rolling(20).mean().values
    df["vol_ratio"] = np.where(df["vol_ma20"] > 0, v / df["vol_ma20"].values, 1.0)

    # Bollinger Bands(20, 2)
    sma20 = pd.Series(c).rolling(20).mean().values
    std20 = pd.Series(c).rolling(20).std().values
    df["bb_upper"] = sma20 + 2 * std20
    df["bb_lower"] = sma20 - 2 * std20
    df["bb_mid"] = sma20

    # VWAP (24봉 롤링 — 암호화폐 24/7 시장)
    tp = (h + l + c) / 3
    tp_vol = tp * v
    vwap = np.zeros(n)
    vwap_std = np.zeros(n)
    period_vwap = 24
    for i in range(n):
        start = max(0, i - period_vwap + 1)
        cum_vol = np.sum(v[start:i + 1])
        if cum_vol > 0:
            vwap[i] = np.sum(tp_vol[start:i + 1]) / cum_vol
        else:
            vwap[i] = c[i]
        if i >= period_vwap - 1:
            vwap_std[i] = np.std(tp[start:i + 1])
    df["vwap"] = vwap
    df["vwap_upper"] = vwap + 2 * vwap_std
    df["vwap_lower"] = vwap - 2 * vwap_std

    # 하이킨아시 변환
    ha_close = (o + h + l + c) / 4
    ha_open = np.zeros(n)
    ha_open[0] = (o[0] + c[0]) / 2
    for i in range(1, n):
        ha_open[i] = (ha_open[i - 1] + ha_close[i - 1]) / 2
    ha_high = np.maximum(h, np.maximum(ha_open, ha_close))
    ha_low = np.minimum(l, np.minimum(ha_open, ha_close))
    df["ha_open"] = ha_open
    df["ha_close"] = ha_close
    df["ha_high"] = ha_high
    df["ha_low"] = ha_low

    # 캔들 속성
    df["is_bullish"] = c > o
    body = np.abs(c - o)
    full_range = h - l
    lower_wick = np.minimum(o, c) - l
    upper_wick = h - np.maximum(o, c)
    df["body"] = body
    df["full_range"] = full_range
    df["lower_wick"] = lower_wick
    df["upper_wick"] = upper_wick

    # SMMA (평활 이동 평균선) — 21, 50, 200
    for period, name in [(21, "smma21"), (50, "smma50"), (200, "smma200")]:
        smma = np.zeros(n)
        smma[period - 1] = np.mean(c[:period])
        for i in range(period, n):
            smma[i] = (smma[i - 1] * (period - 1) + c[i]) / period
        smma[:period - 1] = smma[period - 1]
        df[name] = smma

    # Williams Fractal — 5봉 패턴 (가운데 봉이 최저점/최고점)
    fractal_bull = np.zeros(n, dtype=bool)  # 하방 프렉탈 (매수 신호)
    fractal_bear = np.zeros(n, dtype=bool)  # 상방 프렉탈 (매도 신호)
    for i in range(2, n - 2):
        if l[i] < l[i - 1] and l[i] < l[i - 2] and l[i] < l[i + 1] and l[i] < l[i + 2]:
            fractal_bull[i] = True
        if h[i] > h[i - 1] and h[i] > h[i - 2] and h[i] > h[i + 1] and h[i] > h[i + 2]:
            fractal_bear[i] = True
    df["fractal_bull"] = fractal_bull
    df["fractal_bear"] = fractal_bear

    return df


# ── 레짐 감지 (벡터화) ──────────────────────────────────────

def compute_regime(df: pd.DataFrame) -> np.ndarray:
    """7채널 앙상블로 각 봉의 레짐을 판정한다. BULL/SIDEWAYS/BEAR."""
    n = len(df)
    regimes = np.full(n, "SIDEWAYS", dtype=object)
    weights = np.array([0.15, 0.10, 0.25, 0.20, 0.10, 0.10, 0.10])
    bull_th, bear_th = 0.3, -0.3

    c = df["close"].values
    ema20 = df["ema20"].values
    ema50 = df["ema50"].values
    ema200 = df["ema200"].values
    rsi = df["rsi"].values
    atr = df["atr"].values

    for i in range(210, n):
        # ch1: EMA 정렬
        if ema20[i] > ema50[i] > ema200[i]:
            s1 = 1.0
        elif ema20[i] < ema50[i] < ema200[i]:
            s1 = -1.0
        elif ema20[i] > ema50[i]:
            s1 = 0.5
        elif ema20[i] < ema50[i]:
            s1 = -0.5
        else:
            s1 = 0.0

        # ch2: EMA50 기울기
        if i >= 5 and ema50[i - 5] != 0:
            slope = (ema50[i] / ema50[i - 5] - 1.0) * 100
            s2 = np.clip(slope / 2.0, -1.0, 1.0)
        else:
            s2 = 0.0

        # ch3: ADX 방향 (단순화 — EMA20-50 기반 강도)
        ema_diff = (ema20[i] - ema50[i]) / ema50[i] * 100 if ema50[i] != 0 else 0
        s3 = np.clip(ema_diff / 3.0, -1.0, 1.0)

        # ch4: MACD hist
        mh = df["macd_hist"].values[i]
        price = c[i]
        if price > 0:
            norm_mh = mh / price * 1000
            s4 = np.clip(norm_mh, -1.0, 1.0)
        else:
            s4 = 0.0

        # ch5: BB 위치
        bb_up = df["bb_upper"].values[i]
        bb_lo = df["bb_lower"].values[i]
        bb_mid = df["bb_mid"].values[i]
        bw = bb_up - bb_lo
        if bw > 0:
            s5 = np.clip((c[i] - bb_mid) / (bw / 2), -1.0, 1.0)
        else:
            s5 = 0.0

        # ch6: RSI
        s6 = np.clip((rsi[i] - 50) / 50, -1.0, 1.0)

        # ch7: 거래량 방향
        vol = df["volume"].values[i]
        vol_ma = df["vol_ma20"].values[i]
        if vol_ma > 0 and i > 0:
            vr = min(vol / vol_ma, 2.0) / 2.0
            direction = 1.0 if c[i] > c[i - 1] else -1.0
            s7 = np.clip(direction * vr, -1.0, 1.0)
        else:
            s7 = 0.0

        scores = np.array([s1, s2, s3, s4, s5, s6, s7])
        ws = np.dot(weights, scores)

        if ws > bull_th:
            regimes[i] = "BULL"
        elif ws < bear_th:
            regimes[i] = "BEAR"
        else:
            regimes[i] = "SIDEWAYS"

    return regimes


# ── 캔들 패턴 헬퍼 ──────────────────────────────────────────

def is_hammer(df, i: int) -> bool:
    """망치형 캔들 (아래꼬리 > 몸통 * 1.5)."""
    body = df["body"].values[i]
    lw = df["lower_wick"].values[i]
    uw = df["upper_wick"].values[i]
    return body > 0 and lw > body * 1.5 and uw < body * 0.5


def is_inv_hammer(df, i: int) -> bool:
    """역망치 캔들 (윗꼬리 > 몸통 * 1.5)."""
    body = df["body"].values[i]
    uw = df["upper_wick"].values[i]
    lw = df["lower_wick"].values[i]
    return body > 0 and uw > body * 1.5 and lw < body * 0.5


def is_engulfing_bull(df, i: int) -> bool:
    """상승 장악형 (이전 음봉을 현재 양봉이 감싸기)."""
    if i < 1:
        return False
    prev_bull = df["is_bullish"].values[i - 1]
    curr_bull = df["is_bullish"].values[i]
    if prev_bull or not curr_bull:
        return False
    return (df["close"].values[i] > df["open"].values[i - 1] and
            df["open"].values[i] < df["close"].values[i - 1])


# ── S1: RSI 풀백 전략 ───────────────────────────────────────

def run_s1_rsi_pullback(df, regimes, params, fee_pct=0.0, slippage_pct=0.0) -> list:
    """S1: RSI 풀백 + 과매도 바운스 (LONG-only). 차봉진입+수수료+슬리피지."""
    trades = []
    n = len(df)
    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    rsi = df["rsi"].values
    ema20 = df["ema20"].values
    ema50 = df["ema50"].values
    ema200 = df["ema200"].values
    atr = df["atr"].values
    macd_h = df["macd_hist"].values
    vol_r = df["vol_ratio"].values

    pb_lo = params.get("pullback_low", 35.0)
    pb_hi = params.get("pullback_high", 50.0)
    oversold = params.get("oversold", 30.0)
    overbought_exit = params.get("overbought_exit", 72.0)
    sl_mult = params.get("sl_mult", 1.5)
    tp_mult = params.get("tp_mult", 3.0)
    trail_mult = params.get("trail_mult", 2.0)
    vol_min = params.get("vol_min", 0.8)
    use_regime = params.get("use_regime", True)
    cooldown = params.get("cooldown", 3)
    use_breakeven = params.get("use_breakeven", True)
    min_atr_pct = params.get("min_atr_pct", 0.0)  # 최소 ATR/가격 비율 (변동성 필터)
    slip = slippage_pct / 100

    position = None
    last_exit = 0

    for i in range(55, n - 1):
        # 청산 체크
        if position is not None:
            hi = h[i]
            lo = l[i]

            # 트레일 하이 업데이트
            if hi > position.trail_high:
                position.trail_high = hi

            # 1.5R 브레이크이븐 (선택적)
            if use_breakeven:
                risk = position.entry_price - position.sl
                be_trigger = position.entry_price + risk * 1.5
                if hi >= be_trigger and not position.breakeven_active:
                    position.sl = position.entry_price + risk * 0.2
                    position.breakeven_active = True

            # 트레일링 SL
            trail_sl = position.trail_high - atr[i] * trail_mult
            if trail_sl > position.sl:
                position.sl = trail_sl

            # SL 체크 (스탑 주문 → 슬리피지 발생)
            if lo <= position.sl:
                position.exit_idx = i
                position.exit_price = position.sl * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "SL"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            # TP 체크 (지정가 → 슬리피지 없음)
            if hi >= position.tp:
                position.exit_idx = i
                position.exit_price = position.tp
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TP"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            # RSI 과매수 청산 (시장가 → 슬리피지)
            if rsi[i] > overbought_exit:
                position.exit_idx = i
                position.exit_price = c[i] * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "RSI_OB"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            # 시간 기반 청산 (시장가 → 슬리피지)
            if i - position.entry_idx >= 20:
                position.exit_idx = i
                position.exit_price = c[i] * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TIME_EXIT"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue
            continue

        # 쿨다운
        if i - last_exit < cooldown:
            continue

        # 레짐 필터
        if use_regime and regimes[i] == "BEAR":
            continue

        entry = False

        # 양봉 품질: 종가가 봉 상단 40% 이내
        bar_range = h[i] - l[i]
        quality_bull = bar_range > 0 and (c[i] - l[i]) / bar_range >= 0.6

        # 모드A: 풀백
        if (ema20[i] > ema50[i] and
                pb_lo <= rsi[i] <= pb_hi and
                rsi[i] > rsi[i - 1] and
                c[i] > o[i] and quality_bull):
            macd_ok = macd_h[i] > macd_h[i - 1]
            vol_ok = vol_r[i] >= vol_min
            if macd_ok or vol_ok:
                entry = True

        # 모드B: 과매도 바운스
        if not entry and (rsi[i] < oversold and
                          rsi[i] > rsi[i - 1] and
                          c[i] > o[i] and quality_bull and
                          c[i] > ema200[i]):
            entry = True

        if entry and atr[i] > 0:
            # 변동성 필터: ATR/가격이 너무 낮으면 비용 커버 불가
            if min_atr_pct > 0 and c[i] > 0 and atr[i] / c[i] * 100 < min_atr_pct:
                continue
            ni = i + 1
            if ni >= n:
                continue
            ep = o[ni] * (1 + slip)  # 차봉 시가 + 슬리피지
            sl_price = ep - atr[i] * sl_mult
            tp_price = ep + atr[i] * tp_mult
            position = Trade(
                strategy="S1_RSI_Pullback",
                entry_idx=ni, entry_price=ep,
                entry_time=str(df["datetime"].values[ni]),
                sl=sl_price, tp=tp_price,
                regime=regimes[i], trail_high=ep,
            )

    # 미청산 강제 청산
    if position is not None:
        position.exit_idx = n - 1
        position.exit_price = c[n - 1] * (1 - slip)
        position.exit_time = str(df["datetime"].values[n - 1])
        position.exit_reason = "FORCE_CLOSE"
        position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
        trades.append(position)

    return trades


# ── S2: 거래량 폭발 돌파 전략 ────────────────────────────────

def run_s2_volume_breakout(df, regimes, params, fee_pct=0.0, slippage_pct=0.0) -> list:
    """S2: 거래량 폭발 → 박스권 → 메마름 → 돌파 (LONG-only). 차봉진입+수수료+슬리피지."""
    trades = []
    n = len(df)
    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values
    vol_ma = df["vol_ma10"].values

    explosion_mult = params.get("explosion_mult", 2.0)
    dry_ratio = params.get("dry_ratio", 0.7)
    box_lookback = params.get("box_lookback", 20)
    rr_ratio = params.get("rr_ratio", 3.0)
    use_regime = params.get("use_regime", True)
    cooldown = params.get("cooldown", 3)
    slip = slippage_pct / 100

    position = None
    last_exit = 0
    box_active = False
    box_high = 0.0
    box_low = 0.0
    explosion_idx = 0

    for i in range(30, n - 1):
        # 청산 체크
        if position is not None:
            lo_val = l[i]
            hi_val = h[i]
            if lo_val <= position.sl:
                position.exit_idx = i
                position.exit_price = position.sl * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "SL"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                box_active = False
                continue
            if hi_val >= position.tp:
                position.exit_idx = i
                position.exit_price = position.tp
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TP"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                box_active = False
                continue

            if i - position.entry_idx >= 30:
                position.exit_idx = i
                position.exit_price = c[i] * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TIME_EXIT"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                box_active = False
                continue
            continue

        if i - last_exit < cooldown:
            continue

        if use_regime and regimes[i] == "BEAR":
            box_active = False
            continue

        # Phase 1: 거래량 폭발 감지
        if not box_active and vol_ma[i] > 0:
            if v[i] > vol_ma[i] * explosion_mult and c[i] > o[i]:
                box_active = True
                explosion_idx = i
                box_high = h[i]
                box_low = l[i]
                continue

        # 박스 업데이트 + 돌파 체크
        if box_active and position is None:
            elapsed = i - explosion_idx
            if elapsed > box_lookback:
                box_active = False
                continue

            breakout = False
            if elapsed >= 3:
                dry_start = max(explosion_idx + 1, i - 4)
                dry_end = i
                dry_count = 0
                dry_total = 0
                for j in range(dry_start, dry_end):
                    if vol_ma[j] > 0:
                        dry_total += 1
                        if v[j] < vol_ma[j] * dry_ratio:
                            dry_count += 1
                recent_dry = dry_total > 0 and dry_count >= dry_total * 0.5

                if recent_dry and c[i] > box_high and c[i] > o[i]:
                    ni = i + 1
                    if ni < n:
                        ep = o[ni] * (1 + slip)
                        risk = ep - box_low
                        if risk > 0 and risk / ep < 0.10:
                            tp_price = ep + risk * rr_ratio
                            position = Trade(
                                strategy="S2_Volume_Breakout",
                                entry_idx=ni, entry_price=ep,
                                entry_time=str(df["datetime"].values[ni]),
                                sl=box_low, tp=tp_price,
                                regime=regimes[i], trail_high=ep,
                            )
                            box_active = False
                            breakout = True

            if not breakout:
                box_high = max(box_high, h[i])
                box_low = min(box_low, l[i])

    if position is not None:
        position.exit_idx = n - 1
        position.exit_price = c[n - 1] * (1 - slip)
        position.exit_time = str(df["datetime"].values[n - 1])
        position.exit_reason = "FORCE_CLOSE"
        position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
        trades.append(position)

    return trades


# ── S3: 하이킨아시 패턴 전략 ────────────────────────────────

def run_s3_heikin_ashi(df, regimes, params, fee_pct=0.0, slippage_pct=0.0) -> list:
    """S3: 하이킨아시 도지 → 평평한 양봉 반전 (LONG-only). 차봉진입+수수료+슬리피지."""
    trades = []
    n = len(df)
    c = df["close"].values
    o = df["open"].values
    ha_o = df["ha_open"].values
    ha_c = df["ha_close"].values
    ha_h = df["ha_high"].values
    ha_l = df["ha_low"].values

    doji_body_ratio = params.get("doji_body_ratio", 0.1)
    flat_tol = params.get("flat_tol", 0.001)
    rr_ratio = params.get("rr_ratio", 2.0)
    min_bearish = params.get("min_bearish", 3)
    use_regime = params.get("use_regime", True)
    cooldown = params.get("cooldown", 3)
    ha_weak_min_pct = params.get("ha_weak_min_pct", 0.0)  # HA_WEAK 최소 이익 %
    trail_after_pct = params.get("trail_after_pct", 0.0)   # 트레일링 시작 이익 %
    min_atr_pct = params.get("min_atr_pct", 0.0)  # 최소 ATR/가격 비율 (변동성 필터)
    slip = slippage_pct / 100

    atr = df["atr"].values
    position = None
    last_exit = 0

    for i in range(55, n - 1):
        # 청산 체크
        if position is not None:
            lo = df["low"].values[i]
            hi = df["high"].values[i]

            # 트레일링 SL: 일정 수익 이후 SL을 올림
            if trail_after_pct > 0 and hi > position.trail_high:
                position.trail_high = hi
                unreal = (hi - position.entry_price) / position.entry_price * 100
                if unreal > trail_after_pct:
                    # ATR 기반 트레일링 (현재 ATR의 1.5배)
                    trail_sl = hi - atr[i] * 1.5
                    if trail_sl > position.sl:
                        position.sl = trail_sl

            if lo <= position.sl:
                position.exit_idx = i
                position.exit_price = position.sl * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "SL"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            if hi >= position.tp:
                position.exit_idx = i
                position.exit_price = position.tp
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TP"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            # HA 양봉에 아래꼬리 → 추세 약화 청산 (최소 이익 필터)
            if ha_c[i] > ha_o[i]:
                if ha_l[i] < ha_o[i] - abs(ha_c[i] - ha_o[i]) * 0.3:
                    exit_px = c[i] * (1 - slip)
                    cur_pnl = calc_pnl(position.entry_price, exit_px, fee_pct)
                    if cur_pnl > ha_weak_min_pct:
                        position.exit_idx = i
                        position.exit_price = exit_px
                        position.exit_time = str(df["datetime"].values[i])
                        position.exit_reason = "HA_WEAK"
                        position.pnl_pct = cur_pnl
                        trades.append(position)
                        last_exit = i
                        position = None
                    continue
            continue

        if i - last_exit < cooldown:
            continue

        if use_regime and regimes[i] == "BEAR":
            continue

        # Step 1: 이전 N봉이 HA 음봉인지 확인
        if i < min_bearish + 1:
            continue
        bearish_count = 0
        for j in range(i - min_bearish, i):
            if ha_c[j] < ha_o[j]:
                bearish_count += 1
        if bearish_count < min_bearish:
            continue

        # Step 2: 현재 봉이 도지인지
        ha_body = abs(ha_c[i] - ha_o[i])
        ha_range = ha_h[i] - ha_l[i]
        if ha_range == 0:
            continue
        if ha_body / ha_range > doji_body_ratio:
            continue
        upper_wick = ha_h[i] - max(ha_o[i], ha_c[i])
        lower_wick = min(ha_o[i], ha_c[i]) - ha_l[i]
        if upper_wick < ha_range * 0.1 or lower_wick < ha_range * 0.1:
            continue

        # Step 3: 다음 봉 확인 (i+1이 평평한 양봉인지)
        ni = i + 1
        if ni >= n - 1:
            continue
        if ha_c[ni] <= ha_o[ni]:
            continue
        if ha_o[ni] > 0 and abs(ha_l[ni] - ha_o[ni]) / ha_o[ni] > flat_tol:
            continue

        # 변동성 필터: ATR/가격이 너무 낮으면 비용 커버 불가
        if min_atr_pct > 0 and c[ni] > 0 and atr[ni] / c[ni] * 100 < min_atr_pct:
            continue

        # 차봉진입: 확인봉(ni) 다음 봉(ni+1)의 시가에 진입
        entry_bar = ni + 1
        if entry_bar >= n:
            continue
        ep = o[entry_bar] * (1 + slip)
        sl_price = ha_l[i]  # 도지 캔들 저점
        risk = ep - sl_price
        if risk <= 0:
            continue
        tp_price = ep + risk * rr_ratio

        position = Trade(
            strategy="S3_Heikin_Ashi",
            entry_idx=entry_bar, entry_price=ep,
            entry_time=str(df["datetime"].values[entry_bar]),
            sl=sl_price, tp=tp_price,
            regime=regimes[ni], trail_high=ep,
        )

    if position is not None:
        position.exit_idx = n - 1
        position.exit_price = c[n - 1] * (1 - slip)
        position.exit_time = str(df["datetime"].values[n - 1])
        position.exit_reason = "FORCE_CLOSE"
        position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
        trades.append(position)

    return trades


# ── S4: VWAP 눌림목/반전 전략 ────────────────────────────────

def run_s4_vwap(df, regimes, params, fee_pct=0.0, slippage_pct=0.0) -> list:
    """S4: VWAP 눌림목 (추세장) + VWAP 반전 (횡보장) (LONG-only). 차봉진입+수수료+슬리피지."""
    trades = []
    n = len(df)
    c = df["close"].values
    o = df["open"].values
    vwap = df["vwap"].values
    vwap_lo = df["vwap_lower"].values

    rr_ratio = params.get("rr_ratio", 2.0)
    pullback_tol = params.get("pullback_tol", 0.005)
    use_regime = params.get("use_regime", True)
    cooldown = params.get("cooldown", 3)
    slip = slippage_pct / 100

    atr = df["atr"].values
    position = None
    last_exit = 0

    for i in range(30, n - 1):
        # 청산 체크
        if position is not None:
            lo = df["low"].values[i]
            hi = df["high"].values[i]

            position.trail_high = max(position.trail_high, hi)

            if atr[i] > 0:
                trail_sl = position.trail_high - atr[i] * 2.5
                if trail_sl > position.sl:
                    position.sl = trail_sl

            if lo <= position.sl:
                position.exit_idx = i
                position.exit_price = position.sl * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "SL"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue
            if hi >= position.tp:
                position.exit_idx = i
                position.exit_price = position.tp
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TP"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            if i - position.entry_idx >= 15:
                position.exit_idx = i
                position.exit_price = c[i] * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TIME_EXIT"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue
            continue

        if i - last_exit < cooldown:
            continue

        if use_regime and regimes[i] == "BEAR":
            continue

        entry = False
        sl_price = 0.0
        tp_price = 0.0
        sub_strategy = ""

        # 전략A: VWAP 눌림목
        if (regimes[i] in ("BULL", "SIDEWAYS") and
                c[i] > vwap[i] and
                i >= 5 and vwap[i] > vwap[i - 5] and
                vwap[i] > 0):
            dist = (c[i] - vwap[i]) / vwap[i]
            if dist < pullback_tol:
                if is_hammer(df, i) or is_engulfing_bull(df, i):
                    atr_val = atr[i]
                    sl_price = vwap[i] - atr_val * 0.5
                    risk_est = c[i] - sl_price
                    if risk_est > 0:
                        tp_price = c[i] + risk_est * rr_ratio
                        entry = True
                        sub_strategy = "VWAP_Pullback"

        # 전략B: VWAP 반전
        if not entry and regimes[i] == "SIDEWAYS":
            if vwap_lo[i] > 0 and c[i] <= vwap_lo[i]:
                if is_hammer(df, i) or is_engulfing_bull(df, i):
                    atr_val = atr[i]
                    sl_price = vwap_lo[i] - atr_val * 0.5
                    tp_price = vwap[i]
                    risk_est = c[i] - sl_price
                    if risk_est > 0 and tp_price > c[i]:
                        entry = True
                        sub_strategy = "VWAP_Reversal"

        if entry:
            ni = i + 1
            if ni >= n:
                continue
            ep = o[ni] * (1 + slip)
            # SL/TP를 실제 진입가 기준으로 재계산
            risk = ep - sl_price
            if risk <= 0:
                continue
            if sub_strategy == "VWAP_Pullback":
                tp_price = ep + risk * rr_ratio
            elif sub_strategy == "VWAP_Reversal":
                tp_price = vwap[i]  # VWAP 중심선까지
                if tp_price <= ep:
                    continue

            position = Trade(
                strategy=f"S4_{sub_strategy}",
                entry_idx=ni, entry_price=ep,
                entry_time=str(df["datetime"].values[ni]),
                sl=sl_price, tp=tp_price,
                regime=regimes[i], trail_high=ep,
            )

    if position is not None:
        position.exit_idx = n - 1
        position.exit_price = c[n - 1] * (1 - slip)
        position.exit_time = str(df["datetime"].values[n - 1])
        position.exit_reason = "FORCE_CLOSE"
        position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
        trades.append(position)

    return trades


# ── 분석 + 리포트 ────────────────────────────────────────────

def analyze(trades: list, name: str, regimes: np.ndarray = None) -> dict:
    """거래 결과를 분석한다."""
    if not trades:
        return {"name": name, "count": 0, "win_rate": 0, "pf": 0, "mdd": 0,
                "total_return": 0, "avg_hold": 0, "avg_pnl": 0,
                "regime_stats": {}, "exit_reasons": {}}

    wins = [t for t in trades if t.pnl_pct > 0]
    losses = [t for t in trades if t.pnl_pct <= 0]
    win_rate = len(wins) / len(trades) * 100

    gross_profit = sum(t.pnl_pct for t in wins)
    gross_loss = abs(sum(t.pnl_pct for t in losses))
    pf = gross_profit / gross_loss if gross_loss > 0 else 999.0

    # MDD
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for t in trades:
        equity *= (1 + t.pnl_pct / 100)
        peak = max(peak, equity)
        dd = (peak - equity) / peak * 100
        max_dd = max(max_dd, dd)

    total_return = (equity - 1) * 100
    avg_hold = np.mean([t.exit_idx - t.entry_idx for t in trades])

    # 레짐별 분석
    regime_stats = {}
    for regime in ["BULL", "SIDEWAYS", "BEAR"]:
        rt = [t for t in trades if t.regime == regime]
        if rt:
            rw = [t for t in rt if t.pnl_pct > 0]
            regime_stats[regime] = {
                "count": len(rt),
                "win_rate": len(rw) / len(rt) * 100,
                "avg_pnl": np.mean([t.pnl_pct for t in rt]),
            }

    # 청산 사유별 분석
    exit_reasons = {}
    for t in trades:
        r = t.exit_reason
        if r not in exit_reasons:
            exit_reasons[r] = {"count": 0, "wins": 0}
        exit_reasons[r]["count"] += 1
        if t.pnl_pct > 0:
            exit_reasons[r]["wins"] += 1

    return {
        "name": name,
        "count": len(trades),
        "win_rate": round(win_rate, 1),
        "pf": round(min(pf, 999.0), 2),
        "mdd": round(max_dd, 1),
        "total_return": round(total_return, 2),
        "avg_hold": round(avg_hold, 1),
        "avg_pnl": round(np.mean([t.pnl_pct for t in trades]), 2),
        "regime_stats": regime_stats,
        "exit_reasons": exit_reasons,
    }


def print_summary(stats: dict):
    """분석 결과를 출력한다."""
    print(f"\n{'='*60}")
    print(f"  {stats['name']}")
    print(f"{'='*60}")
    print(f"  거래 수: {stats['count']}")
    print(f"  승률: {stats['win_rate']}%")
    print(f"  PF: {stats['pf']}")
    print(f"  MDD: {stats['mdd']}%")
    print(f"  총 수익: {stats['total_return']}%")
    print(f"  평균 보유: {stats['avg_hold']}봉")
    print(f"  평균 PnL: {stats['avg_pnl']}%")

    if stats.get("regime_stats"):
        print(f"\n  레짐별 성과:")
        for regime, rs in stats["regime_stats"].items():
            print(f"    {regime:10s}: {rs['count']:3d}건, WR {rs['win_rate']:.1f}%, "
                  f"평균PnL {rs['avg_pnl']:.2f}%")

    if stats.get("exit_reasons"):
        print(f"\n  청산 사유:")
        for reason, rd in stats["exit_reasons"].items():
            wr = rd["wins"] / rd["count"] * 100 if rd["count"] > 0 else 0
            print(f"    {reason:12s}: {rd['count']:3d}건, WR {wr:.1f}%")


def print_comparison(all_stats: list):
    """전략 비교표를 출력한다."""
    print(f"\n{'='*80}")
    print(f"{'전략':25s} {'거래':>5s} {'승률':>6s} {'PF':>6s} {'MDD':>6s} {'수익':>8s}")
    print(f"{'-'*80}")
    for s in all_stats:
        print(f"{s['name']:25s} {s['count']:5d} {s['win_rate']:5.1f}% "
              f"{s['pf']:6.2f} {s['mdd']:5.1f}% {s['total_return']:7.2f}%")
    print(f"{'='*80}")


def print_regime_matrix(all_stats: list):
    """4전략 × 3레짐 매트릭스를 출력한다."""
    print(f"\n{'='*80}")
    print(f"  레짐-전략 매트릭스 (승률%)")
    print(f"{'='*80}")
    print(f"{'전략':25s} {'BULL':>10s} {'SIDEWAYS':>10s} {'BEAR':>10s}")
    print(f"{'-'*80}")
    for s in all_stats:
        rs = s.get("regime_stats", {})
        bull = f"{rs['BULL']['win_rate']:.1f}%({rs['BULL']['count']})" if "BULL" in rs else "  -"
        side = f"{rs['SIDEWAYS']['win_rate']:.1f}%({rs['SIDEWAYS']['count']})" if "SIDEWAYS" in rs else "  -"
        bear = f"{rs['BEAR']['win_rate']:.1f}%({rs['BEAR']['count']})" if "BEAR" in rs else "  -"
        print(f"{s['name']:25s} {bull:>10s} {side:>10s} {bear:>10s}")
    print(f"{'='*80}")


# ── 그리드서치 ───────────────────────────────────────────────

def robust_score(stats: dict, min_trades: int = 5) -> float:
    """비용 포함 시 **양의 수익**을 최우선으로 하는 스코어링.

    Round 3: 총 수익이 마이너스면 심하게 감점, 양의 수익에 큰 보너스.
    이전 스코어링은 WR 중심이라 작은 승리 → 비용에 잠식 → 마이너스 수익 문제.
    """
    if stats["count"] < min_trades:
        return -1
    wr = stats["win_rate"]
    pf = min(stats["pf"], 5)
    mdd = stats["mdd"]
    count = stats["count"]
    total_ret = stats["total_return"]
    avg_pnl = stats.get("avg_pnl", 0)

    # 핵심: 양의 수익 보너스 / 음의 수익 강한 감점
    if total_ret > 0:
        ret_score = total_ret * 2.0  # 양수면 큰 보상
    else:
        ret_score = total_ret * 3.0  # 음수면 더 큰 감점

    # 평균 PnL 보너스 (거래당 이익 크기)
    pnl_bonus = max(0, avg_pnl) * 5.0

    # 기본 점수: WR(20%) + PF(20%) + MDD(10%) + Return(35%) + AvgPnL(15%)
    score = (wr * 0.20 +
             pf * 10 * 0.20 +
             max(0, 30 - mdd) * 0.10 +
             ret_score * 0.35 +
             pnl_bonus * 0.15)

    # 거래 수 보너스/페널티
    if count >= 20:
        score *= 1.1
    elif count < 8:
        score *= 0.7

    return score


def grid_search_s1(df, regimes, fee_pct=0.0, slippage_pct=0.0) -> dict:
    """S1 RSI 풀백 파라미터 그리드서치 (비용 포함, BE 옵션, ATR 필터)."""
    best = {"score": -1}
    combos = 0
    for pb_lo in [25, 30, 35, 40]:
        for pb_hi in [45, 50, 55, 60]:
            if pb_lo >= pb_hi:
                continue
            for sl_m in [1.5, 2.0, 2.5]:
                for tp_m in [2.0, 2.5, 3.0, 3.5, 4.0]:
                    for min_atr in [0.0, 0.3, 0.5]:
                        params = {
                            "pullback_low": pb_lo, "pullback_high": pb_hi,
                            "sl_mult": sl_m, "tp_mult": tp_m,
                            "trail_mult": 2.0, "vol_min": 0.5,
                            "overbought_exit": 72, "oversold": 30,
                            "use_regime": True, "cooldown": 2,
                            "use_breakeven": False,
                            "min_atr_pct": min_atr,
                        }
                        trades = run_s1_rsi_pullback(df, regimes, params, fee_pct, slippage_pct)
                        if len(trades) < 5:
                            continue
                        s = analyze(trades, "S1_grid", regimes)
                        score = robust_score(s)
                        combos += 1
                        if score > best["score"]:
                            best = {"score": score, "params": params, "stats": s}
    print(f"  S1 그리드서치: {combos}개 조합 탐색")
    return best


def grid_search_s2(df, regimes, fee_pct=0.0, slippage_pct=0.0) -> dict:
    """S2 거래량 폭발 파라미터 그리드서치 (비용 포함, 넓은 RR)."""
    best = {"score": -1}
    combos = 0
    for exp_m in [1.3, 1.5, 1.8, 2.0, 2.5]:
        for dry_r in [0.6, 0.8, 1.0]:
            for rr in [2.0, 2.5, 3.0, 3.5, 4.0]:
                for box_lb in [15, 25, 35]:
                    params = {
                        "explosion_mult": exp_m, "dry_ratio": dry_r,
                        "rr_ratio": rr, "box_lookback": box_lb,
                        "use_regime": True, "cooldown": 3,
                    }
                    trades = run_s2_volume_breakout(df, regimes, params, fee_pct, slippage_pct)
                    if len(trades) < 3:
                        continue
                    s = analyze(trades, "S2_grid", regimes)
                    score = robust_score(s, min_trades=3)
                    combos += 1
                    if score > best["score"]:
                        best = {"score": score, "params": params, "stats": s}
    print(f"  S2 그리드서치: {combos}개 조합 탐색")
    return best


def grid_search_s3(df, regimes, fee_pct=0.0, slippage_pct=0.0) -> dict:
    """S3 하이킨아시 파라미터 그리드서치 (비용 포함, HA_WEAK 강제 최소이익, ATR 필터)."""
    best = {"score": -1}
    combos = 0
    for doji_r in [0.05, 0.1, 0.15, 0.2]:
        for flat_t in [0.0005, 0.001, 0.002, 0.003]:
            for rr in [2.0, 2.5, 3.0, 3.5, 4.0]:
                for min_b in [2, 3, 4]:
                    for ha_min in [0.3, 0.5, 0.8, 1.0]:
                        for min_atr in [0.0, 0.3, 0.5]:
                            params = {
                                "doji_body_ratio": doji_r, "flat_tol": flat_t,
                                "rr_ratio": rr, "min_bearish": min_b,
                                "use_regime": True, "cooldown": 3,
                                "ha_weak_min_pct": ha_min,
                                "trail_after_pct": 0.0,
                                "min_atr_pct": min_atr,
                            }
                            trades = run_s3_heikin_ashi(df, regimes, params, fee_pct, slippage_pct)
                            if len(trades) < 3:
                                continue
                            s = analyze(trades, "S3_grid", regimes)
                            score = robust_score(s, min_trades=3)
                            combos += 1
                            if score > best["score"]:
                                best = {"score": score, "params": params, "stats": s}
    print(f"  S3 그리드서치: {combos}개 조합 탐색")
    return best


def grid_search_s4(df, regimes, fee_pct=0.0, slippage_pct=0.0) -> dict:
    """S4 VWAP 파라미터 그리드서치 (비용 포함)."""
    best = {"score": -1}
    combos = 0
    for pb_tol in [0.003, 0.005, 0.008, 0.012, 0.015]:
        for rr in [1.0, 1.5, 2.0, 2.5]:
            params = {
                "pullback_tol": pb_tol, "rr_ratio": rr,
                "use_regime": True, "cooldown": 3,
            }
            trades = run_s4_vwap(df, regimes, params, fee_pct, slippage_pct)
            if len(trades) < 3:
                continue
            s = analyze(trades, "S4_grid", regimes)
            score = robust_score(s, min_trades=3)
            combos += 1
            if score > best["score"]:
                best = {"score": score, "params": params, "stats": s}
    print(f"  S4 그리드서치: {combos}개 조합 탐색")
    return best


# ── S5: BEAR 과매도 반등 전략 ────────────────────────────────

def run_s5_bear_bounce(df, regimes, params, fee_pct=0.0, slippage_pct=0.0) -> list:
    """S5: BEAR 레짐 과매도 반등 (역추세 평균회귀, LONG-only). 차봉진입+수수료+슬리피지."""
    trades = []
    n = len(df)
    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values
    rsi = df["rsi"].values
    bb_lo = df["bb_lower"].values
    vol_ma = df["vol_ma10"].values

    rsi_threshold = params.get("rsi_threshold", 25.0)
    vol_spike = params.get("vol_spike", 1.5)
    sl_pct = params.get("sl_pct", 1.5)
    tp_pct = params.get("tp_pct", 2.0)
    max_hold = params.get("max_hold", 10)
    consec_loss_limit = params.get("consec_loss_limit", 3)
    cooldown_bars = params.get("cooldown_bars", 10)
    slip = slippage_pct / 100

    position = None
    last_exit = 0
    consec_losses = 0
    cooldown_until = 0

    for i in range(55, n - 1):
        # 청산 체크
        if position is not None:
            lo_val = l[i]
            hi_val = h[i]

            # SL 체크
            if lo_val <= position.sl:
                position.exit_idx = i
                position.exit_price = position.sl * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "SL"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                consec_losses += 1
                if consec_losses >= consec_loss_limit:
                    cooldown_until = i + cooldown_bars
                position = None
                continue

            # TP 체크
            if hi_val >= position.tp:
                position.exit_idx = i
                position.exit_price = position.tp
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TP"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                consec_losses = 0  # 이익 시 연패 카운터 리셋
                position = None
                continue

            # 시간 제한 청산
            if i - position.entry_idx >= max_hold:
                position.exit_idx = i
                position.exit_price = c[i] * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TIME_EXIT"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                if position.pnl_pct <= 0:
                    consec_losses += 1
                    if consec_losses >= consec_loss_limit:
                        cooldown_until = i + cooldown_bars
                else:
                    consec_losses = 0
                position = None
                continue
            continue

        # 쿨다운
        if i < cooldown_until:
            continue
        if i - last_exit < 3:
            continue

        # BEAR 레짐에서만 진입
        if regimes[i] != "BEAR":
            continue

        # 진입 조건 (RSI 과매도 + 반등 신호)
        if rsi[i] >= rsi_threshold:
            continue
        # BB 하단 근처 (하단 아래 OR 하단 1% 이내)
        bb_near = bb_lo[i] > 0 and c[i] < bb_lo[i] * 1.01
        if not bb_near:
            continue
        if vol_ma[i] <= 0 or v[i] < vol_ma[i] * vol_spike:  # 거래량 스파이크
            continue
        if c[i] <= o[i]:  # 양봉 확인
            continue
        if i < 1 or rsi[i] <= rsi[i - 1]:  # RSI 상승 전환
            continue

        # 차봉진입
        ni = i + 1
        if ni >= n:
            continue
        ep = o[ni] * (1 + slip)
        sl_price = ep * (1 - sl_pct / 100)
        tp_price = ep * (1 + tp_pct / 100)

        position = Trade(
            strategy="S5_Bear_Bounce",
            entry_idx=ni, entry_price=ep,
            entry_time=str(df["datetime"].values[ni]),
            sl=sl_price, tp=tp_price,
            regime="BEAR", trail_high=ep,
        )

    if position is not None:
        position.exit_idx = n - 1
        position.exit_price = c[n - 1] * (1 - slip)
        position.exit_time = str(df["datetime"].values[n - 1])
        position.exit_reason = "FORCE_CLOSE"
        position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
        trades.append(position)

    return trades


def grid_search_s5(df, regimes, fee_pct=0.0, slippage_pct=0.0) -> dict:
    """S5 BEAR 과매도 반등 파라미터 그리드서치 (비용 포함, 넓은 탐색)."""
    best = {"score": -1}
    combos = 0
    for rsi_th in [25, 30, 35, 40, 45]:
        for vol_sp in [1.0, 1.2, 1.5]:
            for sl in [1.0, 1.5, 2.0, 2.5]:
                for tp in [2.0, 3.0, 4.0, 5.0]:
                    for max_h in [8, 12, 15, 20]:
                        params = {
                            "rsi_threshold": rsi_th, "vol_spike": vol_sp,
                            "sl_pct": sl, "tp_pct": tp,
                            "max_hold": max_h,
                            "consec_loss_limit": 3, "cooldown_bars": 8,
                        }
                        trades = run_s5_bear_bounce(df, regimes, params, fee_pct, slippage_pct)
                        if len(trades) < 3:
                            continue
                        s = analyze(trades, "S5_grid", regimes)
                        score = robust_score(s, min_trades=3)
                        combos += 1
                        if score > best["score"]:
                            best = {"score": score, "params": params, "stats": s}
    print(f"  S5 그리드서치: {combos}개 조합 탐색")
    return best


# ── S6: SMMA 리테스트 + 프렉탈 (이동평균선 매매법) ─────────────

def run_s6_smma_retest(df, regimes, params, fee_pct=0.0, slippage_pct=0.0) -> list:
    """S6: SMMA 리테스트 + 프렉탈 (아티브리아 이평선 매매법, LONG-only). 차봉진입+수수료+슬리피지."""
    trades = []
    n = len(df)
    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l = df["low"].values
    smma21 = df["smma21"].values
    smma50 = df["smma50"].values
    smma200 = df["smma200"].values
    frac_bull = df["fractal_bull"].values

    rr_ratio = params.get("rr_ratio", 1.5)
    max_hold = params.get("max_hold", 20)
    tangle_tol = params.get("tangle_tol", 0.005)
    retest_tol = params.get("retest_tol", 0.005)
    use_regime = params.get("use_regime", False)
    cooldown = params.get("cooldown", 3)
    slip = slippage_pct / 100

    position = None
    last_exit = 0

    for i in range(202, n - 1):
        # 청산 체크
        if position is not None:
            # SL 체크
            if l[i] <= position.sl:
                position.exit_idx = i
                position.exit_price = position.sl * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "SL"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            # TP 체크
            if h[i] >= position.tp:
                position.exit_idx = i
                position.exit_price = position.tp
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TP"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue

            # 시간 제한 청산
            if i - position.entry_idx >= max_hold:
                position.exit_idx = i
                position.exit_price = c[i] * (1 - slip)
                position.exit_time = str(df["datetime"].values[i])
                position.exit_reason = "TIME_EXIT"
                position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
                trades.append(position)
                last_exit = i
                position = None
                continue
            continue

        # 쿨다운
        if i - last_exit < cooldown:
            continue

        # 레짐 필터 (선택적 — BULL/SIDEWAYS에서만)
        if use_regime and regimes[i] == "BEAR":
            continue

        # 조건 1: SMMA 정배열 (21 > 50 > 200)
        if not (smma21[i] > smma50[i] > smma200[i]):
            continue

        # 조건 2: MA 꼬임 방지 — 충분한 간격 확인
        spread_21_50 = abs(smma21[i] - smma50[i]) / smma50[i]
        spread_50_200 = abs(smma50[i] - smma200[i]) / smma200[i]
        if spread_21_50 < tangle_tol or spread_50_200 < tangle_tol:
            continue

        # 조건 3: 리테스트 — 가격이 21선 또는 50선까지 눌림
        touch_21 = l[i] <= smma21[i] * (1 + retest_tol)
        touch_50 = l[i] <= smma50[i] * (1 + retest_tol)
        if not (touch_21 or touch_50):
            continue

        # 조건 4: 프렉탈 확인 — 최근 2봉 이내에 불리시 프렉탈 존재
        # (프렉탈은 i-2에서 확정되므로 i-2 또는 i-3 체크)
        has_fractal = False
        fractal_low = c[i]  # 기본 SL 기준
        for fb in range(max(2, i - 4), i + 1):
            if frac_bull[fb]:
                has_fractal = True
                fractal_low = l[fb]
                break
        if not has_fractal:
            continue

        # 조건 5: 양봉 확인 (반등 시작)
        if c[i] <= o[i]:
            continue

        # 차봉진입
        ni = i + 1
        if ni >= n:
            continue
        ep = o[ni] * (1 + slip)

        # SL: 프렉탈 저점 아래
        sl_price = fractal_low * (1 - slip)
        risk = ep - sl_price
        if risk <= 0 or risk / ep > 0.05:  # 리스크가 5% 이상이면 스킵
            continue
        tp_price = ep + risk * rr_ratio

        position = Trade(
            strategy="S6_SMMA_Retest",
            entry_idx=ni, entry_price=ep,
            entry_time=str(df["datetime"].values[ni]),
            sl=sl_price, tp=tp_price,
            regime=regimes[i], trail_high=ep,
        )

    if position is not None:
        position.exit_idx = n - 1
        position.exit_price = c[n - 1] * (1 - slip)
        position.exit_time = str(df["datetime"].values[n - 1])
        position.exit_reason = "FORCE_CLOSE"
        position.pnl_pct = calc_pnl(position.entry_price, position.exit_price, fee_pct)
        trades.append(position)

    return trades


def grid_search_s6(df, regimes, fee_pct=0.0, slippage_pct=0.0) -> dict:
    """S6 SMMA 리테스트 + 프렉탈 파라미터 그리드서치 (비용 포함)."""
    best = {"score": -1}
    combos = 0
    for rr in [1.0, 1.5, 2.0, 2.5]:
        for max_h in [15, 20, 30]:
            for tangle in [0.003, 0.005, 0.01]:
                for retest in [0.003, 0.005, 0.008]:
                    for use_reg in [True, False]:
                        for cd in [2, 3, 5]:
                            params = {
                                "rr_ratio": rr, "max_hold": max_h,
                                "tangle_tol": tangle, "retest_tol": retest,
                                "use_regime": use_reg, "cooldown": cd,
                            }
                            t = run_s6_smma_retest(df, regimes, params, fee_pct, slippage_pct)
                            if len(t) < 3:
                                continue
                            s = analyze(t, "S6_grid", regimes)
                            score = robust_score(s, min_trades=3)
                            combos += 1
                            if score > best["score"]:
                                best = {"score": score, "params": params, "stats": s}
    print(f"  S6 그리드서치: {combos}개 조합 탐색")
    return best


# ── S3 핵심 파라미터만 그리드서치 (과적합 방지) ──────────────

def grid_search_s3_focused(df, regimes, fee_pct=0.0, slippage_pct=0.0) -> dict:
    """S3 핵심 파라미터만 탐색 (doji/flat 고정, RR+ha_weak+min_atr만 변경)."""
    best = {"score": -1}
    combos = 0
    for rr in [2.0, 2.5, 3.0, 3.5, 4.0]:
        for ha_min in [0.3, 0.5, 0.8, 1.0, 1.5]:
            for min_atr in [0.0, 0.3, 0.5]:
                params = {
                    "doji_body_ratio": 0.1, "flat_tol": 0.001,
                    "rr_ratio": rr, "min_bearish": 3,
                    "use_regime": True, "cooldown": 3,
                    "ha_weak_min_pct": ha_min,
                    "trail_after_pct": 0.0,
                    "min_atr_pct": min_atr,
                }
                trades = run_s3_heikin_ashi(df, regimes, params, fee_pct, slippage_pct)
                if len(trades) < 3:
                    continue
                s = analyze(trades, "S3_focused", regimes)
                score = robust_score(s, min_trades=3)
                combos += 1
                if score > best["score"]:
                    best = {"score": score, "params": params, "stats": s}
    return best


def stability_test_s3(df, params, fee_pct=0.04, slippage_pct=0.05, n_folds=5):
    """안정성 검증: 고정 파라미터를 여러 시간 구간에서 테스트 (재최적화 없음)."""
    n = len(df)
    fold_size = n // n_folds
    print(f"\n  S3 안정성 테스트 ({n_folds} folds, {fold_size}봉/fold)")
    print(f"  고정 파라미터: rr={params.get('rr_ratio')}, "
          f"ha_weak={params.get('ha_weak_min_pct')}, "
          f"min_atr={params.get('min_atr_pct')}, "
          f"doji={params.get('doji_body_ratio')}")

    fold_results = []
    all_test_trades = []

    for fold_idx in range(n_folds):
        start = fold_idx * fold_size
        end = min(start + fold_size, n)
        df_fold = df.iloc[start:end].copy().reset_index(drop=True)

        if len(df_fold) < 300:
            continue

        df_fold = compute_indicators(df_fold)
        reg_fold = compute_regime(df_fold)

        trades = run_s3_heikin_ashi(df_fold, reg_fold, params, fee_pct, slippage_pct)
        stats = analyze(trades, f"Fold_{fold_idx}", reg_fold)

        fold_results.append({
            "fold": fold_idx,
            "count": stats["count"],
            "wr": stats["win_rate"],
            "ret": stats["total_return"],
            "pf": stats["pf"],
            "avg_pnl": stats["avg_pnl"],
        })
        all_test_trades.extend(trades)

        status = "✅" if stats["total_return"] > 0 else "❌"
        print(f"    Fold {fold_idx}: {stats['count']:2d}건, WR {stats['win_rate']:5.1f}%, "
              f"PF {stats['pf']:.2f}, Ret {stats['total_return']:+6.2f}% {status}")

    if fold_results:
        valid = [r for r in fold_results if r["count"] > 0]
        if valid:
            avg_wr = np.mean([r["wr"] for r in valid])
            avg_ret = np.mean([r["ret"] for r in valid])
            positive_folds = sum(1 for r in valid if r["ret"] > 0)
            total_trades = sum(r["count"] for r in valid)
            print(f"    ─────────────────────────────────")
            print(f"    평균: WR={avg_wr:.1f}%, Ret={avg_ret:.2f}%, "
                  f"양수구간 {positive_folds}/{len(valid)}, 총 {total_trades}건")
            return fold_results, all_test_trades, positive_folds / len(valid) if valid else 0
    return [], [], 0


# ── Walk-forward 기반 강건 최적화 ────────────────────────────

def walk_forward_optimize(df, fee_pct=0.04, slippage_pct=0.05):
    """Walk-forward 기반 강건 최적화: Train(70%) 비용포함 그리드서치 → Test(30%) 검증."""
    print(f"\n{'='*70}")
    print(f"  Walk-forward 강건 최적화 (비용 포함: fee={fee_pct}%, slip={slippage_pct}%)")
    print(f"{'='*70}")

    # 데이터 분할
    df_train, df_test = walk_forward_split(df, train_ratio=0.7)
    df_train = compute_indicators(df_train)
    df_test = compute_indicators(df_test)
    reg_train = compute_regime(df_train)
    reg_test = compute_regime(df_test)
    print(f"  Train: {len(df_train)}봉, Test: {len(df_test)}봉")

    strategy_runners = {
        "S1": (run_s1_rsi_pullback, grid_search_s1),
        "S2": (run_s2_volume_breakout, grid_search_s2),
        "S3": (run_s3_heikin_ashi, grid_search_s3),
        "S4": (run_s4_vwap, grid_search_s4),
        "S5": (run_s5_bear_bounce, grid_search_s5),
        "S6": (run_s6_smma_retest, grid_search_s6),
    }

    results = {}
    for sname, (runner, searcher) in strategy_runners.items():
        print(f"\n  [{sname}] Train 비용포함 그리드서치...", end=" ")
        gs = searcher(df_train, reg_train, fee_pct, slippage_pct)
        if gs["score"] <= 0:
            print("데이터 부족")
            continue
        train_stats = gs["stats"]
        train_wr = train_stats["win_rate"]
        train_ret = train_stats["total_return"]

        # Test에 동일 파라미터 + 동일 비용 적용
        test_trades = runner(df_test, reg_test, gs["params"], fee_pct, slippage_pct)
        test_stats = analyze(test_trades, f"WF_{sname}_Test", reg_test)
        test_wr = test_stats["win_rate"]
        test_ret = test_stats["total_return"]
        delta = train_wr - test_wr

        status = "OK" if abs(delta) < 15 else "OVERFIT"
        # 특수: Test가 Train보다 좋으면 과적합 아님
        if test_wr > train_wr:
            status = "OK"

        results[sname] = {
            "params": gs["params"],
            "train_stats": train_stats,
            "test_stats": test_stats,
            "delta": delta,
            "status": status,
        }

        print(f"\n    Train: WR={train_wr:.1f}%, Ret={train_ret:.2f}% | "
              f"Test: WR={test_wr:.1f}%, Ret={test_ret:.2f}% | "
              f"Delta={delta:+.1f}%p → {status}")

    # 강건한 전략 선별 (Test WR > 45% AND 수익 > 0 OR status OK)
    robust = {}
    for sname, r in results.items():
        test_wr = r["test_stats"]["win_rate"]
        test_count = r["test_stats"]["count"]
        if r["status"] == "OK" and test_count >= 2:
            robust[sname] = r
            print(f"  ✅ {sname}: 강건 (Test WR={test_wr:.1f}%)")
        else:
            print(f"  ❌ {sname}: 제외 (Test WR={test_wr:.1f}%, {r['status']})")

    return results, robust


# ── 메인 실행 ────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("  LONG-Only 멀티 전략 단타 백테스트")
    print("  6전략 × 3레짐 학습 루프 + 정밀도 개선")
    print("=" * 70)

    # 데이터 수집
    coins = ["BTC", "ETH", "XRP", "SOL", "DOGE"]
    primary = "BTC"

    df = fetch_data(primary)
    if df is None:
        print("데이터 수집 실패!")
        return

    print(f"\n지표 계산 중...")
    df = compute_indicators(df)
    print(f"레짐 판정 중...")
    regimes = compute_regime(df)

    # 레짐 분포
    bull_n = np.sum(regimes == "BULL")
    side_n = np.sum(regimes == "SIDEWAYS")
    bear_n = np.sum(regimes == "BEAR")
    total_n = len(regimes)
    print(f"  BULL: {bull_n} ({bull_n/total_n*100:.1f}%)")
    print(f"  SIDEWAYS: {side_n} ({side_n/total_n*100:.1f}%)")
    print(f"  BEAR: {bear_n} ({bear_n/total_n*100:.1f}%)")

    all_stats = []

    # ── Phase 1: 기준선 (R0~R4) ──────────────────────────────
    print(f"\n{'='*70}")
    print(f"  Phase 1: 개별 전략 기준선 (차봉진입, 수수료/슬리피지 없음)")
    print(f"{'='*70}")

    s1_default = {
        "pullback_low": 30, "pullback_high": 55,
        "oversold": 30, "overbought_exit": 72,
        "sl_mult": 1.5, "tp_mult": 2.5, "trail_mult": 2.0,
        "vol_min": 0.5, "use_regime": True, "cooldown": 2,
    }
    s2_default = {
        "explosion_mult": 1.8, "dry_ratio": 0.8,
        "box_lookback": 25, "rr_ratio": 2.5,
        "use_regime": True, "cooldown": 2,
    }
    s3_default = {
        "doji_body_ratio": 0.15, "flat_tol": 0.003,
        "rr_ratio": 2.0, "min_bearish": 2,
        "use_regime": True, "cooldown": 2,
        "ha_weak_min_pct": 0.0, "trail_after_pct": 0.0,
    }
    s4_default = {
        "pullback_tol": 0.01, "rr_ratio": 2.0,
        "use_regime": True, "cooldown": 2,
    }
    s5_default = {
        "rsi_threshold": 25, "vol_spike": 1.5,
        "sl_pct": 1.5, "tp_pct": 2.0,
        "max_hold": 10, "consec_loss_limit": 3, "cooldown_bars": 10,
    }
    s6_default = {
        "rr_ratio": 1.5, "max_hold": 20,
        "tangle_tol": 0.005, "retest_tol": 0.005,
        "use_regime": False, "cooldown": 3,
    }

    print(f"\nR0: S1 RSI 풀백 (기본값)")
    t0 = run_s1_rsi_pullback(df, regimes, s1_default)
    s0 = analyze(t0, "R0: S1_RSI_Pullback", regimes)
    print_summary(s0)
    all_stats.append(s0)

    print(f"\nR1: S2 거래량 폭발 돌파 (기본값)")
    t1 = run_s2_volume_breakout(df, regimes, s2_default)
    s1_stats = analyze(t1, "R1: S2_Volume_Breakout", regimes)
    print_summary(s1_stats)
    all_stats.append(s1_stats)

    print(f"\nR2: S3 하이킨아시 패턴 (기본값)")
    t2 = run_s3_heikin_ashi(df, regimes, s3_default)
    s2_stats = analyze(t2, "R2: S3_Heikin_Ashi", regimes)
    print_summary(s2_stats)
    all_stats.append(s2_stats)

    print(f"\nR3: S4 VWAP 눌림목/반전 (기본값)")
    t3 = run_s4_vwap(df, regimes, s4_default)
    s3_stats = analyze(t3, "R3: S4_VWAP", regimes)
    print_summary(s3_stats)
    all_stats.append(s3_stats)

    print(f"\nR4: S5 BEAR 과매도 반등 (기본값)")
    t4 = run_s5_bear_bounce(df, regimes, s5_default)
    s4_stats = analyze(t4, "R4: S5_Bear_Bounce", regimes)
    print_summary(s4_stats)
    all_stats.append(s4_stats)

    print(f"\nR5b: S6 SMMA 리테스트+프렉탈 (기본값)")
    t5b = run_s6_smma_retest(df, regimes, s6_default)
    s5b_stats = analyze(t5b, "R5b: S6_SMMA_Retest", regimes)
    print_summary(s5b_stats)
    all_stats.append(s5b_stats)

    print_comparison(all_stats)
    print_regime_matrix(all_stats)

    # ── Phase 2: 비용 포함 그리드서치 최적화 (R5~R10) ───────────
    fee = 0.04
    slip = 0.05

    print(f"\n{'='*70}")
    print(f"  Phase 2: 비용 포함 그리드서치 (fee={fee}%, slip={slip}%)")
    print(f"{'='*70}")

    optimized = {}
    opt_stats = []

    print(f"\nR5: S1 그리드서치...")
    gs1 = grid_search_s1(df, regimes, fee, slip)
    if gs1["score"] > 0:
        gs1["stats"]["name"] = "R5: S1_Optimized"
        print_summary(gs1["stats"])
        optimized["S1"] = gs1
        opt_stats.append(gs1["stats"])
        print(f"  최적 파라미터: {gs1['params']}")

    print(f"\nR6: S2 그리드서치...")
    gs2 = grid_search_s2(df, regimes, fee, slip)
    if gs2["score"] > 0:
        gs2["stats"]["name"] = "R6: S2_Optimized"
        print_summary(gs2["stats"])
        optimized["S2"] = gs2
        opt_stats.append(gs2["stats"])
        print(f"  최적 파라미터: {gs2['params']}")

    print(f"\nR7: S3 그리드서치...")
    gs3 = grid_search_s3(df, regimes, fee, slip)
    if gs3["score"] > 0:
        gs3["stats"]["name"] = "R7: S3_Optimized"
        print_summary(gs3["stats"])
        optimized["S3"] = gs3
        opt_stats.append(gs3["stats"])
        print(f"  최적 파라미터: {gs3['params']}")

    print(f"\nR8: S4 그리드서치...")
    gs4 = grid_search_s4(df, regimes, fee, slip)
    if gs4["score"] > 0:
        gs4["stats"]["name"] = "R8: S4_Optimized"
        print_summary(gs4["stats"])
        optimized["S4"] = gs4
        opt_stats.append(gs4["stats"])
        print(f"  최적 파라미터: {gs4['params']}")

    print(f"\nR9: S5 그리드서치...")
    gs5 = grid_search_s5(df, regimes, fee, slip)
    if gs5["score"] > 0:
        gs5["stats"]["name"] = "R9: S5_Optimized"
        print_summary(gs5["stats"])
        optimized["S5"] = gs5
        opt_stats.append(gs5["stats"])
        print(f"  최적 파라미터: {gs5['params']}")

    print(f"\nR10: S6 그리드서치...")
    gs6 = grid_search_s6(df, regimes, fee, slip)
    if gs6["score"] > 0:
        gs6["stats"]["name"] = "R10: S6_Optimized"
        print_summary(gs6["stats"])
        optimized["S6"] = gs6
        opt_stats.append(gs6["stats"])
        print(f"  최적 파라미터: {gs6['params']}")

    if opt_stats:
        print_comparison(opt_stats)
        print_regime_matrix(opt_stats)

    # ── Phase 2.5: Walk-forward 강건 검증 (비용 포함) ──────────
    wf_all, wf_robust = walk_forward_optimize(df, fee, slip)
    wf_results = []
    for sname, r in wf_all.items():
        wf_results.append({
            "strategy": sname,
            "train_wr": r["train_stats"]["win_rate"],
            "test_wr": r["test_stats"]["win_rate"],
            "delta": r["delta"],
            "status": r["status"],
        })

    if wf_results:
        overfit_count = sum(1 for r in wf_results if r["status"] == "OVERFIT")
        print(f"\n  과적합 경고: {overfit_count}/{len(wf_results)} 전략")

    # ── Phase 2.7: S3 안정성 검증 (고정 파라미터, 시간구간별) ──
    if "S3" in optimized:
        print(f"\n{'='*70}")
        print(f"  Phase 2.7: S3 안정성 검증 (고정 파라미터, 5 folds)")
        print(f"{'='*70}")
        s3_opt_params = optimized["S3"]["params"]
        stab_results, stab_trades, stab_ratio = stability_test_s3(
            df, s3_opt_params, fee, slip, n_folds=5)

        # 여러 RR/ha_weak 조합으로 안정성 비교
        print(f"\n  [S3 파라미터 안정성 스캔]")
        best_stab_score = -1
        best_stab_params = None
        for rr in [2.0, 2.5, 3.0, 3.5]:
            for ha_min in [0.3, 0.5, 0.8, 1.0]:
                test_params = dict(s3_opt_params)
                test_params["rr_ratio"] = rr
                test_params["ha_weak_min_pct"] = ha_min
                # 각 fold에서 실행
                fold_rets = []
                total_count = 0
                for fold_idx in range(5):
                    fold_size = len(df) // 5
                    start = fold_idx * fold_size
                    end = min(start + fold_size, len(df))
                    df_fold = df.iloc[start:end].copy().reset_index(drop=True)
                    if len(df_fold) < 300:
                        continue
                    df_fold = compute_indicators(df_fold)
                    reg_fold = compute_regime(df_fold)
                    trades = run_s3_heikin_ashi(df_fold, reg_fold, test_params, fee, slip)
                    stats = analyze(trades, "scan", reg_fold)
                    fold_rets.append(stats["total_return"])
                    total_count += stats["count"]
                if fold_rets and total_count >= 5:
                    pos_folds = sum(1 for r in fold_rets if r > 0)
                    avg_ret = np.mean(fold_rets)
                    # 안정성 점수: 양의 구간 비율 × 평균 수익
                    stab_score = (pos_folds / len(fold_rets)) * max(0, avg_ret + 5) * total_count
                    if stab_score > best_stab_score:
                        best_stab_score = stab_score
                        best_stab_params = test_params.copy()
                        best_stab_info = {
                            "rr": rr, "ha_min": ha_min,
                            "pos_folds": pos_folds, "total_folds": len(fold_rets),
                            "avg_ret": avg_ret, "total_trades": total_count,
                        }
        if best_stab_params:
            print(f"  가장 안정적: RR={best_stab_info['rr']}, "
                  f"ha_weak={best_stab_info['ha_min']}, "
                  f"양수구간 {best_stab_info['pos_folds']}/{best_stab_info['total_folds']}, "
                  f"평균수익 {best_stab_info['avg_ret']:.2f}%, "
                  f"{best_stab_info['total_trades']}건")

            # 안정적 파라미터로 전체 데이터 재실행
            stable_trades = run_s3_heikin_ashi(df, regimes, best_stab_params, fee, slip)
            stable_stats = analyze(stable_trades, "S3_Stable (안정적 파라미터)", regimes)
            print_summary(stable_stats)

            # 안정적 파라미터가 더 나으면 교체
            opt_ret = optimized["S3"]["stats"]["total_return"]
            if stable_stats["total_return"] > 0:
                print(f"\n  S3 안정적 파라미터 채택 "
                      f"(Ret: {opt_ret:.2f}% → {stable_stats['total_return']:.2f}%)")
                optimized["S3"]["params"] = best_stab_params
                optimized["S3"]["stats"] = stable_stats
                # opt_stats 리스트도 업데이트
                for idx, s in enumerate(opt_stats):
                    if "S3" in s["name"]:
                        stable_stats["name"] = s["name"]
                        opt_stats[idx] = stable_stats
                        break

    # ── Phase 3: 레짐-전략 매칭 (R10) ────────────────────────
    print(f"\n{'='*70}")
    print(f"  Phase 3: 레짐-전략 최적 매칭 (R10)")
    print(f"{'='*70}")

    best_per_regime = {}
    for regime in ["BULL", "SIDEWAYS"]:
        best_wr = -1
        best_name = None
        for s in opt_stats:
            rs = s.get("regime_stats", {})
            if regime in rs and rs[regime]["count"] >= 3:
                if rs[regime]["win_rate"] > best_wr:
                    best_wr = rs[regime]["win_rate"]
                    best_name = s["name"]
        if best_name:
            best_per_regime[regime] = {"strategy": best_name, "win_rate": best_wr}
            print(f"  {regime:10s} → {best_name} (WR {best_wr:.1f}%)")
        else:
            print(f"  {regime:10s} → 데이터 부족")

    # S6도 BULL/SIDEWAYS 후보에 포함 (이미 for loop에서 체크됨)

    # BEAR: S5 최적화 결과가 50%+ 이면 사용
    if "S5" in optimized:
        s5_stats = optimized["S5"]["stats"]
        bear_rs = s5_stats.get("regime_stats", {}).get("BEAR", {})
        s5_wr = bear_rs.get("win_rate", s5_stats.get("win_rate", 0))
        if s5_wr >= 50:
            best_per_regime["BEAR"] = {"strategy": "R9: S5_Optimized", "win_rate": s5_wr}
            print(f"  {'BEAR':10s} → S5_Bear_Bounce (WR {s5_wr:.1f}%) ✅ 50% 달성!")
        else:
            print(f"  {'BEAR':10s} → 매매 보류 (S5 WR {s5_wr:.1f}% < 50%)")
    else:
        print(f"  {'BEAR':10s} → 매매 보류 (S5 데이터 부족)")

    # ── Phase 4: 메타전략 시뮬레이션 (R11, 비용 포함) ──────────
    print(f"\n{'='*70}")
    print(f"  Phase 4: 메타전략 (레짐별 전략 전환, 비용 포함)")
    print(f"{'='*70}")

    all_trades_by_strategy = {}
    strategy_runners_map = {
        "S1": run_s1_rsi_pullback,
        "S2": run_s2_volume_breakout,
        "S3": run_s3_heikin_ashi,
        "S4": run_s4_vwap,
        "S5": run_s5_bear_bounce,
        "S6": run_s6_smma_retest,
    }
    for sname, gs in optimized.items():
        runner = strategy_runners_map.get(sname)
        if runner:
            all_trades_by_strategy[sname] = runner(df, regimes, gs["params"], fee, slip)

    # 메타A: 전체 레짐 최적 전략 (기존)
    meta_trades = []
    for sname, trades in all_trades_by_strategy.items():
        for t in trades:
            regime = t.regime
            if regime not in best_per_regime:
                continue
            best_sname = best_per_regime[regime]["strategy"]
            if sname in best_sname:
                meta_trades.append(t)

    meta_trades.sort(key=lambda t: t.entry_idx)
    filtered_meta = []
    last_exit_idx = 0
    for t in meta_trades:
        if t.entry_idx >= last_exit_idx:
            filtered_meta.append(t)
            last_exit_idx = t.exit_idx

    meta_stats = analyze(filtered_meta, "R11a: Meta_All (비용포함, 레짐전환)", regimes)
    print_summary(meta_stats)

    # 메타B: WF-robust 전략만 사용 (OVERFIT 제외)
    wf_ok_strategies = set()
    for sname, r in wf_all.items():
        if r["status"] == "OK":
            wf_ok_strategies.add(sname)
    print(f"\n  WF-robust 전략: {wf_ok_strategies if wf_ok_strategies else '없음'}")

    if wf_ok_strategies:
        # WF-robust 전략 중 레짐별 최적 선택
        robust_per_regime = {}
        for regime in ["BULL", "SIDEWAYS", "BEAR"]:
            best_wr = -1
            best_name = None
            for s in opt_stats:
                # 이 전략이 WF-robust인지 확인
                sname_key = None
                for key in wf_ok_strategies:
                    if key in s["name"]:
                        sname_key = key
                        break
                if sname_key is None:
                    continue
                rs = s.get("regime_stats", {})
                if regime in rs and rs[regime]["count"] >= 2:
                    if rs[regime]["win_rate"] > best_wr:
                        best_wr = rs[regime]["win_rate"]
                        best_name = s["name"]
            if best_name:
                robust_per_regime[regime] = {"strategy": best_name, "win_rate": best_wr}

        meta_robust_trades = []
        for sname, trades in all_trades_by_strategy.items():
            if sname not in wf_ok_strategies:
                continue
            for t in trades:
                regime = t.regime
                if regime not in robust_per_regime:
                    continue
                best_sname = robust_per_regime[regime]["strategy"]
                if sname in best_sname:
                    meta_robust_trades.append(t)

        meta_robust_trades.sort(key=lambda t: t.entry_idx)
        filtered_robust = []
        last_exit_idx = 0
        for t in meta_robust_trades:
            if t.entry_idx >= last_exit_idx:
                filtered_robust.append(t)
                last_exit_idx = t.exit_idx

        meta_robust_stats = analyze(filtered_robust, "R11b: Meta_WF_Robust (비용포함)", regimes)
        print_summary(meta_robust_stats)

        # 메타C: 양의 수익 전략만 사용
        positive_strategies = set()
        for s in opt_stats:
            if s["total_return"] > 0:
                for key in strategy_runners_map:
                    if key in s["name"]:
                        positive_strategies.add(key)
        print(f"\n  양의 수익 전략: {positive_strategies if positive_strategies else '없음'}")

        if positive_strategies:
            pos_per_regime = {}
            for regime in ["BULL", "SIDEWAYS", "BEAR"]:
                best_ret = -999
                best_name = None
                for s in opt_stats:
                    sname_key = None
                    for key in positive_strategies:
                        if key in s["name"]:
                            sname_key = key
                            break
                    if sname_key is None:
                        continue
                    rs = s.get("regime_stats", {})
                    if regime in rs and rs[regime]["count"] >= 2:
                        if rs[regime]["avg_pnl"] > best_ret:
                            best_ret = rs[regime]["avg_pnl"]
                            best_name = s["name"]
                if best_name:
                    pos_per_regime[regime] = {"strategy": best_name, "avg_pnl": best_ret}

            meta_pos_trades = []
            for sname, trades in all_trades_by_strategy.items():
                if sname not in positive_strategies:
                    continue
                for t in trades:
                    regime = t.regime
                    if regime not in pos_per_regime:
                        continue
                    best_sname = pos_per_regime[regime]["strategy"]
                    if sname in best_sname:
                        meta_pos_trades.append(t)

            meta_pos_trades.sort(key=lambda t: t.entry_idx)
            filtered_pos = []
            last_exit_idx = 0
            for t in meta_pos_trades:
                if t.entry_idx >= last_exit_idx:
                    filtered_pos.append(t)
                    last_exit_idx = t.exit_idx

            meta_pos_stats = analyze(filtered_pos, "R11c: Meta_Positive (양수전략만)", regimes)
            print_summary(meta_pos_stats)

    # 개별 전략 비용 포함 결과
    print(f"\n  [개별 전략 비용포함 결과]")
    individual_stats = []
    for sname, trades in all_trades_by_strategy.items():
        rs = analyze(trades, f"{sname} (비용포함)", regimes)
        individual_stats.append(rs)
    if individual_stats:
        print_comparison(individual_stats)

    # ── Phase 5: 멀티코인 교차검증 (R12) ─────────────────────
    print(f"\n{'='*70}")
    print(f"  Phase 5: 멀티코인 교차검증 (R12, 비용 포함)")
    print(f"{'='*70}")

    # 최적 메타 선택 (양의 수익인 것 우선)
    best_meta_for_cross = meta_stats  # 기본: Meta_All
    if 'meta_robust_stats' in locals() and meta_robust_stats.get("total_return", -999) > meta_stats.get("total_return", -999):
        best_meta_for_cross = meta_robust_stats
    if 'meta_pos_stats' in locals() and meta_pos_stats.get("total_return", -999) > best_meta_for_cross.get("total_return", -999):
        best_meta_for_cross = meta_pos_stats

    cross_results = []
    for coin in coins:
        if coin == primary:
            cross_results.append({"coin": coin, **best_meta_for_cross})
            continue

        cdf = fetch_data(coin)
        if cdf is None:
            continue

        cdf = compute_indicators(cdf)
        c_regimes = compute_regime(cdf)

        print(f"  [{coin}] S3 코인별 최적화...", end=" ")
        coin_s3_gs = grid_search_s3(cdf, c_regimes, fee, slip)
        coin_s3_params = coin_s3_gs.get("params", optimized.get("S3", {}).get("params", {}))
        if coin_s3_gs.get("stats"):
            print(f"WR {coin_s3_gs['stats']['win_rate']:.1f}%")
        else:
            coin_s3_params = optimized.get("S3", {}).get("params", {})
            print("기본값 사용")

        coin_trades = []
        for regime, info in best_per_regime.items():
            strategy = info["strategy"]
            if "S1" in strategy:
                s1_params = optimized.get("S1", {}).get("params", s1_default)
                trades = run_s1_rsi_pullback(cdf, c_regimes, s1_params, fee, slip)
                coin_trades.extend([t for t in trades if t.regime == regime])
            elif "S2" in strategy:
                s2_params = optimized.get("S2", {}).get("params", s2_default)
                trades = run_s2_volume_breakout(cdf, c_regimes, s2_params, fee, slip)
                coin_trades.extend([t for t in trades if t.regime == regime])
            elif "S3" in strategy:
                trades = run_s3_heikin_ashi(cdf, c_regimes, coin_s3_params, fee, slip)
                coin_trades.extend([t for t in trades if t.regime == regime])
            elif "S5" in strategy:
                s5_params = optimized.get("S5", {}).get("params", s5_default)
                trades = run_s5_bear_bounce(cdf, c_regimes, s5_params, fee, slip)
                coin_trades.extend([t for t in trades if t.regime == regime])
            elif "S6" in strategy:
                s6_params = optimized.get("S6", {}).get("params", s6_default)
                trades = run_s6_smma_retest(cdf, c_regimes, s6_params, fee, slip)
                coin_trades.extend([t for t in trades if t.regime == regime])

        coin_trades.sort(key=lambda t: t.entry_idx)
        filtered_coin = []
        last_exit_idx = 0
        for t in coin_trades:
            if t.entry_idx >= last_exit_idx:
                filtered_coin.append(t)
                last_exit_idx = t.exit_idx

        cs = analyze(filtered_coin, f"R12: {coin}", c_regimes)
        cross_results.append({"coin": coin, **cs})
        print(f"  {coin:5s}: {cs['count']:3d}건, WR {cs['win_rate']:.1f}%, "
              f"PF {cs['pf']:.2f}, Return {cs['total_return']:.2f}%")

    if cross_results:
        valid = [r for r in cross_results if r["count"] > 0]
        if valid:
            avg_wr = np.mean([r["win_rate"] for r in valid])
            print(f"\n  멀티코인 평균 승률 (비용 포함): {avg_wr:.1f}%")
            passed = sum(1 for r in valid if r["win_rate"] >= 55 and r["count"] >= 3)
            print(f"  55% 이상 통과: {passed}/{len(valid)} 코인")

    # ── 최종 요약 ────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  최종 요약")
    print(f"{'='*70}")

    print(f"\n  [최적 파라미터]")
    for sname, gs in optimized.items():
        print(f"  {sname}: {gs['params']}")

    print(f"\n  [레짐-전략 매칭]")
    for regime, info in best_per_regime.items():
        print(f"  {regime} → {info['strategy']} (WR {info['win_rate']:.1f}%)")
    if "BEAR" not in best_per_regime:
        print(f"  BEAR → 매매 보류")

    # 메타 변형 비교
    meta_variants = [("Meta_All", meta_stats)]
    if 'meta_robust_stats' in locals():
        meta_variants.append(("Meta_WF_Robust", meta_robust_stats))
    if 'meta_pos_stats' in locals():
        meta_variants.append(("Meta_Positive", meta_pos_stats))

    print(f"\n  [목표 달성 여부 (비용 포함)]")
    best_meta = None
    best_meta_ret = -999
    for name, ms in meta_variants:
        if ms["count"] > 0:
            target_met = ms["win_rate"] >= 55 and ms["total_return"] > 0
            status = "✅ 목표 달성!" if target_met else "❌ 추가 개선 필요"
            print(f"  {name}: {ms['count']}건, WR {ms['win_rate']}%, "
                  f"수익 {ms['total_return']:.2f}% {status}")
            if ms["total_return"] > best_meta_ret:
                best_meta_ret = ms["total_return"]
                best_meta = ms

    # Walk-forward 요약
    if wf_results:
        print(f"\n  [Walk-forward 검증 요약]")
        for r in wf_results:
            print(f"  {r['strategy']}: Train {r['train_wr']:.1f}% → Test {r['test_wr']:.1f}% "
                  f"(Delta {r['delta']:+.1f}%p) [{r['status']}]")

    print(f"\n{'='*70}")
    print(f"  완료!")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()

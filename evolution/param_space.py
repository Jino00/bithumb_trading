# 전략별 파라미터 탐색 공간 정의 — 각 파라미터의 범위와 스텝을 지정한다.
"""
형식: { param_name: (default, min, max, step, type) }
- default: config.py 기본값
- min/max: 탐색 범위
- step: 섭동 단위
- type: int 또는 float
"""

STRATEGY_PARAM_SPACE: dict[str, dict[str, tuple]] = {
    "S1": {
        "rsi_low":     (25.0,  15.0, 40.0, 5.0,  float),
        "rsi_high":    (50.0,  40.0, 65.0, 5.0,  float),
        "sl_mult":     (1.5,   0.8,  3.0,  0.3,  float),
        "tp_mult":     (1.5,   1.0,  4.0,  0.5,  float),
        "min_atr_pct": (0.3,   0.0,  1.0,  0.1,  float),
    },
    "S2": {
        "explosion_mult": (2.5,  1.5,  4.0,  0.5, float),
        "dry_ratio":      (0.6,  0.3,  0.9,  0.1, float),
        "rr_ratio":       (2.5,  1.5,  4.0,  0.5, float),
        "box_lookback":   (15,   10,   30,   5,   int),
    },
    "S3": {
        "doji_body_ratio":  (0.05,  0.02, 0.20, 0.03, float),
        "flat_tol":         (0.002, 0.001, 0.005, 0.001, float),
        "rr_ratio":         (3.0,   1.5,  5.0,  0.5,  float),
        "min_bearish":      (3,     2,    6,    1,    int),
        "ha_weak_min_pct":  (1.0,   0.0,  2.0,  0.25, float),
        "min_atr_pct":      (0.3,   0.0,  1.0,  0.1,  float),
    },
    "S4": {
        "vwap_period":  (24,    12,   48,   6,    int),
        "band_mult":    (2.0,   1.0,  3.0,  0.5,  float),
        "rr_ratio":     (1.5,   1.0,  3.0,  0.5,  float),
        "pullback_tol": (0.003, 0.001, 0.01, 0.001, float),
    },
    "S5": {
        "rsi_threshold": (25.0,  15.0, 35.0, 5.0,  float),
        "vol_spike":     (1.5,   1.0,  3.0,  0.5,  float),
        "sl_pct":        (1.5,   0.5,  3.0,  0.5,  float),
        "tp_pct":        (2.0,   1.0,  4.0,  0.5,  float),
        "max_hold":      (10,    5,    20,   5,    int),
    },
    "S6": {
        "smma_short":  (21,    10,   30,   5,    int),
        "smma_mid":    (50,    30,   80,   10,   int),
        "rr_ratio":    (1.5,   1.0,  3.0,  0.5,  float),
        "tangle_tol":  (0.005, 0.002, 0.01, 0.002, float),
        "retest_tol":  (0.005, 0.002, 0.01, 0.002, float),
    },
}

# 전략 ID 목록 (라운드로빈용)
STRATEGY_IDS = list(STRATEGY_PARAM_SPACE.keys())

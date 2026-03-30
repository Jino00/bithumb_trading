"""변형 생성기 — 5가지 타입의 실험 변형을 자동 생성한다."""
import random
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Set, Tuple

import config
from evolution.param_space import STRATEGY_PARAM_SPACE


@dataclass
class ExplorationVariant:
    """탐색 슬롯에서 실행되는 실험 변형."""
    variant_id: str
    variant_type: str  # PARAM_MUTATION | STRATEGY_COMBO | NOVEL_FILTER | REGIME_OVERRIDE | TIME_RULE
    base_strategy: str  # S1-S6
    param_overrides: Dict = field(default_factory=dict)
    description: str = ""
    generation: int = 1
    # STRATEGY_COMBO 전용
    entry_strategy: str = ""
    exit_strategy: str = ""
    # NOVEL_FILTER 전용
    filter_name: str = ""
    filter_config: Dict = field(default_factory=dict)
    # REGIME_OVERRIDE 전용
    regime_rules: Dict = field(default_factory=dict)
    # TIME_RULE 전용
    active_hours: Optional[Set[int]] = None


# ── 카운터 (중복 ID 방지) ────────────────────────────────────
_variant_counter = 0


def _next_id(variant_type: str) -> str:
    """고유 변형 ID 생성."""
    global _variant_counter
    _variant_counter += 1
    short_type = variant_type[:4].lower()
    return f"EXP-{_variant_counter:03d}-{short_type}"


# ── 공통 ─────────────────────────────────────────────────────

_STRATEGIES = ["S1", "S2", "S3", "S4", "S5", "S6"]
_AVAILABLE_STRATEGIES = [s for s in _STRATEGIES if s in STRATEGY_PARAM_SPACE]


def _random_strategy() -> str:
    """랜덤 전략 선택."""
    return random.choice(_AVAILABLE_STRATEGIES)


def _get_param_range(strategy_id: str) -> Dict:
    """전략의 파라미터 범위 반환."""
    return STRATEGY_PARAM_SPACE.get(strategy_id, {})


# ── 타입 1: PARAM_MUTATION ────────────────────────────────────

def generate_param_mutation() -> ExplorationVariant:
    """기존 전략 파라미터를 ±20~50% 변형한다."""
    strategy = _random_strategy()
    space = _get_param_range(strategy)
    if not space:
        return generate_param_mutation()  # 다른 전략 시도

    overrides = {}
    # 1~3개 파라미터를 동시 변형
    n_params = random.randint(1, min(3, len(space)))
    chosen = random.sample(list(space.keys()), n_params)

    for param_name in chosen:
        default, lo, hi, step, ptype = space[param_name]
        # ±20~50% 변형 (evolution의 ±1 step보다 훨씬 공격적)
        mutation = random.uniform(-0.5, 0.5)
        new_val = default * (1 + mutation)
        new_val = max(lo, min(hi, new_val))
        if ptype == int:
            new_val = int(round(new_val))
        else:
            new_val = round(new_val, 4)
        overrides[param_name] = new_val

    desc_parts = [f"{k}={v}" for k, v in overrides.items()]
    return ExplorationVariant(
        variant_id=_next_id("PARAM_MUTATION"),
        variant_type="PARAM_MUTATION",
        base_strategy=strategy,
        param_overrides=overrides,
        description=f"{strategy} 파라미터 변형: {', '.join(desc_parts)}",
    )


# ── 타입 2: STRATEGY_COMBO ───────────────────────────────────

def generate_strategy_combo() -> ExplorationVariant:
    """전략 A의 진입 + 전략 B의 청산 로직을 조합한다."""
    entry = _random_strategy()
    exit_s = _random_strategy()
    # 같은 전략이면 다시 선택
    while exit_s == entry:
        exit_s = _random_strategy()

    return ExplorationVariant(
        variant_id=_next_id("STRATEGY_COMBO"),
        variant_type="STRATEGY_COMBO",
        base_strategy=entry,
        entry_strategy=entry,
        exit_strategy=exit_s,
        description=f"{entry} 진입 + {exit_s} 청산 조합",
    )


# ── 타입 3: NOVEL_FILTER ─────────────────────────────────────

_FILTER_PRESETS = [
    ("macd_positive", {"name": "MACD 양전 필터", "check": "macd_hist > 0"}),
    ("volume_weighted_rsi", {"name": "거래량 가중 RSI", "vw_threshold": 40}),
    ("atr_percentile", {"name": "ATR 상위 30%", "percentile": 70}),
    ("bb_squeeze", {"name": "볼린저 스퀴즈", "bandwidth_pct": 20}),
    ("ema_alignment", {"name": "EMA 정배열", "periods": [10, 20, 50]}),
    ("rsi_divergence", {"name": "RSI 다이버전스", "lookback": 14}),
]


def generate_novel_filter() -> ExplorationVariant:
    """기존 전략에 새로운 진입 필터를 추가한다."""
    strategy = _random_strategy()
    filter_name, filter_cfg = random.choice(_FILTER_PRESETS)

    return ExplorationVariant(
        variant_id=_next_id("NOVEL_FILTER"),
        variant_type="NOVEL_FILTER",
        base_strategy=strategy,
        filter_name=filter_name,
        filter_config=dict(filter_cfg),
        description=f"{strategy} + {filter_cfg['name']}",
    )


# ── 타입 4: REGIME_OVERRIDE ──────────────────────────────────

def generate_regime_override() -> ExplorationVariant:
    """레짐별로 다른 파라미터를 적용한다."""
    strategy = _random_strategy()
    space = _get_param_range(strategy)
    if not space:
        return generate_regime_override()

    rules = {}
    for regime in ["BULL", "SIDEWAYS", "BEAR"]:
        # 레짐마다 1~2개 파라미터를 다르게 설정
        param_name = random.choice(list(space.keys()))
        default, lo, hi, step, ptype = space[param_name]
        if regime == "BULL":
            val = default * random.uniform(1.1, 1.5)
        elif regime == "BEAR":
            val = default * random.uniform(0.5, 0.9)
        else:
            val = default * random.uniform(0.8, 1.2)
        val = max(lo, min(hi, val))
        if ptype == int:
            val = int(round(val))
        else:
            val = round(val, 4)
        rules[regime] = {param_name: val}

    return ExplorationVariant(
        variant_id=_next_id("REGIME_OVERRIDE"),
        variant_type="REGIME_OVERRIDE",
        base_strategy=strategy,
        regime_rules=rules,
        description=f"{strategy} 레짐별 파라미터 분기",
    )


# ── 타입 5: TIME_RULE ────────────────────────────────────────

_SESSION_PRESETS = {
    "asia_morning": (set(range(0, 9)), "아시아 오전 (0~8시)"),
    "asia_afternoon": (set(range(9, 16)), "아시아 오후 (9~15시)"),
    "europe": (set(range(16, 24)), "유럽 세션 (16~23시)"),
    "night": (set(range(0, 7)), "야간 (0~6시)"),
    "peak": ({9, 10, 11, 20, 21, 22}, "피크 시간 (9~11, 20~22시)"),
    "off_peak": (set(range(0, 24)) - {9, 10, 11, 20, 21, 22}, "비피크"),
}


def generate_time_rule() -> ExplorationVariant:
    """특정 시간대에만 거래하는 변형."""
    strategy = _random_strategy()
    session_key = random.choice(list(_SESSION_PRESETS.keys()))
    hours, session_name = _SESSION_PRESETS[session_key]

    return ExplorationVariant(
        variant_id=_next_id("TIME_RULE"),
        variant_type="TIME_RULE",
        base_strategy=strategy,
        active_hours=hours,
        description=f"{strategy} {session_name} 전용",
    )


# ── 통합 생성기 ──────────────────────────────────────────────

_GENERATORS = {
    "PARAM_MUTATION": generate_param_mutation,
    "STRATEGY_COMBO": generate_strategy_combo,
    "NOVEL_FILTER": generate_novel_filter,
    "REGIME_OVERRIDE": generate_regime_override,
    "TIME_RULE": generate_time_rule,
}


def generate_diverse_variants(
    n: int = config.EXPLORATION_SLOT_COUNT,
    type_distribution: Optional[Dict[str, int]] = None,
) -> List[ExplorationVariant]:
    """다양한 타입의 변형 n개를 생성한다.

    ★ 학습 기반 분배: NOVEL_FILTER가 수익(+159만)이므로 절반 배정.
    REGIME_OVERRIDE는 최악(-1,409만)이므로 2개만.
    """
    if type_distribution is None:
        # 학습된 최적 분배 (탐색 성과 기반)
        type_distribution = {
            "NOVEL_FILTER": 12,      # 수익 유일 타입 → 절반
            "PARAM_MUTATION": 6,     # 중간
            "STRATEGY_COMBO": 6,     # 중간
            "TIME_RULE": 4,          # 소수
            "REGIME_OVERRIDE": 2,    # 최악 성과 → 최소
        }
        # n에 맞게 조정
        total = sum(type_distribution.values())
        if total != n:
            type_distribution["NOVEL_FILTER"] += (n - total)

    variants = []
    for vtype, count in type_distribution.items():
        gen_fn = _GENERATORS[vtype]
        for _ in range(count):
            variants.append(gen_fn())

    return variants[:n]

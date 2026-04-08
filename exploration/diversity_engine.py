"""다양성 엔진 — 30개 탐색 슬롯이 동일 전략으로 수렴하는 것을 방지한다."""
import math
from collections import Counter
from typing import Dict, List, Optional

import config
from exploration.variant_generator import ExplorationVariant


class DiversityEngine:
    """변형 풀의 다양성을 검증하고 중복을 거부한다."""

    def __init__(
        self,
        max_same_strategy: int = config.EXPLORATION_MAX_SAME_STRATEGY,
        min_param_distance: float = 0.3,
    ) -> None:
        self._max_same_strategy = max_same_strategy
        self._min_param_distance = min_param_distance

    def is_diverse_enough(
        self, new: ExplorationVariant,
        existing: List[ExplorationVariant],
    ) -> bool:
        """새 변형이 기존 풀과 충분히 다른지 확인."""
        if not existing:
            return True
        if not self._check_strategy_limit(new, existing):
            return False
        if new.variant_type == "PARAM_MUTATION":
            return self._check_param_distance(new, existing)
        if new.variant_type == "STRATEGY_COMBO":
            return self._check_combo_unique(new, existing)
        return True

    def _check_strategy_limit(
        self, new: ExplorationVariant,
        existing: List[ExplorationVariant],
    ) -> bool:
        """동일 기본 전략 상한 확인."""
        count = sum(
            1 for v in existing
            if v.base_strategy == new.base_strategy
        )
        return count < self._max_same_strategy

    def _check_param_distance(
        self, new: ExplorationVariant,
        existing: List[ExplorationVariant],
    ) -> bool:
        """파라미터 변형 간 유클리드 거리 확인."""
        same_type = [
            v for v in existing
            if v.variant_type == "PARAM_MUTATION"
            and v.base_strategy == new.base_strategy
        ]
        for v in same_type:
            dist = self._normalized_distance(
                new.param_overrides, v.param_overrides
            )
            if dist < self._min_param_distance:
                return False
        return True

    def _check_combo_unique(
        self, new: ExplorationVariant,
        existing: List[ExplorationVariant],
    ) -> bool:
        """동일 진입+청산 조합 중복 방지."""
        combo = (new.entry_strategy, new.exit_strategy)
        for v in existing:
            if v.variant_type == "STRATEGY_COMBO":
                if (v.entry_strategy, v.exit_strategy) == combo:
                    return False
        return True

    def _normalized_distance(
        self, a: Dict, b: Dict,
    ) -> float:
        """두 파라미터 세트의 정규화 유클리드 거리."""
        all_keys = set(a.keys()) | set(b.keys())
        if not all_keys:
            return 0.0
        sq_sum = 0.0
        for k in all_keys:
            va = float(a.get(k, 0))
            vb = float(b.get(k, 0))
            denom = max(abs(va), abs(vb), 1e-8)
            sq_sum += ((va - vb) / denom) ** 2
        return math.sqrt(sq_sum / len(all_keys))

    def get_type_distribution(
        self, existing: List[ExplorationVariant],
    ) -> Dict[str, int]:
        """현재 타입 분포 반환."""
        return dict(Counter(v.variant_type for v in existing))

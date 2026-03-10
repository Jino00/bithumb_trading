# 섭동 기반 이웃 파라미터 생성기 — 현재 최적값 주변 후보를 만든다.
import random
from typing import Any


def generate_neighbors(
    base_params: dict[str, Any],
    param_space: dict[str, tuple],
    n_candidates: int = 12,
) -> list[dict[str, Any]]:
    """
    현재 파라미터에서 ±1스텝 섭동으로 이웃 후보를 생성한다.

    생성 방식:
      1) 단일 파라미터 ±step (각 파라미터 2개씩)
      2) 2파라미터 동시 랜덤 변경 (나머지 채움)

    Args:
        base_params: 현재 파라미터 dict
        param_space: {param: (default, min, max, step, type)} 탐색 공간
        n_candidates: 생성할 후보 수

    Returns:
        이웃 파라미터 dict 리스트 (중복 제거됨)
    """
    neighbors: list[dict[str, Any]] = []
    param_names = [p for p in param_space if p in base_params]

    # ── 1단계: 단일 파라미터 ±step ──────────────────────────
    for name in param_names:
        _default, lo, hi, step, ptype = param_space[name]
        current = base_params.get(name, _default)

        # +step
        up_val = min(hi, current + step)
        if abs(up_val - current) > 1e-9:
            candidate = dict(base_params)
            candidate[name] = ptype(round(up_val, 6))
            neighbors.append(candidate)

        # -step
        down_val = max(lo, current - step)
        if abs(down_val - current) > 1e-9:
            candidate = dict(base_params)
            candidate[name] = ptype(round(down_val, 6))
            neighbors.append(candidate)

    # ── 2단계: 2파라미터 동시 랜덤 섭동 ──────────────────────
    remaining = max(0, n_candidates - len(neighbors))
    for _ in range(remaining):
        candidate = dict(base_params)
        chosen = random.sample(param_names, min(2, len(param_names)))
        for name in chosen:
            _default, lo, hi, step, ptype = param_space[name]
            current = base_params.get(name, _default)
            direction = random.choice([-1, 1])
            new_val = current + direction * step
            new_val = max(lo, min(hi, new_val))
            candidate[name] = ptype(round(new_val, 6))
        neighbors.append(candidate)

    # 중복 제거 (dict → frozenset → 비교)
    seen: set[frozenset] = set()
    unique: list[dict[str, Any]] = []
    for n in neighbors:
        key = frozenset(n.items())
        if key not in seen:
            seen.add(key)
            unique.append(n)

    return unique[:n_candidates]

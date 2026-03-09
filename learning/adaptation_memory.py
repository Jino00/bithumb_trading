# 적응 장기 기억 — "뭐가 효과적이었나"를 기억해 반복 실패를 방지한다.
"""
역할:
  - 효과성 추적 결과를 장기 기억으로 축적
  - 규칙 평가 후 "이전에 3번 시도해서 3번 다 실패"한 적응을 스킵
  - 효과적이었던 적응 목록을 조회

통합 지점:
  - AdaptiveEngine.run_adaptation_cycle() 내에서:
    1. evaluate_all_rules() 후 → filter_by_memory()로 실패 이력 제거
    2. effectiveness_tracker.evaluate_pending() 후 → record_outcomes()로 결과 저장
"""
import json
import logging
from typing import Any, Dict, List, Optional

from learning.learning_log import LearningLog

logger = logging.getLogger(__name__)


class AdaptationMemory:
    """장기 기억 — LearningLog의 adaptation_memory 테이블을 래핑한다."""

    def __init__(self, learning_log: LearningLog) -> None:
        self.learning_log = learning_log

    def record_outcome(
        self,
        coin: Optional[str],
        adaptation_type: str,
        parameter_key: str,
        value: Any,
        delta_win_rate: float,
    ) -> None:
        """효과성 추적 결과를 장기 기억에 기록한다."""
        value_json = json.dumps(value, ensure_ascii=False, default=str)
        self.learning_log.save_memory(
            coin=coin,
            adaptation_type=adaptation_type,
            parameter_key=parameter_key,
            value_json=value_json,
            effectiveness_score=delta_win_rate,
        )
        label = "효과적" if delta_win_rate > 0 else "비효과적"
        logger.info(
            f"[Memory] 기록: {adaptation_type}/{parameter_key} "
            f"Δ승률={delta_win_rate:+.1f}%p ({label})"
        )

    def record_outcomes_from_evaluation(
        self,
        coin: Optional[str],
        evaluation_results: List[Dict[str, Any]],
        adaptations: List[Dict[str, Any]],
    ) -> None:
        """효과성 평가 결과 전체를 장기 기억에 일괄 기록한다."""
        # adaptation_id → adaptation 매핑
        adapt_map = {a["id"]: a for a in adaptations}

        for result in evaluation_results:
            aid = result["adaptation_id"]
            adapt = adapt_map.get(aid)
            if not adapt:
                continue

            a_type = adapt.get("adaptation_type", "UNKNOWN")
            # parameter_key: 적응 유형에 따라 핵심 파라미터 추출
            param_key = self._extract_parameter_key(a_type, adapt)

            after_value = adapt.get("after_value", "{}")
            try:
                value = json.loads(after_value) if isinstance(after_value, str) else after_value
            except (json.JSONDecodeError, TypeError):
                value = after_value

            self.record_outcome(
                coin=coin,
                adaptation_type=a_type,
                parameter_key=param_key,
                value=value,
                delta_win_rate=result["delta_win_rate"],
            )

    def filter_proposals(
        self,
        coin: Optional[str],
        proposals: list,
        min_success_rate: float = 0.3,
    ) -> list:
        """장기 기억 기반으로 실패 이력이 높은 제안을 필터링한다."""
        filtered = []
        for proposal in proposals:
            param_key = self._extract_parameter_key(
                proposal.adaptation_type,
                {"after_value": json.dumps(proposal.after_value)},
            )
            if self.learning_log.should_try_adaptation(
                coin=coin,
                adaptation_type=proposal.adaptation_type,
                parameter_key=param_key,
                min_success_rate=min_success_rate,
            ):
                filtered.append(proposal)
            else:
                logger.info(
                    f"[Memory] 스킵: {proposal.adaptation_type}/{param_key} "
                    f"— 과거 성공률 < {min_success_rate:.0%}"
                )
        skipped = len(proposals) - len(filtered)
        if skipped > 0:
            logger.info(f"[Memory] 장기 기억 필터링: {skipped}건 제거")
        return filtered

    def get_effective_history(
        self, coin: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """효과적이었던 적응 기억 목록을 반환한다."""
        return self.learning_log.get_effective_adaptations(coin)

    @staticmethod
    def _extract_parameter_key(
        adaptation_type: str, adaptation: Dict[str, Any]
    ) -> str:
        """적응 유형별 핵심 파라미터 키를 추출한다."""
        key_map = {
            "PARAM_TUNE": "rsi_params",
            "TIME_FILTER": "blocked_hours",
            "TREND_FILTER": "block_downtrend",
            "POSITION_SIZE": "multiplier",
            "EXIT_STRATEGY": "sl_tp",
            "RSI_TUNE": "rsi_oversold",
        }
        return key_map.get(adaptation_type, adaptation_type.lower())

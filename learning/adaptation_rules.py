# 적응 규칙 모듈 — 분석 결과를 받아 적응 제안을 생성하는 순수 함수들.
"""
규칙 우선순위:
  1. PARAM_TUNE   — 그리드서치 최적 파라미터 적용 (가장 안전, 게이트 필수)
  2. TIME_FILTER  — 저성과 시간대 매수 차단
  3. TREND_FILTER — 하락 추세 매수 차단
  4. POSITION_SIZE — 변동성/연속손실 기반 포지션 크기 조정

모든 규칙 함수는 순수 함수다 — 분석 데이터를 받아 제안만 반환하고 사이드이펙트 없음.
"""
import logging
from dataclasses import dataclass
from typing import List, Optional, Set

import config
from analyzer.analyzer import AnalysisReport
from strategy.rsi_strategy import RSIStrategy
from strategy.strategy_gate import BacktestResult

logger = logging.getLogger(__name__)


@dataclass
class AdaptationProposal:
    """적응 제안 — AdaptiveEngine이 검증 후 적용 여부를 결정한다."""
    adaptation_type: str      # PARAM_TUNE | TIME_FILTER | TREND_FILTER | POSITION_SIZE
    trigger_reason: str       # 자연어 설명
    before_value: dict        # 변경 전
    after_value: dict         # 변경 후
    priority: int             # 1(최고) ~ 4(최저)
    requires_gate: bool       # True면 백테스트 + 게이트 검증 필요


def rule_param_tune(
    best_params: dict,
    best_result: BacktestResult,
    current_strategy: RSIStrategy,
) -> Optional[AdaptationProposal]:
    """
    규칙 1: 그리드서치 최적 파라미터가 현재와 다르면 적응 제안.

    조건: best_params != current_params
    행동: strategy.period/oversold/overbought 변경
    안전: StrategyGate 4조건 통과 필수
    """
    if not best_params:
        return None

    current = {
        "period": current_strategy.period,
        "oversold": current_strategy.oversold,
        "overbought": current_strategy.overbought,
    }

    new = {
        "period": best_params.get("period", current["period"]),
        "oversold": best_params.get("oversold", current["oversold"]),
        "overbought": best_params.get("overbought", current["overbought"]),
    }

    # 파라미터 동일하면 제안 없음
    if current == new:
        logger.debug("[Rule:PARAM_TUNE] 파라미터 변경 없음 — 스킵")
        return None

    changes = []
    for k in ("period", "oversold", "overbought"):
        if current[k] != new[k]:
            changes.append(f"{k}: {current[k]}→{new[k]}")

    return AdaptationProposal(
        adaptation_type="PARAM_TUNE",
        trigger_reason=(
            f"그리드서치 최적 파라미터 변경 ({', '.join(changes)}) | "
            f"백테스트 승률={best_result.win_rate:.1f}% PF={best_result.profit_factor:.2f}"
        ),
        before_value=current,
        after_value=new,
        priority=1,
        requires_gate=True,
    )


def rule_time_filter(report: AnalysisReport) -> Optional[AdaptationProposal]:
    """
    규칙 2: 특정 시간대의 승률이 기준 미만이면 해당 시간대 매수 차단.

    조건: by_hour[h].win_rate < ADAPTIVE_BAD_HOUR_WIN_RATE AND total >= ANALYSIS_MIN_SAMPLE
    행동: blocked_hours 집합에 해당 시간 추가
    """
    if not report.by_hour:
        return None

    bad_hours: Set[int] = set()
    threshold = config.ADAPTIVE_BAD_HOUR_WIN_RATE
    min_sample = config.ANALYSIS_MIN_SAMPLE

    for h, stat in report.by_hour.items():
        if stat["total"] >= min_sample and stat["win_rate"] < threshold:
            bad_hours.add(h)

    if not bad_hours:
        return None

    hour_details = {
        h: f"{report.by_hour[h]['win_rate']:.0f}% ({report.by_hour[h]['total']}건)"
        for h in sorted(bad_hours)
    }

    return AdaptationProposal(
        adaptation_type="TIME_FILTER",
        trigger_reason=(
            f"저성과 시간대 감지: {sorted(bad_hours)}시 "
            f"(승률 < {threshold}%)"
        ),
        before_value={"blocked_hours": []},
        after_value={"blocked_hours": sorted(bad_hours), "detail": hour_details},
        priority=2,
        requires_gate=False,
    )


def rule_trend_filter(report: AnalysisReport) -> Optional[AdaptationProposal]:
    """
    규칙 3: 하락 추세 진입 승률이 기준 미만이면 DOWNTREND 매수 차단.

    조건: by_trend["DOWNTREND"].win_rate < ADAPTIVE_DOWNTREND_WIN_RATE AND total >= ANALYSIS_MIN_SAMPLE
    행동: block_downtrend_buy = True
    """
    if not report.by_trend:
        return None

    dt_stat = report.by_trend.get("DOWNTREND")
    if dt_stat is None:
        return None

    threshold = config.ADAPTIVE_DOWNTREND_WIN_RATE
    min_sample = config.ANALYSIS_MIN_SAMPLE

    if dt_stat["total"] < min_sample:
        return None

    if dt_stat["win_rate"] >= threshold:
        return None

    return AdaptationProposal(
        adaptation_type="TREND_FILTER",
        trigger_reason=(
            f"하락 추세 진입 승률 {dt_stat['win_rate']:.1f}% "
            f"({dt_stat['total']}건) < {threshold}% — 매수 차단"
        ),
        before_value={"block_downtrend_buy": False},
        after_value={"block_downtrend_buy": True},
        priority=3,
        requires_gate=False,
    )


def rule_position_size(report: AnalysisReport) -> Optional[AdaptationProposal]:
    """
    규칙 4: 조건에 따라 포지션 크기 배율을 조정한다.

    4a: 고변동성 저성과 → 0.5배
    4b: 연속 손실 5회+ → 현재의 0.5배 (최소 0.3배)
    4c: 승률 80%+ (20건+) → 현재의 1.2배 (최대 1.5배)
    기본: 조건 없으면 1.0배로 복귀
    """
    min_sample = config.ANALYSIS_MIN_SAMPLE
    new_mult = 1.0
    reasons: List[str] = []

    # 4a: 고변동성 저성과 → 0.5배
    high_vol = report.by_volatility.get("HIGH")
    if (high_vol
            and high_vol["total"] >= min_sample
            and high_vol["win_rate"] < config.ADAPTIVE_HIGH_VOL_WIN_RATE):
        new_mult = 0.5
        reasons.append(
            f"고변동성 승률 {high_vol['win_rate']:.1f}% "
            f"< {config.ADAPTIVE_HIGH_VOL_WIN_RATE}%"
        )

    # 4b: 연속 손실 → 추가 축소
    if report.max_consecutive_losses >= config.ADAPTIVE_CONSEC_LOSS_THRESHOLD:
        new_mult = max(new_mult * 0.5, config.ADAPTIVE_POSITION_MIN_MULT)
        reasons.append(
            f"연속 손실 {report.max_consecutive_losses}회 "
            f"≥ {config.ADAPTIVE_CONSEC_LOSS_THRESHOLD}"
        )

    # 4c: 호성과 → 확대 (축소 조건이 없을 때만)
    if (not reasons
            and report.total_trades >= 20
            and report.win_rate >= 80.0):
        new_mult = min(1.2, config.ADAPTIVE_POSITION_MAX_MULT)
        reasons.append(f"호성과 승률 {report.win_rate:.1f}% (≥80%)")

    # 바운드 적용
    new_mult = max(config.ADAPTIVE_POSITION_MIN_MULT,
                   min(config.ADAPTIVE_POSITION_MAX_MULT, new_mult))

    # 변경 없으면 (1.0 유지) 제안 없음
    if abs(new_mult - 1.0) < 0.01 and not reasons:
        return None

    return AdaptationProposal(
        adaptation_type="POSITION_SIZE",
        trigger_reason=" + ".join(reasons) if reasons else "기본 배율 복귀",
        before_value={"multiplier": 1.0},
        after_value={"multiplier": round(new_mult, 2)},
        priority=4,
        requires_gate=False,
    )


def evaluate_all_rules(
    report: AnalysisReport,
    current_strategy: RSIStrategy,
    best_params: Optional[dict] = None,
    best_result: Optional[BacktestResult] = None,
) -> List[AdaptationProposal]:
    """
    모든 규칙을 평가하고 우선순위순으로 정렬된 제안 목록을 반환한다.

    Args:
        report: TradeAnalyzer.analyze() 결과
        current_strategy: 현재 실행 중인 전략
        best_params: 그리드서치 최적 파라미터 (없으면 PARAM_TUNE 스킵)
        best_result: 그리드서치 최적 백테스트 결과

    Returns:
        우선순위순 AdaptationProposal 리스트
    """
    proposals: List[AdaptationProposal] = []

    # Rule 1: PARAM_TUNE
    if best_params and best_result:
        p = rule_param_tune(best_params, best_result, current_strategy)
        if p:
            proposals.append(p)

    # Rule 2: TIME_FILTER
    p = rule_time_filter(report)
    if p:
        proposals.append(p)

    # Rule 3: TREND_FILTER
    p = rule_trend_filter(report)
    if p:
        proposals.append(p)

    # Rule 4: POSITION_SIZE
    p = rule_position_size(report)
    if p:
        proposals.append(p)

    # 우선순위순 정렬
    proposals.sort(key=lambda x: x.priority)

    logger.info(f"[Rules] {len(proposals)}건 적응 제안 생성")
    for prop in proposals:
        logger.debug(f"  [{prop.adaptation_type}] {prop.trigger_reason}")

    return proposals

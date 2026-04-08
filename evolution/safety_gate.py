# 진화 안전 검증 게이트 — 후보 파라미터가 실전 적용 가능한지 3단계로 검증한다.
import logging
from typing import Callable

import numpy as np
import pandas as pd

import config
from backtest_scalp import (
    analyze,
    compute_indicators,
    compute_regime,
    walk_forward_split,
)
from monitor.strategy_evaluator import robust_score

logger = logging.getLogger(__name__)


class EvolutionSafetyGate:
    """후보 파라미터의 안전성을 3단계로 검증한다."""

    def __init__(
        self,
        min_improvement_pct: float = config.EVOLUTION_MIN_IMPROVEMENT_PCT,
        min_trades: int = config.EVOLUTION_MIN_TRADES,
        max_mdd_pct: float = config.EVOLUTION_MAX_MDD_PCT,
        min_pf: float = config.EVOLUTION_MIN_PF,
        wf_ratio: float = config.EVOLUTION_WALK_FORWARD_RATIO,
        oos_ratio: float = config.EVOLUTION_OOS_RATIO,
        fee_pct: float = config.BACKTEST_FEE_PCT,
        slippage_pct: float = config.BACKTEST_SLIPPAGE_PCT,
    ) -> None:
        self._min_improvement = min_improvement_pct / 100.0
        self._min_trades = min_trades
        self._max_mdd = max_mdd_pct
        self._min_pf = min_pf
        self._wf_ratio = wf_ratio
        self._oos_ratio = oos_ratio
        self._fee = fee_pct
        self._slip = slippage_pct

    def validate(
        self,
        strategy_id: str,
        candidate_params: dict,
        runner_fn: Callable,
        df: pd.DataFrame,
        regimes: np.ndarray,
        baseline_score: float,
    ) -> tuple[bool, str, float]:
        """
        후보 파라미터를 3단계로 검증한다.

        Args:
            strategy_id: 전략 ID (S1~S6)
            candidate_params: 후보 파라미터 dict
            runner_fn: 전략 백테스트 함수
            df: OHLCV + 지표 DataFrame
            regimes: 레짐 배열
            baseline_score: 기준 robust_score

        Returns:
            (통과여부, 사유, 후보_score)
        """
        # ── Layer 1: 전체 데이터 백테스트 + 최소 개선폭 ──────
        try:
            trades = runner_fn(df, regimes, candidate_params,
                               self._fee, self._slip)
        except Exception as e:
            return False, f"백테스트 실패: {e}", -1.0

        if not trades:
            return False, "거래 없음", -1.0

        stats = analyze(trades, strategy_id, regimes)
        score = robust_score(stats, self._min_trades)

        threshold = baseline_score * (1 + self._min_improvement)
        if score <= threshold:
            return (False,
                    f"개선 부족: {score:.1f} ≤ {threshold:.1f} "
                    f"(baseline {baseline_score:.1f})",
                    score)

        # ── Layer 2: 절대 성과 기준 ──────────────────────────
        if stats["count"] < self._min_trades:
            return False, f"거래 부족: {stats['count']} < {self._min_trades}", score

        if stats["mdd"] > self._max_mdd:
            return False, f"MDD 초과: {stats['mdd']:.1f}% > {self._max_mdd}%", score

        if stats["pf"] < self._min_pf:
            return False, f"PF 부족: {stats['pf']:.2f} < {self._min_pf}", score

        # ── Layer 3: Walk-Forward 검증 ──────────────────────
        try:
            passed, reason = self._walk_forward_check(
                strategy_id, candidate_params, runner_fn, df, score
            )
            if not passed:
                return False, reason, score
        except Exception as e:
            return False, f"Walk-Forward 실패: {e}", score

        return True, "모든 안전 검증 통과", score

    def _walk_forward_check(
        self,
        strategy_id: str,
        params: dict,
        runner_fn: Callable,
        df: pd.DataFrame,
        in_sample_score: float,
    ) -> tuple[bool, str]:
        """70/30 시계열 분할 후 검증 구간에서도 성과가 유지되는지 확인."""
        _train_df, test_df = walk_forward_split(df, self._wf_ratio)

        if len(test_df) < 200:
            # 검증 데이터 부족 → 패스 (Layer 1~2만 적용)
            return True, "OOS 데이터 부족 (< 200봉), 스킵"

        test_df = compute_indicators(test_df)
        test_regimes = compute_regime(test_df)

        try:
            test_trades = runner_fn(test_df, test_regimes, params,
                                    self._fee, self._slip)
        except Exception as e:
            return False, f"OOS 백테스트 오류: {e}"

        if not test_trades:
            return False, "OOS 구간 거래 없음"

        test_stats = analyze(test_trades, strategy_id, test_regimes)
        test_score = robust_score(test_stats)

        min_required = in_sample_score * self._oos_ratio
        if test_score < min_required:
            return (False,
                    f"OOS 점수 부족: {test_score:.1f} < "
                    f"{min_required:.1f} (IS {in_sample_score:.1f} × "
                    f"{self._oos_ratio})")

        return True, f"OOS 통과: {test_score:.1f} ≥ {min_required:.1f}"

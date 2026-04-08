"""6전략을 백테스트 기반으로 평가하고 최적 전략을 선택한다."""
import json
import logging
import sqlite3
import sys
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

import config

_evaluator_logger = logging.getLogger(__name__)
from backtest_scalp import (
    Trade,
    analyze,
    compute_indicators,
    compute_regime,
    run_s1_rsi_pullback,
    run_s2_volume_breakout,
    run_s3_heikin_ashi,
    run_s4_vwap,
    run_s5_bear_bounce,
    run_s6_smma_retest,
)
from strategy.smc_strategy import run_s7_smc


def robust_score(stats: dict, min_trades: int = 5) -> float:
    """비용 포함 시 양의 수익을 최우선으로 하는 스코어링."""
    if stats["count"] < min_trades:
        return -1
    wr = stats["win_rate"]
    pf = min(stats["pf"], 5)
    mdd = stats["mdd"]
    count = stats["count"]
    total_ret = stats["total_return"]
    avg_pnl = stats.get("avg_pnl", 0)
    ret_score = total_ret * 2.0 if total_ret > 0 else total_ret * 3.0
    pnl_bonus = max(0, avg_pnl) * 5.0
    score = (
        wr * 0.20
        + pf * 10 * 0.20
        + max(0, 30 - mdd) * 0.10
        + ret_score * 0.35
        + pnl_bonus * 0.15
    )
    if count >= 20:
        score *= 1.1
    elif count < 8:
        score *= 0.7
    return score


@dataclass
class StrategyScore:
    """개별 전략의 평가 결과."""
    name: str
    strategy_id: str
    score: float
    stats: dict
    params: dict
    trades_count: int = 0


@dataclass
class EvaluationResult:
    """전체 전략 평가 결과."""
    scores: list = field(default_factory=list)
    best: Optional[StrategyScore] = None
    current_regime: str = ""
    evaluation_candles: int = 0


# ── 전략 ID → 실행 함수 매핑 ──────────────────────────────────
_RUNNERS = {
    "S1": ("S1_RSI_Pullback", run_s1_rsi_pullback),
    "S2": ("S2_Volume_Breakout", run_s2_volume_breakout),
    "S3": ("S3_HeikinAshi", run_s3_heikin_ashi),
    "S4": ("S4_VWAP", run_s4_vwap),
    "S5": ("S5_BearBounce", run_s5_bear_bounce),
    "S6": ("S6_SMMA_Retest", run_s6_smma_retest),
    "S7": ("S7_SMC", run_s7_smc),
}


def _get_config_defaults(strategy_id: str) -> dict:
    """config.py에서 전략별 기본 파라미터를 읽어 dict로 반환한다."""
    if strategy_id == "S1":
        return {
            "rsi_low": config.SCALP_RSI_PULLBACK_LOW,
            "rsi_high": config.SCALP_RSI_PULLBACK_HIGH,
            "sl_mult": config.SCALP_ATR_SL_MULT,
            "tp_mult": config.SCALP_ATR_TP_MULT,
            "use_breakeven": False,
            "min_atr_pct": 0.3,
        }
    if strategy_id == "S2":
        return {
            "explosion_mult": config.SCALP_VOL_EXPLOSION_MULT,
            "dry_ratio": config.SCALP_VOL_DRY_RATIO,
            "rr_ratio": config.SCALP_VOL_RR_RATIO,
            "box_lookback": config.SCALP_VOL_BOX_LOOKBACK,
        }
    if strategy_id == "S3":
        return {
            "doji_body_ratio": config.SCALP_HA_DOJI_BODY_RATIO,
            "flat_tol": config.SCALP_HA_FLAT_WICK_TOL,
            "rr_ratio": config.SCALP_HA_RR_RATIO,
            "min_bearish": config.SCALP_HA_MIN_BEARISH_CANDLES,
            "ha_weak_min_pct": config.SCALP_HA_WEAK_MIN_PCT,
            "min_atr_pct": config.SCALP_HA_MIN_ATR_PCT,
            "use_regime": True,
            "cooldown": config.SCALP_COOLDOWN_BARS,
            "trail_after_pct": 0.0,
        }
    if strategy_id == "S4":
        return {
            "vwap_period": config.SCALP_VWAP_PERIOD,
            "band_mult": config.SCALP_VWAP_BAND_MULT,
            "rr_ratio": config.SCALP_VWAP_RR_RATIO,
            "pullback_tol": config.SCALP_VWAP_PULLBACK_TOLERANCE,
        }
    if strategy_id == "S5":
        return {
            "rsi_threshold": config.SCALP_BEAR_RSI_THRESHOLD,
            "rsi_period": config.SCALP_BEAR_RSI_PERIOD,
            "bb_period": config.SCALP_BEAR_BB_PERIOD,
            "bb_std": config.SCALP_BEAR_BB_STD,
            "vol_spike": config.SCALP_BEAR_VOL_SPIKE,
            "sl_pct": config.SCALP_BEAR_SL_PCT,
            "tp_pct": config.SCALP_BEAR_TP_PCT,
            "max_hold": config.SCALP_BEAR_MAX_HOLD_BARS,
        }
    if strategy_id == "S6":
        return {
            "smma_short": config.SCALP_SMMA_SHORT,
            "smma_mid": config.SCALP_SMMA_MID,
            "smma_long": config.SCALP_SMMA_LONG,
            "rr_ratio": config.SCALP_SMMA_RR_RATIO,
            "tangle_tol": config.SCALP_SMMA_TANGLE_TOL,
            "retest_tol": config.SCALP_SMMA_RETEST_TOL,
        }
    if strategy_id == "S7":
        return {
            "ob_lookback": config.SMC_OB_LOOKBACK,
            "ob_min_move_pct": config.SMC_OB_MIN_MOVE_PCT,
            "fvg_min_gap_pct": config.SMC_FVG_MIN_GAP_PCT,
            "sweep_pct": config.SMC_LIQUIDITY_SWEEP_PCT,
            "rr_ratio": config.SMC_RR_RATIO,
            "sl_mult": config.SMC_ATR_SL_MULT,
            "cooldown": config.SMC_COOLDOWN_BARS,
            "min_atr_pct": config.SMC_MIN_ATR_PCT,
            "use_regime": True,
        }
    return {}


def _load_evolved_params(strategy_id: str) -> Optional[dict]:
    """evolved_params 테이블에서 진화된 파라미터를 읽는다. 없으면 None."""
    try:
        conn = sqlite3.connect(config.DB_PATH)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """SELECT params_json FROM evolved_params
               WHERE strategy_id=? AND coin='' AND regime=''
               AND active=1 AND validated=1
               ORDER BY id DESC LIMIT 1""",
            (strategy_id,),
        ).fetchone()
        conn.close()
        if row:
            return json.loads(row["params_json"])
    except Exception:
        # 테이블 없거나 DB 에러 → 조용히 무시 (config.py 폴백)
        pass
    return None


def _get_default_params(strategy_id: str) -> dict:
    """전략 파라미터를 반환한다. 진화 엔진 결과 우선, config.py 폴백."""
    base = _get_config_defaults(strategy_id)
    evolved = _load_evolved_params(strategy_id)
    if evolved:
        base.update(evolved)
        _evaluator_logger.debug(
            f"[Evaluator] {strategy_id} 진화 파라미터 적용: "
            f"{list(evolved.keys())}"
        )
    return base


class StrategyEvaluator:
    """7전략(S1-S7)을 모두 백테스트하고 robust_score()로 순위를 매긴다."""

    def __init__(
        self,
        fee_pct: float = config.BACKTEST_FEE_PCT,
        slippage_pct: float = config.BACKTEST_SLIPPAGE_PCT,
        min_trades: int = 5,
    ) -> None:
        self._fee_pct = fee_pct
        self._slippage_pct = slippage_pct
        self._min_trades = min_trades

    def evaluate_all(
        self, df: pd.DataFrame, regimes: np.ndarray
    ) -> EvaluationResult:
        """전체 데이터로 6전략을 평가하고 최고 전략을 선택한다."""
        return self._evaluate(df, regimes, label="전체")

    def quick_eval(
        self, df: pd.DataFrame, regimes: np.ndarray, tail: int = 500
    ) -> EvaluationResult:
        """최근 N봉으로 빠르게 재평가한다."""
        if len(df) > tail:
            df_sub = df.tail(tail).copy().reset_index(drop=True)
            df_sub = compute_indicators(df_sub)
            reg_sub = compute_regime(df_sub)
        else:
            df_sub, reg_sub = df, regimes
        return self._evaluate(df_sub, reg_sub, label="빠른")

    def _evaluate(
        self, df: pd.DataFrame, regimes: np.ndarray, label: str = ""
    ) -> EvaluationResult:
        """내부: 모든 전략 실행 → 점수 → 정렬."""
        # ★ DISABLED_STRATEGIES 필터 — 비활성화된 전략은 평가 자체를 건너뜀
        from strategy.strategy_selector import DISABLED_STRATEGIES
        disabled_ids = set(DISABLED_STRATEGIES.keys())

        scores = []
        for sid in _RUNNERS:
            # _RUNNERS key는 "S1", "S7" 등, DISABLED key는 "S7_SMC" 등
            name, _ = _RUNNERS[sid]
            if name in disabled_ids or sid in disabled_ids:
                continue
            sc = self._run_strategy(sid, df, regimes)
            scores.append(sc)
        scores.sort(key=lambda s: s.score, reverse=True)
        regime_str = str(regimes[-1]) if len(regimes) > 0 else "UNKNOWN"
        # ★ 점수 > -5 이면 선택 (학습을 위해 거래 기회 확보)
        # 이전: score > 0 → 대부분 HOLD. 학습 데이터 부족의 원인
        best = scores[0] if scores and scores[0].score > -5 else None
        return EvaluationResult(
            scores=scores,
            best=best,
            current_regime=regime_str,
            evaluation_candles=len(df),
        )

    def _run_strategy(
        self, strategy_id: str, df: pd.DataFrame, regimes: np.ndarray
    ) -> StrategyScore:
        """단일 전략을 실행하고 점수를 계산한다."""
        name, runner_fn = _RUNNERS[strategy_id]
        params = _get_default_params(strategy_id)
        try:
            trades = runner_fn(
                df, regimes, params, self._fee_pct, self._slippage_pct
            )
        except Exception as e:
            print(f"  [WARN] {name} 실행 실패: {e}", file=sys.stderr)
            trades = []
        if not trades:
            return StrategyScore(
                name=name, strategy_id=strategy_id,
                score=-1, stats={"count": 0}, params=params, trades_count=0,
            )
        stats = analyze(trades, name, regimes)
        score = robust_score(stats, self._min_trades)
        return StrategyScore(
            name=name, strategy_id=strategy_id,
            score=score, stats=stats, params=params, trades_count=len(trades),
        )

    @staticmethod
    def print_evaluation_table(result: EvaluationResult) -> None:
        """전략 평가 결과를 포맷팅하여 출력한다."""
        n = result.evaluation_candles
        regime = result.current_regime
        print(f"\n{'='*64}")
        print(f"  전략 평가 결과 ({n}개 캔들, 현재 레짐: {regime})")
        print(f"{'='*64}")
        print(f" {'순위':>4}  {'전략':<20} {'거래':>4}  {'승률':>6}  "
              f"{'PF':>5}  {'MDD':>5}  {'수익':>8}  {'점수':>6}")
        print("-" * 64)
        for rank, sc in enumerate(result.scores, 1):
            s = sc.stats
            if sc.trades_count == 0:
                print(f" {rank:>4}  {sc.name:<20} {'0':>4}  "
                      f"{'N/A':>6}  {'N/A':>5}  {'N/A':>5}  "
                      f"{'N/A':>8}  {sc.score:>6.1f}")
            else:
                wr = s.get("win_rate", 0)
                pf = s.get("pf", 0)
                mdd = s.get("mdd", 0)
                ret = s.get("total_return", 0)
                print(f" {rank:>4}  {sc.name:<20} {sc.trades_count:>4}  "
                      f"{wr:>5.1f}%  {pf:>5.2f}  {mdd:>4.1f}%  "
                      f"{ret:>+7.2f}%  {sc.score:>6.1f}")
        print(f"{'='*64}")
        if result.best:
            print(f"  선택 전략: {result.best.name} (점수: {result.best.score:.1f})")
        else:
            print("  선택 가능한 전략 없음 (모두 거래 부족)")
        print()

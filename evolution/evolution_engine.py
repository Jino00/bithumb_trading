# 전략 진화 오케스트레이터 — 6전략 파라미터를 지속적으로 탐색·최적화한다.
"""
주기: 30분마다 1개 전략을 선택하여 최적화 라운드를 실행한다.
1라운드 = 12개 후보 생성 → 백테스트 → 안전 검증 → 적용/기각

사용법:
  from evolution.evolution_engine import EvolutionOrchestrator
  engine = EvolutionOrchestrator(coins=["BTC", "ETH"])
  engine.startup()
  engine.run_forever()  # 또는 engine.run_once()
"""
import logging
import time
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd

import config
from backtest_scalp import (
    analyze,
    compute_indicators,
    compute_regime,
    fetch_data,
    run_s1_rsi_pullback,
    run_s2_volume_breakout,
    run_s3_heikin_ashi,
    run_s4_vwap,
    run_s5_bear_bounce,
    run_s6_smma_retest,
)
from monitor.strategy_evaluator import _get_default_params, robust_score

from evolution.evolution_db import EvolutionDB
from evolution.feedback_analyzer import FeedbackAnalyzer
from evolution.neighbor_generator import generate_neighbors
from evolution.param_space import STRATEGY_IDS, STRATEGY_PARAM_SPACE
from evolution.safety_gate import EvolutionSafetyGate

logger = logging.getLogger(__name__)

# ── 전략 ID → 백테스트 함수 매핑 ──────────────────────────
_RUNNERS = {
    "S1": run_s1_rsi_pullback,
    "S2": run_s2_volume_breakout,
    "S3": run_s3_heikin_ashi,
    "S4": run_s4_vwap,
    "S5": run_s5_bear_bounce,
    "S6": run_s6_smma_retest,
}

_STRATEGY_NAMES = {
    "S1": "S1_RSI_Pullback",
    "S2": "S2_Volume_Breakout",
    "S3": "S3_HeikinAshi",
    "S4": "S4_VWAP",
    "S5": "S5_BearBounce",
    "S6": "S6_SMMA_Retest",
}


class EvolutionOrchestrator:
    """6전략 파라미터를 지속적으로 탐색·최적화하는 메인 엔진."""

    def __init__(
        self,
        coins: list[str],
        db_path: str = config.DB_PATH,
        cycle_minutes: int = config.EVOLUTION_CYCLE_MINUTES,
        max_candidates: int = config.EVOLUTION_MAX_CANDIDATES,
        verbose: bool = False,
    ) -> None:
        self._coins = coins
        self._cycle_min = cycle_minutes
        self._max_candidates = max_candidates
        self._verbose = verbose

        self._db = EvolutionDB(db_path)
        self._gate = EvolutionSafetyGate()
        self._feedback = FeedbackAnalyzer(db_path=db_path)

        # 라운드 카운터 + 전략 인덱스
        self._round = 0
        self._strategy_idx = 0

        # 종료 플래그
        self._running = False

    def startup(self) -> None:
        """엔진 시작 — 이전 상태 복원 + DB 테이블 확인."""
        state = self._db.load_state()
        if state:
            self._round = state.get("round", 0)
            self._strategy_idx = state.get("strategy_idx", 0)
            logger.info(
                f"[Evolution] 상태 복원: 라운드 #{self._round}, "
                f"전략 인덱스 {self._strategy_idx}"
            )

        # 현재 활성 진화 파라미터 출력
        active = self._db.list_active()
        if active:
            print(f"\n[Evolution] 활성 진화 파라미터: {len(active)}개")
            for a in active:
                print(f"  {a['strategy_id']}: "
                      f"score={a['robust_score']:.1f} "
                      f"(+{a['improvement_pct']:.1f}%)")
        else:
            print("[Evolution] 활성 진화 파라미터 없음 (초기 상태)")

        self._running = True

    def shutdown(self) -> None:
        """엔진 종료 — 상태 저장."""
        self._running = False
        self._db.save_state({
            "round": self._round,
            "strategy_idx": self._strategy_idx,
            "stopped_at": datetime.now().isoformat(),
        })
        logger.info("[Evolution] 상태 저장 완료, 종료")

    def run_forever(self) -> None:
        """메인 루프 — cycle_minutes마다 1라운드 실행."""
        print(f"\n{'='*60}")
        print(f"  전략 진화 엔진 시작")
        print(f"  코인: {', '.join(self._coins)}")
        print(f"  주기: {self._cycle_min}분")
        print(f"  후보 수: {self._max_candidates}개/라운드")
        print(f"{'='*60}\n")

        while self._running:
            try:
                self._optimization_cycle()
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"[Evolution] 라운드 에러: {e}", exc_info=True)

            # 다음 라운드까지 대기
            if self._running:
                wait_sec = self._cycle_min * 60
                logger.info(
                    f"[Evolution] 다음 라운드까지 {self._cycle_min}분 대기"
                )
                for _ in range(wait_sec):
                    if not self._running:
                        break
                    time.sleep(1)

    def run_once(self) -> dict:
        """단일 라운드 실행 (테스트/디버깅용). 결과 dict 반환."""
        return self._optimization_cycle()

    # ── 핵심: 1라운드 최적화 ────────────────────────────────

    def _optimization_cycle(self) -> dict:
        """
        1라운드:
          1. 전략 선택 (라운드로빈 + 피드백 우선순위)
          2. 코인 데이터 수집
          3. 12개 후보 생성 → 백테스트 → 최고 후보 선택
          4. 안전 검증
          5. 통과 시 DB에 저장
        """
        self._round += 1
        strategy_id = self._select_strategy()
        strategy_name = _STRATEGY_NAMES[strategy_id]
        runner_fn = _RUNNERS[strategy_id]

        print(f"\n[R{self._round}] ── {strategy_name} 최적화 시작 ──")

        # 현재 파라미터 (DB 우선 → config.py 폴백)
        base_params = self._get_current_params(strategy_id)

        # 데이터 수집 (첫 번째 코인 사용)
        coin = self._coins[0] if self._coins else "BTC"
        df = self._fetch_and_prepare(coin)
        if df is None or len(df) < 500:
            print(f"  [SKIP] 데이터 부족: {coin}")
            return {"status": "skip", "reason": "data_insufficient"}

        regimes = compute_regime(df)

        # 베이스라인 점수 계산
        baseline_score = self._evaluate_params(
            strategy_id, runner_fn, base_params, df, regimes
        )
        print(f"  베이스라인: score={baseline_score:.1f}")

        # 이웃 후보 생성
        param_space = STRATEGY_PARAM_SPACE.get(strategy_id, {})
        neighbors = generate_neighbors(
            base_params, param_space, self._max_candidates
        )
        print(f"  후보 생성: {len(neighbors)}개")

        # 각 후보 백테스트
        best_candidate = None
        best_score = baseline_score

        for i, candidate in enumerate(neighbors):
            score = self._evaluate_params(
                strategy_id, runner_fn, candidate, df, regimes
            )
            if self._verbose:
                diff = self._param_diff(base_params, candidate, param_space)
                print(f"    [{i+1}/{len(neighbors)}] {diff} → "
                      f"score={score:.1f}")

            if score > best_score:
                best_score = score
                best_candidate = candidate

        if best_candidate is None:
            print(f"  [결과] 개선 후보 없음 (베이스라인 유지)")
            self._db.save_history(
                strategy_id=strategy_id,
                candidate_params=base_params,
                baseline_params=base_params,
                candidate_score=baseline_score,
                baseline_score=baseline_score,
                validated=False, applied=False,
                fail_reason="개선 후보 없음",
            )
            return {"status": "no_improvement", "baseline": baseline_score}

        improvement_pct = ((best_score - baseline_score) / abs(baseline_score) * 100
                           if baseline_score != 0 else 0.0)
        print(f"  최고 후보: score={best_score:.1f} "
              f"(+{improvement_pct:.1f}%)")

        # 안전 검증
        passed, reason, validated_score = self._gate.validate(
            strategy_id, best_candidate, runner_fn, df, regimes, baseline_score
        )

        if not passed:
            print(f"  [FAIL] 안전 검증 실패: {reason}")
            self._db.save_history(
                strategy_id=strategy_id,
                candidate_params=best_candidate,
                baseline_params=base_params,
                candidate_score=best_score,
                baseline_score=baseline_score,
                validated=False, applied=False,
                fail_reason=reason,
            )
            return {"status": "validation_failed", "reason": reason}

        # DB에 저장 (적용!)
        self._db.save_evolved(
            strategy_id=strategy_id,
            params=best_candidate,
            score=best_score,
            baseline_score=baseline_score,
        )
        self._db.save_history(
            strategy_id=strategy_id,
            candidate_params=best_candidate,
            baseline_params=base_params,
            candidate_score=best_score,
            baseline_score=baseline_score,
            validated=True, applied=True,
        )

        diff_str = self._param_diff(base_params, best_candidate, param_space)
        print(f"  [SUCCESS] ✅ 진화 적용: {diff_str}")
        print(f"  score: {baseline_score:.1f} → {best_score:.1f} "
              f"(+{improvement_pct:.1f}%)")

        return {
            "status": "evolved",
            "strategy": strategy_id,
            "baseline_score": baseline_score,
            "new_score": best_score,
            "improvement_pct": improvement_pct,
            "params": best_candidate,
        }

    # ── 헬퍼 메서드 ────────────────────────────────────────

    def _select_strategy(self) -> str:
        """다음 최적화할 전략을 선택한다 (라운드로빈)."""
        # 피드백 기반 우선순위 시도 (매 3라운드)
        if self._round % 3 == 0:
            try:
                priority = self._feedback.suggest_priority()
                if priority:
                    selected = priority[0]
                    logger.info(
                        f"[Evolution] 피드백 우선순위: {selected}"
                    )
                    return selected
            except Exception:
                pass

        # 기본 라운드로빈
        idx = self._strategy_idx % len(STRATEGY_IDS)
        self._strategy_idx += 1
        return STRATEGY_IDS[idx]

    def _get_current_params(self, strategy_id: str) -> dict:
        """현재 사용 중인 파라미터를 가져온다 (DB 우선)."""
        evolved = self._db.load_evolved(strategy_id)
        if evolved:
            # config.py 기본값에 진화 파라미터 병합
            base = _get_default_params(strategy_id)
            base.update(evolved)
            return base
        return _get_default_params(strategy_id)

    def _fetch_and_prepare(self, coin: str) -> Optional[pd.DataFrame]:
        """코인 OHLCV 데이터를 수집하고 지표를 계산한다."""
        try:
            df = fetch_data(coin, interval="1h")
            if df is None or len(df) < 500:
                return None
            df = compute_indicators(df)
            return df
        except Exception as e:
            logger.error(f"[Evolution] 데이터 수집 실패 ({coin}): {e}")
            return None

    def _evaluate_params(
        self,
        strategy_id: str,
        runner_fn,
        params: dict,
        df: pd.DataFrame,
        regimes: np.ndarray,
    ) -> float:
        """파라미터로 백테스트를 실행하고 robust_score를 반환한다."""
        try:
            trades = runner_fn(
                df, regimes, params,
                config.BACKTEST_FEE_PCT,
                config.BACKTEST_SLIPPAGE_PCT,
            )
        except Exception:
            return -1.0

        if not trades:
            return -1.0

        stats = analyze(trades, strategy_id, regimes)
        return robust_score(stats)

    @staticmethod
    def _param_diff(
        base: dict, candidate: dict, space: dict
    ) -> str:
        """변경된 파라미터를 요약 문자열로 반환한다."""
        diffs = []
        for key in space:
            if key in base and key in candidate:
                if abs(float(base[key]) - float(candidate[key])) > 1e-9:
                    diffs.append(
                        f"{key}: {base[key]} → {candidate[key]}"
                    )
        return ", ".join(diffs) if diffs else "(변경 없음)"

    def report(self) -> str:
        """현재 진화 상태를 요약 문자열로 반환한다."""
        active = self._db.list_active()
        lines = [
            f"{'='*55}",
            f"  전략 진화 엔진 상태 (라운드 #{self._round})",
            f"{'='*55}",
        ]
        if active:
            for a in active:
                lines.append(
                    f"  {a['strategy_id']:>3}: score={a['robust_score']:.1f} "
                    f"(+{a['improvement_pct']:.1f}%) "
                    f"[{a['created_at']}]"
                )
        else:
            lines.append("  활성 진화 파라미터 없음")
        lines.append(f"{'='*55}")
        return "\n".join(lines)

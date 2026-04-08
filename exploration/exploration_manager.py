"""탐색 매니저 — 30개 실험 슬롯을 생성/운영/평가하는 오케스트레이터."""
import json
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional

import config
from exploration.diversity_engine import DiversityEngine
from exploration.exploration_db import ExplorationDB
from exploration.variant_generator import (
    ExplorationVariant,
    generate_diverse_variants,
    _GENERATORS,
)
from exploration.variant_tracker import VariantStats, VariantTracker

logger = logging.getLogger("exploration")


@dataclass
class ExplorationSlot:
    """단일 탐색 슬롯 — 변형 + 트레이더 + 성과 통계."""
    coin: str
    variant: ExplorationVariant
    trader: object  # AdaptivePaperTrader (순환 import 방지)
    stats: VariantStats = field(default_factory=VariantStats)
    allocated_krw: float = 0.0
    created_at: str = ""


class ExplorationManager:
    """30개 탐색 슬롯의 생명주기를 관리한다.

    startup() → 변형 생성 + 슬롯 배정
    trading_cycle() → 각 슬롯 매매 사이클 실행
    evaluate_and_rotate() → 30분마다 승격/폐기/교체
    """

    def __init__(
        self,
        capital: float,
        slot_count: int = config.EXPLORATION_SLOT_COUNT,
        verbose: bool = False,
    ) -> None:
        self._capital = capital
        self._slot_count = slot_count
        self._verbose = verbose
        self._per_slot_krw = (capital / slot_count
                              * config.EXPLORATION_CAPITAL_SCALE)
        self._slots: Dict[str, ExplorationSlot] = {}
        self._unallocated_krw = capital  # 미배분 탐색 자본
        self._db = ExplorationDB()
        self._tracker = VariantTracker(self._db)
        self._diversity = DiversityEngine()
        self._promoted_count = 0
        self._discarded_count = 0
        self._cycle_count = 0

    def startup(self, available_coins: List[str]) -> int:
        """초기 30개 변형 생성 및 슬롯 배정. 활성화된 수 반환."""
        if not available_coins:
            logger.warning("[탐색] 사용 가능 코인 없음")
            return 0

        print(f"\n[탐색] 30개 실험 변형 생성 중...")
        variants = generate_diverse_variants(self._slot_count)
        activated = 0
        failed = 0

        for i, variant in enumerate(variants):
            coin = random.choice(available_coins)
            slot = self._create_slot(coin, variant)
            if slot:
                self._slots[variant.variant_id] = slot
                activated += 1
            else:
                failed += 1
            # 진행 표시 (10개마다)
            if (i + 1) % 10 == 0:
                print(f"  [{i+1}/{len(variants)}] "
                      f"활성 {activated} / 실패 {failed}")

        print(f"[탐색] {activated}/{self._slot_count}개 슬롯 활성화 "
              f"(슬롯당 {self._per_slot_krw:,.0f}원)")
        return activated

    def trading_cycle(self) -> None:
        """모든 탐색 슬롯의 매매 사이클 실행."""
        self._cycle_count += 1
        for vid, slot in list(self._slots.items()):
            try:
                self._run_slot_cycle(slot)
            except Exception as e:
                if self._verbose:
                    logger.warning(f"[탐색] {vid} 사이클 오류: {e}")

    def evaluate_and_rotate(
        self, available_coins: List[str],
    ) -> Dict[str, int]:
        """30분마다 호출 — 승격/폐기 판단 후 빈 슬롯 교체."""
        results = {"promoted": 0, "discarded": 0, "kept": 0}

        for vid in list(self._slots.keys()):
            slot = self._slots[vid]
            decision = self._tracker.evaluate(slot.stats)

            if decision == "PROMOTE":
                self._promote_variant(slot)
                del self._slots[vid]
                results["promoted"] += 1
            elif decision == "DISCARD":
                self._tracker.mark_discarded(vid)
                del self._slots[vid]
                results["discarded"] += 1
            else:
                results["kept"] += 1

        # 빈 슬롯 채우기
        self._fill_empty_slots(available_coins)

        logger.info(
            f"[탐색] 평가 완료 — "
            f"승격 {results['promoted']}, 폐기 {results['discarded']}, "
            f"유지 {results['kept']}, 총 슬롯 {len(self._slots)}"
        )
        return results

    def get_status(self) -> Dict:
        """대시보드용 상태 정보."""
        slots_info = []
        for vid, slot in self._slots.items():
            slots_info.append({
                "variant_id": vid,
                "variant_type": slot.variant.variant_type,
                "base_strategy": slot.variant.base_strategy,
                "coin": slot.coin,
                "description": slot.variant.description,
                "trade_count": slot.stats.trade_count,
                "win_rate": round(slot.stats.win_rate, 1),
                "profit_factor": round(slot.stats.profit_factor, 2),
                "total_pnl_krw": round(slot.stats.total_pnl_krw, 0),
            })
        return {
            "enabled": config.EXPLORATION_ENABLED,
            "total_slots": self._slot_count,
            "active_slots": len(self._slots),
            "capital": round(self._capital, 0),
            "per_slot_krw": round(self._per_slot_krw, 0),
            "promoted_count": self._promoted_count,
            "discarded_count": self._discarded_count,
            "cycle_count": self._cycle_count,
            "slots": slots_info,
        }

    # ── 내부 메서드 ──────────────────────────────────────────

    def _create_slot(
        self, coin: str, variant: ExplorationVariant,
    ) -> Optional[ExplorationSlot]:
        """변형에 맞는 트레이더를 생성하고 슬롯에 배정한다.

        탐색 슬롯은 경량 startup: 캔들 500개 + 변형 전략 직접 지정.
        메인 슬롯처럼 6전략 풀 평가(3000캔들)를 하지 않음.
        """
        from paper_trader import AdaptivePaperTrader

        trader = AdaptivePaperTrader(
            coin=coin,
            capital=self._per_slot_krw,
            interval_min=config.PAPER_TRADING_INTERVAL_SEC,
            report_min=config.PAPER_REPORT_INTERVAL_MIN,
            verbose=False,  # 탐색 슬롯은 로그 최소화
            candle_interval="1h",
        )
        trader._managed = True

        # 변형 훅 주입
        self._inject_variant_hooks(trader, variant)

        # 경량 startup: 전략 평가 건너뛰고 변형 전략 직접 지정
        success = self._lightweight_startup(trader, variant)
        if not success:
            return None

        # DB 저장
        self._db.save_variant(
            variant_id=variant.variant_id,
            variant_type=variant.variant_type,
            base_strategy=variant.base_strategy,
            config_json=json.dumps(variant.param_overrides),
            description=variant.description,
            coin=coin,
            generation=variant.generation,
        )

        self._unallocated_krw -= self._per_slot_krw

        return ExplorationSlot(
            coin=coin,
            variant=variant,
            trader=trader,
            allocated_krw=self._per_slot_krw,
            created_at=datetime.now().isoformat(),
        )

    def _lightweight_startup(
        self, trader: object, variant: ExplorationVariant,
    ) -> bool:
        """경량 startup — 캔들 500개만 수집, 전략 평가 생략."""
        try:
            df = trader._fetch_ohlcv(500)
            if df is None or len(df) < 50:
                return False
            from backtest_scalp import compute_indicators, compute_regime
            df = compute_indicators(df)
            regimes = compute_regime(df)
            trader._cached_df = df
            trader._cached_regimes = regimes

            # 변형의 base_strategy를 직접 활성 전략으로 지정
            sid = variant.base_strategy
            trader._active_strategy_id = sid
            trader._active_strategy_name = f"EXP:{variant.variant_id}"
            return True
        except Exception as e:
            logger.debug(f"[탐색] {variant.variant_id} startup 실패: {e}")
            return False

    def _inject_variant_hooks(
        self, trader: object, variant: ExplorationVariant,
    ) -> None:
        """변형 타입에 따라 트레이더에 실험 훅을 주입한다."""
        # 공통: EXP 태그 + HOLD 로그 억제 (BUY/EXIT만 출력)
        trader._exploration_variant_id = variant.variant_id
        trader._suppress_hold_log = True  # HOLD 로그 숨김

        if variant.variant_type == "PARAM_MUTATION":
            trader._variant_param_overrides = variant.param_overrides

        elif variant.variant_type == "STRATEGY_COMBO":
            trader._entry_strategy_override = variant.entry_strategy
            trader._exit_strategy_override = variant.exit_strategy

        elif variant.variant_type == "NOVEL_FILTER":
            filter_fn = self._build_filter_fn(variant.filter_name)
            if filter_fn:
                trader._variant_filter_fn = filter_fn

        elif variant.variant_type == "REGIME_OVERRIDE":
            trader._variant_regime_rules = variant.regime_rules

        elif variant.variant_type == "TIME_RULE":
            trader._active_hours = variant.active_hours

    def _build_filter_fn(self, filter_name: str):
        """필터 이름에서 실제 필터 함수를 생성한다."""
        import pandas as pd

        if filter_name == "macd_positive":
            def _filter(df: pd.DataFrame, idx: int) -> bool:
                if "macd_hist" not in df.columns or idx < 1:
                    return True
                return float(df["macd_hist"].iloc[idx]) > 0
            return _filter

        elif filter_name == "atr_percentile":
            def _filter(df: pd.DataFrame, idx: int) -> bool:
                if "atr" not in df.columns or idx < 20:
                    return True
                atr_series = df["atr"].iloc[:idx + 1]
                pct70 = atr_series.quantile(0.7)
                return float(atr_series.iloc[-1]) >= pct70
            return _filter

        elif filter_name == "bb_squeeze":
            def _filter(df: pd.DataFrame, idx: int) -> bool:
                if "bb_width" not in df.columns or idx < 20:
                    return True
                bw = df["bb_width"].iloc[:idx + 1]
                pct20 = bw.quantile(0.2)
                return float(bw.iloc[-1]) <= pct20
            return _filter

        return None  # 미지원 필터

    def _run_slot_cycle(self, slot: ExplorationSlot) -> None:
        """슬롯의 트레이더 사이클 실행 후 거래 결과 기록."""
        trader = slot.trader
        prev_trades = len(trader._trades)
        trader._safe_trading_cycle()

        # 새 거래가 완료됐으면 추적기에 기록
        if len(trader._trades) > prev_trades:
            for trade in trader._trades[prev_trades:]:
                self._tracker.record_trade(
                    variant_id=slot.variant.variant_id,
                    stats=slot.stats,
                    pnl_krw=trade.pnl_krw,
                    balance=trader._balance_krw,
                )

    def _promote_variant(self, slot: ExplorationSlot) -> None:
        """성과 검증된 변형을 정식 모델로 승격한다."""
        variant = slot.variant
        stats = slot.stats

        # evolution_db에 evolved_params로 저장
        try:
            from evolution.evolution_db import EvolutionDB
            evo_db = EvolutionDB()
            evo_db.save_evolved(
                strategy_id=variant.base_strategy,
                coin=slot.coin,
                regime="ALL",
                params=variant.param_overrides,
                score=stats.win_rate,
                source=f"exploration:{variant.variant_id}",
            )
        except Exception as e:
            logger.warning(f"[탐색] 승격 DB 저장 실패: {e}")

        self._tracker.mark_promoted(variant.variant_id)
        self._promoted_count += 1

        logger.info(
            f"[탐색] 승격: {variant.variant_id} | "
            f"{variant.description} | "
            f"WR={stats.win_rate:.0f}% PF={stats.profit_factor:.1f} "
            f"PnL={stats.total_pnl_krw:+,.0f}원"
        )

    def _fill_empty_slots(self, available_coins: List[str]) -> None:
        """빈 슬롯을 새 변형으로 채운다."""
        deficit = self._slot_count - len(self._slots)
        if deficit <= 0 or not available_coins:
            return

        existing = [s.variant for s in self._slots.values()]
        filled = 0
        attempts = 0
        max_attempts = deficit * 5

        while filled < deficit and attempts < max_attempts:
            attempts += 1
            vtype = random.choice(list(_GENERATORS.keys()))
            new_variant = _GENERATORS[vtype]()

            if not self._diversity.is_diverse_enough(new_variant, existing):
                continue

            coin = random.choice(available_coins)
            slot = self._create_slot(coin, new_variant)
            if slot:
                self._slots[new_variant.variant_id] = slot
                existing.append(new_variant)
                filled += 1

        if filled > 0:
            logger.info(f"[탐색] {filled}개 새 변형 생성 (교체)")

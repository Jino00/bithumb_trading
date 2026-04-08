# 전략 선택 엔진 — 코인 × 레짐 × MTF 조건으로 최적 전략을 자동 선택한다.
"""
전략 활성화 매트릭스 (2026-03-15 전면 활성화):

┌──────────┬───────────────────────────┬──────────────────────────┬──────────────────────────┐
│  레짐    │         BTC              │         ETH             │       ALT(SOL/DOGE 등)  │
├──────────┼───────────────────────────┼──────────────────────────┼──────────────────────────┤
│ BULL     │ S7(SMC) + S6(SMMA)      │ S7(SMC) + S4(VWAP)     │ S6(SMMA) + S7(SMC)     │
│ SIDEWAYS │ S3(HA) + S7(SMC)        │ S4(VWAP) + S6(SMMA)    │ S6(SMMA) + S3(HA)      │
│ BEAR     │ S5(반등) + S1(RSI) 0.5x │ S5(반등) + S1(RSI) 0.5x│ S5(반등) + S1(RSI) 0.5x│
└──────────┴───────────────────────────┴──────────────────────────┴──────────────────────────┘

핵심 원칙:
1. 7개 전략 모두 활성화 — 거래 기회 극대화
2. S7 SMC: 기관 매매 기법 (OB + FVG + Liquidity Sweep)
3. S1 RSI: BEAR 보조전략 (과매도 바운스, 0.5x 축소)
4. BEAR에서도 반등 매매 허용 (S5 + S1, 축소 포지션)
5. MTF 4h BEAR → S5 역추세 0.3x 축소 허용
"""
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import config

logger = logging.getLogger(__name__)


@dataclass
class StrategyAssignment:
    """특정 조건에서의 전략 배정."""
    primary: str           # 주전략 이름
    secondary: str = ""    # 보조전략 이름 (없으면 빈 문자열)
    position_scale: float = 1.0  # 포지션 크기 배율 (BEAR: 0.5)
    reason: str = ""       # 이 배정의 근거


# ── 전략 활성화 매트릭스 (백테스트 검증 기반) ──────────────────
# 키: (코인 그룹, 레짐) → 전략 배정
# 코인 그룹: "BTC", "ETH", "ALT" (DOGE, SOL 등)

STRATEGY_MATRIX: Dict[Tuple[str, str], StrategyAssignment] = {
    # ── BTC ── (S7 SMC 추가: 기관 매매 기법으로 고품질 진입)
    ("BTC", "BULL"): StrategyAssignment(
        primary="S7_SMC",
        secondary="S6_SMMA_Retest",
        position_scale=1.0,
        reason="BTC BULL: S7 SMC(기관 매매) + S6 SMMA 보조",
    ),
    ("BTC", "SIDEWAYS"): StrategyAssignment(
        primary="S3_Heikin_Ashi",
        secondary="S7_SMC",
        position_scale=1.0,
        reason="BTC SIDEWAYS: S3 HA(PF 1.78) + S7 SMC(유동성 스윕)",
    ),
    ("BTC", "BEAR"): StrategyAssignment(
        primary="S5_Bear_Bounce",
        secondary="S1_RSI_Pullback",
        position_scale=0.5,
        reason="BTC BEAR: S5 반등 + S1 RSI 과매도 바운스 0.5x",
    ),

    # ── ETH ── (S7 보조, S1 보조)
    ("ETH", "BULL"): StrategyAssignment(
        primary="S7_SMC",
        secondary="S4_VWAP",
        position_scale=1.0,
        reason="ETH BULL: S7 SMC + S4 VWAP 보조",
    ),
    ("ETH", "SIDEWAYS"): StrategyAssignment(
        primary="S4_VWAP",
        secondary="S6_SMMA_Retest",
        position_scale=1.0,
        reason="ETH SIDEWAYS: S4(VWAP) + S6(SMMA)",
    ),
    ("ETH", "BEAR"): StrategyAssignment(
        primary="S5_Bear_Bounce",
        secondary="S1_RSI_Pullback",
        position_scale=0.5,
        reason="ETH BEAR: S5 반등 + S1 RSI 0.5x",
    ),

    # ── 알트코인 (SOL, DOGE 등) ── (S7 추가, S2 유지)
    ("ALT", "BULL"): StrategyAssignment(
        primary="S6_SMMA_Retest",
        secondary="S7_SMC",
        position_scale=1.0,
        reason="ALT BULL: S6 SMMA + S7 SMC(유동성 스윕)",
    ),
    ("ALT", "SIDEWAYS"): StrategyAssignment(
        primary="S6_SMMA_Retest",
        secondary="S3_Heikin_Ashi",
        position_scale=1.0,
        reason="ALT SIDEWAYS: S6 SMMA + S3 HA",
    ),
    ("ALT", "BEAR"): StrategyAssignment(
        primary="S5_Bear_Bounce",
        secondary="S1_RSI_Pullback",
        position_scale=0.5,
        reason="ALT BEAR: S5 반등 + S1 RSI 0.5x",
    ),
}

# ── 비활성화 전략 목록 ──
DISABLED_STRATEGIES = {
    # ★ 2026-03-30: 확률 기반 재평가 → 전부 살림
    # S7_SMC: 95건 27% → 신뢰구간 상한 36.7% > 35%, 아직 가능성 있음
    # S6_SMMA: 거래 수 부족으로 판단 불가 → 재시도
}


def classify_coin_group(symbol: str) -> str:
    """코인을 그룹으로 분류한다."""
    if symbol == "BTC":
        return "BTC"
    elif symbol == "ETH":
        return "ETH"
    else:
        return "ALT"


class StrategySelector:
    """코인 × 레짐 × MTF 조건에 따라 최적 전략을 선택하는 엔진.

    사용법:
        selector = StrategySelector()
        assignment = selector.select("BTC", regime="SIDEWAYS", mtf_trend="BULL")
        if assignment.primary:
            # 주전략으로 매매
    """

    def __init__(self, custom_matrix: Dict = None) -> None:
        self._matrix = custom_matrix or STRATEGY_MATRIX
        self._disabled = set(DISABLED_STRATEGIES.keys())

    def select(
        self,
        symbol: str,
        regime: str,
        mtf_trend: str = "NEUTRAL",
    ) -> StrategyAssignment:
        """현재 조건에서 최적 전략을 선택한다.

        Args:
            symbol: 코인 심볼 (BTC, ETH, SOL, DOGE 등)
            regime: 현재 레짐 (BULL, SIDEWAYS, BEAR)
            mtf_trend: 상위 TF 추세 (BULL, NEUTRAL, BEAR)

        Returns:
            StrategyAssignment: 주전략 + 보조전략 + 포지션 크기
        """
        # MTF BEAR이면 역추세 축소 포지션 허용 (차단 → 축소)
        if mtf_trend == "BEAR":
            if config.MTF_ALLOW_COUNTER_TREND:
                # ★ 역추세 허용: S5 반등 매매를 축소 포지션으로
                group = classify_coin_group(symbol)
                return StrategyAssignment(
                    primary="S5_Bear_Bounce",
                    position_scale=config.MTF_COUNTER_TREND_SCALE,
                    reason=f"MTF 4h BEAR → S5 역추세 {config.MTF_COUNTER_TREND_SCALE}x ({symbol})",
                )
            return StrategyAssignment(
                primary="",
                position_scale=0.0,
                reason=f"MTF 4h BEAR → LONG 전면 차단 ({symbol})",
            )

        group = classify_coin_group(symbol)
        key = (group, regime)

        assignment = self._matrix.get(key)
        if assignment is None:
            logger.warning(f"[Selector] 매트릭스에 없는 조건: {key}")
            return StrategyAssignment(
                primary="S3_Heikin_Ashi",  # 안전 기본값
                position_scale=0.5,
                reason=f"기본값 할당: {key}",
            )

        # 비활성화 전략 체크
        if assignment.primary in self._disabled:
            if assignment.secondary and assignment.secondary not in self._disabled:
                return StrategyAssignment(
                    primary=assignment.secondary,
                    position_scale=assignment.position_scale,
                    reason=f"{assignment.primary} 비활성 → {assignment.secondary} 승격",
                )
            return StrategyAssignment(
                primary="",
                position_scale=0.0,
                reason=f"{assignment.primary} 비활성, 대안 없음",
            )

        return assignment

    def get_allowed_strategies(
        self,
        symbol: str,
        regime: str,
        mtf_trend: str = "NEUTRAL",
    ) -> List[str]:
        """현재 조건에서 허용되는 전략 이름 목록."""
        assignment = self.select(symbol, regime, mtf_trend)
        strategies = []
        if assignment.primary:
            strategies.append(assignment.primary)
        if assignment.secondary:
            strategies.append(assignment.secondary)
        return strategies

    def is_strategy_allowed(
        self,
        strategy_name: str,
        symbol: str,
        regime: str,
        mtf_trend: str = "NEUTRAL",
    ) -> bool:
        """특정 전략이 현재 조건에서 허용되는지 확인."""
        if strategy_name in self._disabled:
            return False
        allowed = self.get_allowed_strategies(symbol, regime, mtf_trend)
        return strategy_name in allowed

    def enable_strategy(self, name: str) -> None:
        """비활성화된 전략을 활성화한다 (파라미터 튜닝 후)."""
        self._disabled.discard(name)
        logger.info(f"[Selector] 전략 활성화: {name}")

    def disable_strategy(self, name: str, reason: str = "") -> None:
        """전략을 비활성화한다."""
        self._disabled.add(name)
        logger.info(f"[Selector] 전략 비활성화: {name} ({reason})")

    def explain(self, symbol: str, regime: str, mtf_trend: str = "NEUTRAL") -> str:
        """현재 조건에서의 전략 선택 이유를 자연어로 설명한다."""
        assignment = self.select(symbol, regime, mtf_trend)
        lines = [
            f"[{symbol}] 레짐={regime}, MTF={mtf_trend}",
            f"  → 주전략: {assignment.primary or '없음 (거래 안 함)'}",
        ]
        if assignment.secondary:
            lines.append(f"  → 보조전략: {assignment.secondary}")
        lines.append(f"  → 포지션: {assignment.position_scale:.0%}")
        lines.append(f"  → 근거: {assignment.reason}")

        if not assignment.primary:
            lines.append("  ⚠️ 이 조건에서는 거래하지 않습니다.")

        return "\n".join(lines)

    def print_full_matrix(self) -> None:
        """전체 전략 매트릭스를 출력한다."""
        print(f"\n{'='*80}")
        print(f"  전략 선택 매트릭스 (코인 × 레짐)")
        print(f"{'='*80}")
        print(f"{'조건':>20s} {'주전략':>20s} {'보조':>20s} {'크기':>6s}")
        print(f"{'-'*80}")

        for (group, regime), assign in sorted(self._matrix.items()):
            key = f"{group}/{regime}"
            primary = assign.primary or "❌ 거래 안 함"
            secondary = assign.secondary or "-"
            scale = f"{assign.position_scale:.0%}"

            # 비활성 표시
            if assign.primary in self._disabled:
                primary = f"⛔{primary}"

            print(f"{key:>20s} {primary:>20s} {secondary:>20s} {scale:>6s}")

        if self._disabled:
            print(f"\n  ⛔ 비활성 전략:")
            for name, reason in DISABLED_STRATEGIES.items():
                if name in self._disabled:
                    print(f"    {name}: {reason}")

        print(f"{'='*80}")

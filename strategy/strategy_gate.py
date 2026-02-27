"""
전략 게이트 — 4가지 기준을 모두 통과해야만 실전 배포 허용.

통과 조건 (모두 충족 필요):
  1. 백테스트 승률 ≥ 75%
  2. 총 거래 샘플 ≥ 100건
  3. MDD ≤ 20%
  4. Profit Factor ≥ 1.5
"""
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# ── 공유 데이터 구조 ───────────────────────────────────────────────────────────

@dataclass
class BacktestResult:
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float            # %
    total_return_pct: float    # %
    max_drawdown_pct: float    # %
    avg_profit_pct: float      # 거래당 평균 수익 %
    profit_factor: float = 0.0 # 총수익 / 총손실
    best_params: dict = field(default_factory=dict)  # 그리드서치 최적 파라미터


@dataclass
class GateCheckResult:
    """각 조건별 통과 여부 상세"""
    passed: bool
    win_rate_pass: bool
    min_trades_pass: bool
    mdd_pass: bool
    profit_factor_pass: bool
    win_rate: float
    total_trades: int
    max_drawdown_pct: float
    profit_factor: float
    fail_reasons: list = field(default_factory=list)


# ── 게이트 클래스 ──────────────────────────────────────────────────────────────

class StrategyGate:
    """
    백테스트 결과를 4개 기준으로 검증한다.
    단 하나라도 미달 시 실전 배포가 차단된다.

    Args:
        min_win_rate:      최소 승률 (기본 75.0 %)
        min_trades:        최소 거래 건수 (기본 100)
        max_mdd:           최대 허용 MDD (기본 20.0 %)
        min_profit_factor: 최소 Profit Factor (기본 1.5)
    """

    def __init__(
        self,
        min_win_rate: float = 75.0,
        min_trades: int = 100,
        max_mdd: float = 20.0,
        min_profit_factor: float = 1.5,
    ) -> None:
        self.min_win_rate = min_win_rate
        self.min_trades = min_trades
        self.max_mdd = max_mdd
        self.min_profit_factor = min_profit_factor

    # ── 공개 메서드 ────────────────────────────────────────

    def validate(self, result: BacktestResult) -> bool:
        """통과 여부만 반환 (상세는 check() 사용)"""
        return self.check(result).passed

    def check(self, result: BacktestResult) -> GateCheckResult:
        """4개 조건을 개별 평가하고 상세 결과를 반환한다."""
        wr_pass = result.win_rate >= self.min_win_rate
        tr_pass = result.total_trades >= self.min_trades
        mdd_pass = result.max_drawdown_pct <= self.max_mdd
        pf_pass = result.profit_factor >= self.min_profit_factor

        fail_reasons = []
        if not wr_pass:
            fail_reasons.append(
                f"승률 {result.win_rate:.1f}% < {self.min_win_rate}%"
            )
        if not tr_pass:
            fail_reasons.append(
                f"거래 건수 {result.total_trades} < {self.min_trades}"
            )
        if not mdd_pass:
            fail_reasons.append(
                f"MDD {result.max_drawdown_pct:.1f}% > {self.max_mdd}%"
            )
        if not pf_pass:
            fail_reasons.append(
                f"Profit Factor {result.profit_factor:.2f} < {self.min_profit_factor}"
            )

        passed = wr_pass and tr_pass and mdd_pass and pf_pass
        gate_result = GateCheckResult(
            passed=passed,
            win_rate_pass=wr_pass,
            min_trades_pass=tr_pass,
            mdd_pass=mdd_pass,
            profit_factor_pass=pf_pass,
            win_rate=result.win_rate,
            total_trades=result.total_trades,
            max_drawdown_pct=result.max_drawdown_pct,
            profit_factor=result.profit_factor,
            fail_reasons=fail_reasons,
        )

        self._log(gate_result, result)
        return gate_result

    def summary(self, result: BacktestResult) -> str:
        """한 줄 요약 문자열 (로그 없이 순수 문자열 반환)"""
        # check()를 직접 호출하지 않고 결과만 계산해 이중 로그 방지
        wr_pass = result.win_rate >= self.min_win_rate
        tr_pass = result.total_trades >= self.min_trades
        mdd_pass = result.max_drawdown_pct <= self.max_mdd
        pf_pass = result.profit_factor >= self.min_profit_factor
        passed = wr_pass and tr_pass and mdd_pass and pf_pass
        status = "PASS" if passed else "FAIL"

        fail_reasons = []
        if not wr_pass:
            fail_reasons.append(f"승률 {result.win_rate:.1f}% < {self.min_win_rate}%")
        if not tr_pass:
            fail_reasons.append(f"거래 건수 {result.total_trades} < {self.min_trades}")
        if not mdd_pass:
            fail_reasons.append(f"MDD {result.max_drawdown_pct:.1f}% > {self.max_mdd}%")
        if not pf_pass:
            fail_reasons.append(f"Profit Factor {result.profit_factor:.2f} < {self.min_profit_factor}")

        return (
            f"[StrategyGate {status}] "
            f"승률={result.win_rate:.1f}% "
            f"거래={result.total_trades} "
            f"MDD={result.max_drawdown_pct:.1f}% "
            f"PF={result.profit_factor:.2f} "
            f"수익={result.total_return_pct:.2f}%"
            + (f" | 실패: {', '.join(fail_reasons)}" if fail_reasons else "")
        )

    # ── 내부 헬퍼 ──────────────────────────────────────────

    def _log(self, gate: GateCheckResult, result: BacktestResult) -> None:
        checks = [
            ("승률", gate.win_rate_pass, f"{result.win_rate:.1f}% ({'≥' if gate.win_rate_pass else '<'}{self.min_win_rate}%)"),
            ("샘플", gate.min_trades_pass, f"{result.total_trades}건 ({'≥' if gate.min_trades_pass else '<'}{self.min_trades})"),
            ("MDD", gate.mdd_pass, f"{result.max_drawdown_pct:.1f}% ({'≤' if gate.mdd_pass else '>'}{self.max_mdd}%)"),
            ("PF", gate.profit_factor_pass, f"{result.profit_factor:.2f} ({'≥' if gate.profit_factor_pass else '<'}{self.min_profit_factor})"),
        ]

        lines = ["[StrategyGate] " + ("✓ PASS" if gate.passed else "✗ FAIL")]
        for name, ok, val in checks:
            mark = "✓" if ok else "✗"
            lines.append(f"  {mark} {name}: {val}")

        msg = "\n".join(lines)
        if gate.passed:
            logger.info(msg)
        else:
            logger.warning(msg)

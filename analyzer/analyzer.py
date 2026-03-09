"""
거래 분석기 — 모든 완료된 거래를 대상으로 다차원 분석 후 개선 제안 출력.

분석 항목:
  1. 전략별 승률
  2. RSI 진입값 구간별 성과 (RSI 몇일 때 승률이 높았나)
  3. 시간대별 성과 분포
  4. 손절/익절 패턴 분석
  5. 변동성/추세 조건별 성과
  6. 파라미터 개선 제안
"""
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import config

logger = logging.getLogger(__name__)


# ── 분석 결과 데이터 구조 ──────────────────────────────────────────────────────

@dataclass
class AnalysisReport:
    total_trades: int
    win_rate: float
    avg_profit_pct: float
    avg_loss_pct: float
    profit_factor: float
    max_consecutive_losses: int
    avg_hold_minutes: float

    by_strategy: Dict[str, dict] = field(default_factory=dict)
    by_rsi_bucket: Dict[str, dict] = field(default_factory=dict)
    by_hour: Dict[int, dict] = field(default_factory=dict)
    by_trend: Dict[str, dict] = field(default_factory=dict)
    by_volatility: Dict[str, dict] = field(default_factory=dict)
    exit_pattern: Dict[str, dict] = field(default_factory=dict)

    suggestions: List[str] = field(default_factory=list)


# ── 분석기 ────────────────────────────────────────────────────────────────────

class TradeAnalyzer:
    """
    trade_logger.get_completed_trades() 결과를 받아 분석한다.
    예외 없이 모든 거래를 대상으로 한다.

    Args:
        trades: get_completed_trades() 반환값 (entries JOIN exits)
    """

    def __init__(self, trades: List[Dict[str, Any]]) -> None:
        self.trades = [t for t in trades if t.get("pnl_pct") is not None]
        self._apply_recency_weights()
        logger.info(f"TradeAnalyzer 초기화: {len(self.trades)}건 완료 거래")

    def _apply_recency_weights(self) -> None:
        """거래를 시간순 정렬 후 최근 거래에 높은 가중치를 부여한다."""
        if not self.trades:
            return

        # timestamp로 정렬 (오래된 → 최신)
        self.trades.sort(
            key=lambda t: t.get("entry_time") or t.get("timestamp") or ""
        )

        n = len(self.trades)
        min_w = config.ANALYSIS_RECENCY_MIN_WEIGHT
        for i, t in enumerate(self.trades):
            if n == 1:
                t["_weight"] = 1.0
            else:
                # 선형 보간: 가장 오래된=min_w, 최신=1.0
                t["_weight"] = round(min_w + (1.0 - min_w) * i / (n - 1), 4)

    # ── 공개 메서드 ────────────────────────────────────────

    def analyze(self) -> AnalysisReport:
        """전체 분석을 수행하고 AnalysisReport를 반환한다."""
        if not self.trades:
            return AnalysisReport(
                0, 0.0, 0.0, 0.0, 0.0, 0, 0.0,
                suggestions=["분석할 거래 데이터가 없습니다."]
            )

        report = AnalysisReport(
            total_trades=len(self.trades),
            win_rate=self._win_rate(),
            avg_profit_pct=self._avg_profit(),
            avg_loss_pct=self._avg_loss(),
            profit_factor=self._profit_factor(),
            max_consecutive_losses=self._max_consecutive_losses(),
            avg_hold_minutes=self._avg_hold_minutes(),
            by_strategy=self._by_strategy(),
            by_rsi_bucket=self._by_rsi_bucket(),
            by_hour=self._by_hour(),
            by_trend=self._by_trend(),
            by_volatility=self._by_volatility(),
            exit_pattern=self._exit_pattern(),
        )
        report.suggestions = self._suggest(report)
        return report

    def report(self) -> str:
        """분석 결과를 사람이 읽기 쉬운 리포트 문자열로 반환한다."""
        r = self.analyze()

        if r.total_trades == 0:
            return "분석할 거래 데이터가 없습니다."

        lines = [
            "=" * 60,
            "  거래 분석 리포트",
            "=" * 60,
            f"  총 거래 수         : {r.total_trades}",
            f"  승률               : {r.win_rate:.1f}%",
            f"  평균 수익 (승)      : +{r.avg_profit_pct:.3f}%",
            f"  평균 손실 (패)      : {r.avg_loss_pct:.3f}%",
            f"  Profit Factor      : {r.profit_factor:.3f}",
            f"  최대 연속 손실      : {r.max_consecutive_losses}회",
            f"  평균 보유 시간      : {r.avg_hold_minutes:.0f}분",
            "",
        ]

        # ── 전략별 성과 ──────────────────────────────────
        if r.by_strategy:
            lines.append("[ 전략별 성과 ]")
            for name, stat in sorted(r.by_strategy.items()):
                lines.append(
                    f"  {name}: 승률={stat['win_rate']:.1f}% "
                    f"거래={stat['total']} PF={stat['profit_factor']:.2f}"
                )
            lines.append("")

        # ── RSI 구간별 성과 ───────────────────────────────
        if r.by_rsi_bucket:
            lines.append("[ RSI 진입값 구간별 승률 ]")
            for bucket, stat in sorted(r.by_rsi_bucket.items()):
                bar = "█" * int(stat["win_rate"] / 5)
                lines.append(
                    f"  RSI {bucket:>8}: {bar:<20} "
                    f"{stat['win_rate']:.0f}% ({stat['total']}건)"
                )
            lines.append("")

        # ── 시간대별 성과 ─────────────────────────────────
        if r.by_hour:
            lines.append("[ 시간대별 승률 (매수 기준) ]")
            for h in sorted(r.by_hour.keys()):
                stat = r.by_hour[h]
                bar = "█" * int(stat["win_rate"] / 5)
                lines.append(
                    f"  {h:02d}시: {bar:<20} "
                    f"{stat['win_rate']:.0f}% ({stat['total']}건)"
                )
            lines.append("")

        # ── 추세별 성과 ───────────────────────────────────
        if r.by_trend:
            lines.append("[ 진입 추세별 성과 ]")
            for trend, stat in sorted(r.by_trend.items()):
                lines.append(
                    f"  {trend:>12}: 승률={stat['win_rate']:.1f}% "
                    f"평균pnl={stat['avg_pnl']:+.2f}% ({stat['total']}건)"
                )
            lines.append("")

        # ── 변동성별 성과 ─────────────────────────────────
        if r.by_volatility:
            lines.append("[ 진입 변동성별 성과 ]")
            for vol, stat in sorted(r.by_volatility.items()):
                lines.append(
                    f"  {vol:>8}: 승률={stat['win_rate']:.1f}% "
                    f"평균pnl={stat['avg_pnl']:+.2f}% ({stat['total']}건)"
                )
            lines.append("")

        # ── 청산 패턴 ─────────────────────────────────────
        if r.exit_pattern:
            lines.append("[ 청산 패턴 분석 ]")
            for reason_type, stat in sorted(r.exit_pattern.items()):
                lines.append(
                    f"  {reason_type:>12}: {stat['count']}건 "
                    f"({stat['pct']:.1f}%) 평균pnl={stat['avg_pnl']:+.2f}%"
                )
            lines.append("")

        # ── 개선 제안 ─────────────────────────────────────
        lines.append("[ 파라미터 개선 제안 ]")
        for i, s in enumerate(r.suggestions, 1):
            lines.append(f"  {i}. {s}")
        lines.append("=" * 60)

        return "\n".join(lines)

    # ── 기본 지표 계산 ─────────────────────────────────────

    def _win_rate(self) -> float:
        if not self.trades:
            return 0.0
        w_wins = sum(t.get("_weight", 1.0) for t in self.trades if t["pnl_pct"] > 0)
        w_total = sum(t.get("_weight", 1.0) for t in self.trades)
        return round(w_wins / w_total * 100, 2) if w_total > 0 else 0.0

    def _avg_profit(self) -> float:
        profits = [t["pnl_pct"] for t in self.trades if t["pnl_pct"] > 0]
        return round(sum(profits) / len(profits), 4) if profits else 0.0

    def _avg_loss(self) -> float:
        losses = [t["pnl_pct"] for t in self.trades if t["pnl_pct"] <= 0]
        return round(sum(losses) / len(losses), 4) if losses else 0.0

    def _profit_factor(self) -> float:
        gross_p = sum(t["pnl_pct"] for t in self.trades if t["pnl_pct"] > 0)
        gross_l = abs(sum(t["pnl_pct"] for t in self.trades if t["pnl_pct"] <= 0))
        return round(gross_p / gross_l, 3) if gross_l > 0 else float("inf")

    def _max_consecutive_losses(self) -> int:
        max_cl = cur = 0
        for t in self.trades:
            if t["pnl_pct"] <= 0:
                cur += 1
                max_cl = max(max_cl, cur)
            else:
                cur = 0
        return max_cl

    def _avg_hold_minutes(self) -> float:
        vals = [t.get("hold_minutes") or 0.0 for t in self.trades]
        return round(sum(vals) / len(vals), 1) if vals else 0.0

    # ── 다차원 분석 ────────────────────────────────────────

    @staticmethod
    def _weighted_bucket_stats(trades: List[Dict[str, Any]]) -> dict:
        """가중 평균으로 버킷 통계를 계산하는 공통 헬퍼."""
        if not trades:
            return {"total": 0, "win_rate": 0.0, "avg_pnl": 0.0}
        w_wins = sum(t.get("_weight", 1.0) for t in trades if t["pnl_pct"] > 0)
        w_total = sum(t.get("_weight", 1.0) for t in trades)
        w_pnl = sum(t["pnl_pct"] * t.get("_weight", 1.0) for t in trades)
        return {
            "total": len(trades),
            "win_rate": round(w_wins / w_total * 100, 1) if w_total > 0 else 0.0,
            "avg_pnl": round(w_pnl / w_total, 3) if w_total > 0 else 0.0,
        }

    def _by_strategy(self) -> Dict[str, dict]:
        """전략명별 가중 승률, 거래 수, PF"""
        buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for t in self.trades:
            name = t.get("strategy_name") or "unknown"
            buckets[name].append(t)

        result = {}
        for name, trades in buckets.items():
            stats = self._weighted_bucket_stats(trades)
            pnls = [t["pnl_pct"] for t in trades]
            gp = sum(p for p in pnls if p > 0)
            gl = abs(sum(p for p in pnls if p < 0))
            stats["wins"] = sum(1 for p in pnls if p > 0)
            stats["profit_factor"] = round(gp / gl, 3) if gl > 0 else float("inf")
            result[name] = stats
        return result

    def _by_rsi_bucket(self) -> Dict[str, dict]:
        """
        RSI 진입값을 5 단위 구간으로 나눠 구간별 가중 승률 분석.
        예: "25-30", "30-35", ...
        """
        buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for t in self.trades:
            rsi = t.get("rsi_value")
            if rsi is None:
                continue
            lo = int(rsi // 5) * 5
            hi = lo + 5
            key = f"{lo:2d}-{hi:2d}"
            buckets[key].append(t)

        result = {}
        for key, trades in buckets.items():
            result[key] = self._weighted_bucket_stats(trades)
        return result

    def _by_hour(self) -> Dict[int, dict]:
        """매수 시간대(0~23시)별 가중 승률 분포"""
        buckets: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
        for t in self.trades:
            ts = t.get("entry_time") or ""
            try:
                hour = int(ts[11:13])
            except (ValueError, IndexError):
                continue
            buckets[hour].append(t)

        result = {}
        for h, trades in buckets.items():
            stats = self._weighted_bucket_stats(trades)
            stats["wins"] = sum(1 for t in trades if t["pnl_pct"] > 0)
            result[h] = stats
        return result

    def _by_trend(self) -> Dict[str, dict]:
        """진입 시점 추세별 가중 성과 (UPTREND / DOWNTREND / SIDEWAYS)"""
        buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for t in self.trades:
            trend = t.get("trend") or "UNKNOWN"
            buckets[trend].append(t)

        return {
            trend: self._weighted_bucket_stats(trades)
            for trend, trades in buckets.items()
        }

    def _by_volatility(self) -> Dict[str, dict]:
        """진입 시점 변동성별 가중 성과 (HIGH / MEDIUM / LOW)"""
        buckets: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for t in self.trades:
            vol = t.get("volatility") or "UNKNOWN"
            buckets[vol].append(t)

        return {
            vol: self._weighted_bucket_stats(trades)
            for vol, trades in buckets.items()
        }

    def _exit_pattern(self) -> Dict[str, dict]:
        """
        청산 이유 패턴 분석.
        exit_reason 텍스트에서 유형을 추출한다:
          - "손절"    → STOP_LOSS
          - "익절"    → TAKE_PROFIT
          - "과매수"  → RSI_OVERBOUGHT
          - 기타      → OTHER
        """
        buckets: Dict[str, list] = defaultdict(list)
        for t in self.trades:
            reason = (t.get("exit_reason") or "").lower()
            if "손절" in reason or "stop" in reason:
                key = "STOP_LOSS"
            elif "익절" in reason or "take" in reason:
                key = "TAKE_PROFIT"
            elif "과매수" in reason or "overbought" in reason or "rsi" in reason:
                key = "RSI_SIGNAL"
            else:
                key = "OTHER"
            buckets[key].append(t["pnl_pct"])

        total = len(self.trades)
        result = {}
        for key, pnls in buckets.items():
            result[key] = {
                "count": len(pnls),
                "pct": round(len(pnls) / total * 100, 1),
                "avg_pnl": round(sum(pnls) / len(pnls), 3),
                "win_rate": round(sum(1 for p in pnls if p > 0) / len(pnls) * 100, 1),
            }
        return result

    # ── 개선 제안 생성 ─────────────────────────────────────

    def _suggest(self, r: AnalysisReport) -> List[str]:
        suggestions = []

        # 1. 전반적 승률
        if r.win_rate < 50:
            suggestions.append(
                f"승률 {r.win_rate:.1f}% 미달 — RSI oversold 기준 낮추기 검토 (예: 30 → 25)"
            )
        elif r.win_rate < 65:
            suggestions.append(
                f"승률 {r.win_rate:.1f}% — 추세 필터 추가 권장 (DOWNTREND 시 매수 자제)"
            )

        # 2. Profit Factor
        if r.profit_factor < 1.0:
            suggestions.append(
                f"PF {r.profit_factor:.2f} < 1.0 — 전략 전면 재검토 필요"
            )
        elif r.profit_factor < 1.5:
            suggestions.append(
                f"PF {r.profit_factor:.2f} — 익절 목표 상향 또는 손절 타이트하게 조정 권장"
            )

        # 3. 평균 손실 vs 평균 수익
        if r.avg_loss_pct and r.avg_profit_pct:
            rr = abs(r.avg_profit_pct / r.avg_loss_pct) if r.avg_loss_pct else 0
            if rr < 1.0:
                suggestions.append(
                    f"R:R 비율 {rr:.2f} < 1.0 "
                    f"(평균수익 {r.avg_profit_pct:.2f}% vs 평균손실 {r.avg_loss_pct:.2f}%) "
                    f"— 익절 기준 상향 검토"
                )

        # 4. 연속 손실
        if r.max_consecutive_losses >= 5:
            suggestions.append(
                f"최대 연속 손실 {r.max_consecutive_losses}회 "
                f"— 3회 연속 손실 후 거래 일시 중단 로직 추가 고려"
            )

        # 5. RSI 최적 구간 제안
        best_rsi_bucket = self._best_rsi_bucket(r.by_rsi_bucket)
        if best_rsi_bucket:
            suggestions.append(
                f"RSI {best_rsi_bucket} 구간에서 최고 승률 달성 "
                f"— 해당 구간으로 oversold 임계값 조정 검토"
            )

        # 6. 저성과 시간대
        bad_pct = config.ANALYSIS_BAD_PERFORMANCE_PCT
        min_sample = config.ANALYSIS_MIN_SAMPLE
        bad_hours = [
            h for h, v in r.by_hour.items()
            if v["win_rate"] < bad_pct and v["total"] >= min_sample
        ]
        if bad_hours:
            suggestions.append(
                f"저성과 시간대 감지 ({bad_hours}시, 승률<{bad_pct}%) "
                f"— 해당 시간 매수 제외 설정 검토"
            )

        # 7. 추세 조건
        downtrend_stat = r.by_trend.get("DOWNTREND")
        dt_threshold = config.ANALYSIS_DOWNTREND_THRESHOLD
        if downtrend_stat and downtrend_stat["win_rate"] < dt_threshold and downtrend_stat["total"] >= min_sample:
            suggestions.append(
                f"하락 추세 진입 승률 {downtrend_stat['win_rate']:.1f}% "
                f"— DOWNTREND 구간 매수 차단 필터 추가 권장"
            )

        # 8. 고변동성 분석
        high_vol = r.by_volatility.get("HIGH")
        if high_vol and high_vol["win_rate"] < bad_pct and high_vol["total"] >= min_sample:
            suggestions.append(
                f"고변동성 구간 승률 {high_vol['win_rate']:.1f}% "
                f"— ATR 높을 때 포지션 크기 축소 권장"
            )

        # 9. 손절 비중
        sl_stat = r.exit_pattern.get("STOP_LOSS")
        total = r.total_trades
        if sl_stat and sl_stat["count"] / total > 0.4:
            suggestions.append(
                f"손절 비중 {sl_stat['pct']:.1f}% — 손절 기준 완화 또는 진입 조건 강화 필요"
            )

        # 10. 보유 시간
        if r.avg_hold_minutes < 30:
            suggestions.append(
                f"평균 보유시간 {r.avg_hold_minutes:.0f}분으로 매우 짧음 "
                f"— 과도한 손절/익절 설정 확인 필요"
            )

        if not suggestions:
            suggestions.append(
                f"전략 성과 양호 (승률={r.win_rate:.1f}%, PF={r.profit_factor:.2f}) "
                f"— 현재 파라미터 유지 권장"
            )

        return suggestions

    @staticmethod
    def _best_rsi_bucket(by_rsi: Dict[str, dict]) -> Optional[str]:
        """최소 N건 이상이면서 승률 최고인 RSI 구간 반환"""
        valid = {k: v for k, v in by_rsi.items() if v["total"] >= config.ANALYSIS_MIN_SAMPLE}
        if not valid:
            return None
        return max(valid, key=lambda k: valid[k]["win_rate"])


# ── 직접 실행 ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import config
    from logger.trade_logger import TradeLogger

    tl = TradeLogger(config.DB_PATH)
    trades = tl.get_completed_trades()
    analyzer = TradeAnalyzer(trades)
    print(analyzer.report())

"""학습 감시 에이전트 — 학습 시스템이 제대로 작동하는지 독립적으로 감시한다.

감시 대상:
  1. 학습 파이프라인 가동 여부 (파일 업데이트 주기)
  2. 학습→행동 연결 여부 (인사이트가 실제 거래에 반영되는지)
  3. 학습 품질 (교훈이 수익 개선에 기여하는지)
  4. 학습 편향 감지 (과적합, 표본 부족 판단)
  5. 에이전트 간 일관성 (CIO vs 이익최대화 모순 여부)

30분마다 실행. 문제 발견 시 경고 + 자동 교정.
"""
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger("watchdog")


@dataclass
class WatchdogAlert:
    """감시 경고."""
    severity: str      # CRITICAL | WARNING | INFO
    category: str      # PIPELINE | FEEDBACK | QUALITY | BIAS | CONSISTENCY
    message: str
    auto_fix: str = "" # 자동 교정 액션 (빈 문자열이면 수동 대응)


@dataclass
class WatchdogReport:
    """감시 보고서."""
    timestamp: str
    alerts: List[WatchdogAlert] = field(default_factory=list)
    pipeline_health: Dict = field(default_factory=dict)
    feedback_loop_score: float = 0.0  # 0-100
    learning_quality: Dict = field(default_factory=dict)
    overall_status: str = "UNKNOWN"   # HEALTHY | DEGRADED | BROKEN


class LearningWatchdog:
    """학습 시스템 감시자.

    트레이딩 코드와 학습 코드 모두에 독립적.
    오직 학습 결과물(JSON 파일)과 거래 성과만 보고 판단한다.
    """

    MEMORY_DIR = ".claude/memory"
    REPORT_PATH = ".claude/memory/watchdog_reports.json"

    # 감시 대상 파일과 최대 허용 지연 (시간)
    MONITORED_FILES = {
        "trade_insights.json": ("거래 인사이트", 1.0),
        "learning_state.json": ("학습 패턴", 1.0),
        "trade_journal.json": ("거래 저널", 1.0),
        "unified_lessons.json": ("자동 교훈", 2.0),
        "profit_maximizer_log.json": ("이익 최대화", 1.0),
        "cio_verdicts.json": ("CIO 평가", 1.0),
    }

    def __init__(self) -> None:
        self._run_count = 0

    def check(
        self,
        trades: List[dict],
        insight_actions: dict,
        prev_trades_count: int = 0,
    ) -> WatchdogReport:
        """전체 감시 실행."""
        self._run_count += 1
        report = WatchdogReport(
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M"),
        )

        # 5가지 감시
        self._check_pipeline(report)
        self._check_feedback_loop(report, trades, insight_actions)
        self._check_quality(report, trades)
        self._check_bias(report, trades)
        self._check_consistency(report)

        # 종합 상태
        criticals = sum(1 for a in report.alerts if a.severity == "CRITICAL")
        warnings = sum(1 for a in report.alerts if a.severity == "WARNING")
        if criticals > 0:
            report.overall_status = "BROKEN"
        elif warnings > 2:
            report.overall_status = "DEGRADED"
        else:
            report.overall_status = "HEALTHY"

        self._print_report(report)
        self._save_report(report)
        return report

    # ── 1. 파이프라인 가동 감시 ──────────────────────────────

    def _check_pipeline(self, report: WatchdogReport) -> None:
        """학습 파일들이 정상적으로 업데이트되고 있는지 확인."""
        now = datetime.now()
        health = {}

        for fname, (desc, max_delay_h) in self.MONITORED_FILES.items():
            fp = os.path.join(self.MEMORY_DIR, fname)
            if not os.path.exists(fp):
                health[desc] = "MISSING"
                report.alerts.append(WatchdogAlert(
                    severity="WARNING",
                    category="PIPELINE",
                    message=f"{desc} 파일 없음 ({fname})",
                ))
                continue

            mod_time = datetime.fromtimestamp(os.path.getmtime(fp))
            age_h = (now - mod_time).total_seconds() / 3600
            size_kb = os.path.getsize(fp) / 1024

            if age_h > max_delay_h * 3:
                health[desc] = f"STALE ({age_h:.1f}h)"
                report.alerts.append(WatchdogAlert(
                    severity="CRITICAL",
                    category="PIPELINE",
                    message=f"{desc} 업데이트 중단 ({age_h:.1f}시간 전)",
                    auto_fix="학습 엔진 재시작 필요",
                ))
            elif age_h > max_delay_h:
                health[desc] = f"DELAYED ({age_h:.1f}h)"
                report.alerts.append(WatchdogAlert(
                    severity="WARNING",
                    category="PIPELINE",
                    message=f"{desc} 업데이트 지연 ({age_h:.1f}시간 전)",
                ))
            else:
                health[desc] = f"OK ({age_h:.1f}h, {size_kb:.0f}KB)"

        report.pipeline_health = health

    # ── 2. 학습→행동 연결 감시 ───────────────────────────────

    def _check_feedback_loop(
        self, report: WatchdogReport,
        trades: List[dict],
        insight_actions: dict,
    ) -> None:
        """인사이트가 실제 거래에 반영되고 있는지 확인."""
        score = 100.0

        # 교훈 파일 읽기
        lessons_path = os.path.join(self.MEMORY_DIR, "unified_lessons.json")
        lessons = []
        if os.path.exists(lessons_path):
            try:
                with open(lessons_path) as f:
                    raw = json.load(f)
                lessons = raw if isinstance(raw, list) else raw.get("lessons", [])
            except Exception:
                pass

        # 체크 1: 교훈이 있는가?
        if not lessons:
            score -= 30
            report.alerts.append(WatchdogAlert(
                severity="WARNING",
                category="FEEDBACK",
                message="교훈 0개 — 학습이 시작되지 않음",
            ))

        # 체크 2: 교훈이 적용되고 있는가?
        applied = sum(1 for l in lessons if l.get("applied", False))
        if lessons and applied == 0:
            score -= 40
            report.alerts.append(WatchdogAlert(
                severity="CRITICAL",
                category="FEEDBACK",
                message=f"교훈 {len(lessons)}개 중 적용된 것 0개 — "
                        f"학습은 하지만 행동에 반영 안 됨",
                auto_fix="InsightActions → 거래 로직 연결 확인",
            ))
        elif lessons:
            apply_rate = applied / len(lessons) * 100
            if apply_rate < 50:
                score -= 20
                report.alerts.append(WatchdogAlert(
                    severity="WARNING",
                    category="FEEDBACK",
                    message=f"교훈 적용률 {apply_rate:.0f}% "
                            f"({applied}/{len(lessons)}) — 절반 이상 미반영",
                ))

        # 체크 3: insight_actions가 비어 있지 않은가?
        active_actions = 0
        if insight_actions:
            if insight_actions.get("blocked_combos"):
                active_actions += 1
            if insight_actions.get("strategy_scores"):
                active_actions += 1
            if insight_actions.get("disabled_strategies"):
                active_actions += 1
        if active_actions == 0 and len(trades) > 10:
            score -= 20
            report.alerts.append(WatchdogAlert(
                severity="WARNING",
                category="FEEDBACK",
                message="10건+ 거래 후에도 활성 액션 없음 — "
                        "학습 결과가 행동으로 전환되지 않음",
            ))

        report.feedback_loop_score = max(0, score)

    # ── 3. 학습 품질 감시 ────────────────────────────────────

    def _check_quality(
        self, report: WatchdogReport, trades: List[dict],
    ) -> None:
        """학습이 실제 수익 개선에 기여하는지 확인."""
        if len(trades) < 10:
            report.learning_quality = {"status": "데이터 부족"}
            return

        # 전반부 vs 후반부 성과 비교 (학습 효과 측정)
        mid = len(trades) // 2
        first_half = trades[:mid]
        second_half = trades[mid:]

        wr1 = sum(1 for t in first_half if t.get("pnl_pct", 0) > 0) / len(first_half) * 100
        wr2 = sum(1 for t in second_half if t.get("pnl_pct", 0) > 0) / len(second_half) * 100
        pnl1 = sum(t.get("pnl_krw", 0) for t in first_half)
        pnl2 = sum(t.get("pnl_krw", 0) for t in second_half)

        improving = wr2 > wr1 or pnl2 > pnl1
        report.learning_quality = {
            "first_half_wr": round(wr1, 1),
            "second_half_wr": round(wr2, 1),
            "wr_delta": round(wr2 - wr1, 1),
            "first_half_pnl": round(pnl1),
            "second_half_pnl": round(pnl2),
            "improving": improving,
        }

        if not improving and len(trades) >= 20:
            report.alerts.append(WatchdogAlert(
                severity="WARNING",
                category="QUALITY",
                message=f"학습 효과 미확인 — 전반 WR={wr1:.0f}% → "
                        f"후반 WR={wr2:.0f}% "
                        f"(PnL {pnl1:+,.0f} → {pnl2:+,.0f})",
                auto_fix="학습 파라미터 리셋 또는 전략 재평가 고려",
            ))

    # ── 4. 학습 편향 감시 ────────────────────────────────────

    def _check_bias(
        self, report: WatchdogReport, trades: List[dict],
    ) -> None:
        """과적합, 표본 부족, 편향을 감지한다."""
        if len(trades) < 5:
            return

        # 편향 1: 특정 청산 사유에 과집중
        from collections import Counter
        exit_reasons = Counter(t.get("exit_reason", "?") for t in trades)
        total = len(trades)
        for reason, count in exit_reasons.most_common(1):
            ratio = count / total * 100
            if ratio > 60:
                report.alerts.append(WatchdogAlert(
                    severity="WARNING",
                    category="BIAS",
                    message=f"청산 편향: [{reason}]이 {ratio:.0f}% "
                            f"({count}/{total}건) — 다양한 청산 조건 필요",
                ))

        # 편향 2: 특정 코인에 과집중
        coins = Counter(t.get("coin", "?") for t in trades)
        top_coin, top_count = coins.most_common(1)[0]
        concentration = top_count / total * 100
        if concentration > 40 and total >= 10:
            report.alerts.append(WatchdogAlert(
                severity="WARNING",
                category="BIAS",
                message=f"코인 편향: {top_coin}이 {concentration:.0f}% "
                        f"— 분산 투자 부족",
            ))

        # 편향 3: 표본 부족으로 성급한 판단
        lessons_path = os.path.join(self.MEMORY_DIR, "unified_lessons.json")
        if os.path.exists(lessons_path):
            try:
                with open(lessons_path) as f:
                    raw = json.load(f)
                lessons = raw if isinstance(raw, list) else raw.get("lessons", [])
                weak = [l for l in lessons
                        if l.get("evidence_count", 0) < 5
                        and l.get("applied", False)]
                if weak:
                    report.alerts.append(WatchdogAlert(
                        severity="INFO",
                        category="BIAS",
                        message=f"약한 근거 교훈 {len(weak)}개 적용 중 "
                                f"(근거 5건 미만) — 과적합 위험",
                    ))
            except Exception:
                pass

    # ── 5. 에이전트 간 일관성 감시 ───────────────────────────

    def _check_consistency(self, report: WatchdogReport) -> None:
        """CIO vs 이익최대화 에이전트의 판단이 모순되지 않는지 확인."""
        cio_path = os.path.join(self.MEMORY_DIR, "cio_verdicts.json")
        pm_path = os.path.join(self.MEMORY_DIR, "profit_maximizer_log.json")

        if not os.path.exists(cio_path) or not os.path.exists(pm_path):
            return

        try:
            with open(cio_path) as f:
                cio_entries = json.load(f)
            with open(pm_path) as f:
                pm_entries = json.load(f)

            if not cio_entries or not pm_entries:
                return

            cio_last = cio_entries[-1] if isinstance(cio_entries, list) else cio_entries
            pm_last = pm_entries[-1] if isinstance(pm_entries, list) else pm_entries

            # CIO 배분 추천 vs PM 액션 비교
            cio_coins = {c["coin"]: c["action"]
                         for c in cio_last.get("allocation", [])}
            pm_coins = {a["target"]: a["type"]
                        for a in pm_last.get("actions", [])}

            contradictions = []
            for coin in set(cio_coins) & set(pm_coins):
                cio_act = cio_coins[coin]
                pm_act = pm_coins[coin]
                if ((cio_act == "INCREASE" and pm_act == "REDUCE") or
                        (cio_act == "DECREASE" and pm_act == "BOOST")):
                    contradictions.append(f"{coin}: CIO={cio_act} vs PM={pm_act}")

            if contradictions:
                report.alerts.append(WatchdogAlert(
                    severity="WARNING",
                    category="CONSISTENCY",
                    message=f"에이전트 모순 {len(contradictions)}건: "
                            f"{', '.join(contradictions[:3])}",
                    auto_fix="보수적 판단 적용 (축소 우선)",
                ))
        except Exception:
            pass

    # ── 출력 / 저장 ──────────────────────────────────────────

    def _print_report(self, report: WatchdogReport) -> None:
        """콘솔 출력."""
        status_emoji = {
            "HEALTHY": "✅", "DEGRADED": "⚠️", "BROKEN": "🚨"
        }
        emoji = status_emoji.get(report.overall_status, "?")

        print(f"\n{'▓' * 60}")
        print(f"  학습 감시 | {report.timestamp} | "
              f"{emoji} {report.overall_status}")
        print(f"{'▓' * 60}")

        # 파이프라인 상태
        print(f"  파이프라인:")
        for name, status in report.pipeline_health.items():
            icon = "✓" if "OK" in status else "✗"
            print(f"    {icon} {name:<14} {status}")

        # 피드백 루프
        print(f"  피드백 루프: {report.feedback_loop_score:.0f}/100")

        # 학습 품질
        q = report.learning_quality
        if isinstance(q, dict) and "wr_delta" in q:
            arrow = "↑" if q["wr_delta"] > 0 else "↓"
            print(f"  학습 효과: WR {q['first_half_wr']:.0f}% → "
                  f"{q['second_half_wr']:.0f}% ({arrow}{abs(q['wr_delta']):.1f}%p)")

        # 경고
        if report.alerts:
            print(f"  경고 ({len(report.alerts)}건):")
            for a in report.alerts:
                icon = {"CRITICAL": "🚨", "WARNING": "⚠️", "INFO": "ℹ️"}.get(a.severity, "?")
                print(f"    {icon} [{a.category}] {a.message}")
                if a.auto_fix:
                    print(f"       → {a.auto_fix}")
        else:
            print(f"  경고 없음 — 학습 정상 작동 중")
        print(f"{'▓' * 60}")

    def _save_report(self, report: WatchdogReport) -> None:
        """보고서 저장."""
        try:
            entry = {
                "timestamp": report.timestamp,
                "status": report.overall_status,
                "feedback_score": report.feedback_loop_score,
                "quality": report.learning_quality,
                "alerts": [
                    {"severity": a.severity, "category": a.category,
                     "message": a.message}
                    for a in report.alerts
                ],
            }
            history = []
            if os.path.exists(self.REPORT_PATH):
                with open(self.REPORT_PATH) as f:
                    history = json.load(f)
                if not isinstance(history, list):
                    history = [history]
            history.append(entry)
            history = history[-50:]
            with open(self.REPORT_PATH, "w") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug(f"Watchdog 저장 실패: {e}")

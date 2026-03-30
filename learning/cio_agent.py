"""독립 CIO 에이전트 — 트레이딩 시스템을 외부 시각으로 평가하고 이익 최대화를 조언한다.

핵심 원칙:
  - 이 에이전트는 트레이딩 코드를 모른다. 오직 거래 결과 데이터만 본다.
  - 자기 평가 편향을 제거하기 위해, 전략 로직이 아닌 순수 성과만 분석한다.
  - 30분마다 실행되어 객관적 평가 + 구체적 액션을 제시한다.

역할:
  1. 시장 판단 — 지금 거래해야 하는가? (시장 컨디션 점수)
  2. 자본 배분 — 어디에 얼마를 넣어야 하는가? (EV 기반)
  3. 사이징 — 확신도에 따라 얼마나 크게 베팅할 것인가?
  4. 성과 귀인 — 왜 벌었고 왜 잃었는가? (분해 분석)
  5. 탐색 활용 — 실험에서 뭘 배웠고 메인에 뭘 적용할 것인가?
"""
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional
from collections import defaultdict

logger = logging.getLogger("cio_agent")


@dataclass
class CIOVerdict:
    """CIO 에이전트의 평가 결과."""
    timestamp: str
    # 시장 판단
    market_score: int = 0       # -100 ~ +100 (거래 적합도)
    market_action: str = ""     # AGGRESSIVE | NORMAL | DEFENSIVE | STOP
    market_reason: str = ""
    # 자본 배분 추천
    allocation_changes: List[dict] = field(default_factory=list)
    # 포지션 사이징 추천
    sizing_rule: str = ""
    # 성과 귀인
    attribution: Dict = field(default_factory=dict)
    # 탐색 슬롯 추천
    exploration_advice: List[str] = field(default_factory=list)
    # 종합 조언
    top_advice: List[str] = field(default_factory=list)
    # 메타
    grade: str = ""             # A/B/C/D/F
    score: float = 0.0          # 0-100 종합 점수


class CIOAgent:
    """독립 CIO — 거래 데이터만 보고 객관적으로 평가한다.

    트레이딩 전략 코드를 모른다. 코인 이름, 가격, 손익, 시간만 본다.
    """

    REPORT_PATH = ".claude/memory/cio_verdicts.json"

    def __init__(self) -> None:
        self._history: List[CIOVerdict] = []
        self._run_count = 0

    def evaluate(
        self,
        trades: List[dict],
        positions: List[dict],
        exploration: List[dict],
        market: dict,
    ) -> CIOVerdict:
        """전체 평가 실행."""
        self._run_count += 1
        now = datetime.now().strftime("%Y-%m-%d %H:%M")

        verdict = CIOVerdict(timestamp=now)

        # 1. 시장 판단
        self._judge_market(verdict, market, trades)

        # 2. 성과 귀인 (WHY 분석)
        self._attribute_performance(verdict, trades)

        # 3. 자본 배분 추천
        self._recommend_allocation(verdict, trades, positions)

        # 4. 포지션 사이징 추천
        self._recommend_sizing(verdict, trades)

        # 5. 탐색 슬롯 평가
        self._evaluate_exploration(verdict, exploration)

        # 6. 종합 등급
        self._compute_grade(verdict, trades)

        # 7. 종합 조언
        self._generate_advice(verdict, trades)

        self._history.append(verdict)
        self._print_verdict(verdict)
        self._save_verdict(verdict)
        return verdict

    # ── 1. 시장 판단 ─────────────────────────────────────────

    def _judge_market(
        self, v: CIOVerdict, market: dict, trades: List[dict],
    ) -> None:
        """시장 컨디션 점수 산출 — 거래해야 하는가?"""
        score = 0
        reasons = []

        # Fear & Greed
        fg = market.get("fear_greed", 50)
        if fg <= 10:
            score += 30
            reasons.append(f"극단적 공포(F&G={fg}) → 역사적 반등 구간")
        elif fg <= 25:
            score += 15
            reasons.append(f"공포(F&G={fg}) → 반등 가능성")
        elif fg >= 75:
            score -= 20
            reasons.append(f"탐욕(F&G={fg}) → 고점 경계")

        # 최근 거래 성과
        recent = trades[-10:] if len(trades) >= 10 else trades
        if recent:
            recent_wr = sum(1 for t in recent if t.get("pnl_pct", 0) > 0) / len(recent) * 100
            if recent_wr >= 70:
                score += 20
                reasons.append(f"최근 승률 {recent_wr:.0f}% → 모멘텀 양호")
            elif recent_wr <= 30:
                score -= 30
                reasons.append(f"최근 승률 {recent_wr:.0f}% → 전략 부진")

        # BTC 도미넌스
        dom = market.get("btc_dominance", 50)
        if dom > 55:
            score += 10
            reasons.append(f"BTC 우세({dom:.0f}%) → BTC 집중 유리")

        # 판단
        if score >= 30:
            v.market_action = "AGGRESSIVE"
        elif score >= 0:
            v.market_action = "NORMAL"
        elif score >= -20:
            v.market_action = "DEFENSIVE"
        else:
            v.market_action = "STOP"

        v.market_score = score
        v.market_reason = " | ".join(reasons) if reasons else "중립"

    # ── 2. 성과 귀인 (WHY) ───────────────────────────────────

    def _attribute_performance(
        self, v: CIOVerdict, trades: List[dict],
    ) -> None:
        """이익/손실의 원인을 분해한다."""
        if len(trades) < 3:
            v.attribution = {"status": "데이터 부족"}
            return

        wins = [t for t in trades if t.get("pnl_pct", 0) > 0]
        losses = [t for t in trades if t.get("pnl_pct", 0) <= 0]

        # 손실 원인 분해
        loss_causes = defaultdict(lambda: {"count": 0, "total_krw": 0})
        for t in losses:
            reason = t.get("exit_reason", "UNKNOWN")
            loss_causes[reason]["count"] += 1
            loss_causes[reason]["total_krw"] += t.get("pnl_krw", 0)

        # 가장 큰 손실 원인
        biggest_loss_cause = max(
            loss_causes.items(),
            key=lambda x: abs(x[1]["total_krw"]),
            default=("없음", {"count": 0, "total_krw": 0})
        )

        # 사이징 귀인: 패배 시 포지션이 승리보다 큰가?
        avg_win_size = (sum(t.get("invested_krw", 0) for t in wins) / len(wins)
                        if wins else 0)
        avg_loss_size = (sum(t.get("invested_krw", 0) for t in losses) / len(losses)
                         if losses else 0)
        sizing_bias = "균등"
        if avg_loss_size > avg_win_size * 1.3:
            sizing_bias = f"패배 포지션이 승리의 {avg_loss_size/max(avg_win_size,1):.1f}배"
        elif avg_win_size > avg_loss_size * 1.3:
            sizing_bias = "양호 — 승리 시 더 크게 베팅"

        # 코인 집중도: 한 코인에서 과다 거래?
        coin_counts = defaultdict(int)
        for t in trades:
            coin_counts[t.get("coin", "?")] += 1
        top_coin = max(coin_counts.items(), key=lambda x: x[1])
        concentration = top_coin[1] / len(trades) * 100

        v.attribution = {
            "biggest_loss_cause": biggest_loss_cause[0],
            "biggest_loss_amount": biggest_loss_cause[1]["total_krw"],
            "biggest_loss_count": biggest_loss_cause[1]["count"],
            "sizing_bias": sizing_bias,
            "coin_concentration": f"{top_coin[0]} {concentration:.0f}%",
            "avg_win_pct": round(
                sum(t["pnl_pct"] for t in wins) / len(wins), 2
            ) if wins else 0,
            "avg_loss_pct": round(
                sum(t["pnl_pct"] for t in losses) / len(losses), 2
            ) if losses else 0,
        }

    # ── 3. 자본 배분 추천 ────────────────────────────────────

    def _recommend_allocation(
        self, v: CIOVerdict, trades: List[dict],
        positions: List[dict],
    ) -> None:
        """Expected Value 기반 자본 배분 추천."""
        by_coin = defaultdict(list)
        for t in trades:
            by_coin[t.get("coin", "?")].append(t)

        changes = []
        for coin, ts in by_coin.items():
            if len(ts) < 2:
                continue
            wins = sum(1 for t in ts if t.get("pnl_pct", 0) > 0)
            wr = wins / len(ts)
            avg_win = sum(t["pnl_pct"] for t in ts if t["pnl_pct"] > 0) / max(wins, 1)
            losses_n = len(ts) - wins
            avg_loss = (sum(t["pnl_pct"] for t in ts if t["pnl_pct"] <= 0)
                        / max(losses_n, 1))
            ev = wr * avg_win + (1 - wr) * avg_loss

            if ev > 0.5:
                changes.append({
                    "coin": coin, "action": "INCREASE",
                    "ev": round(ev, 2),
                    "reason": f"EV=+{ev:.2f}% ({len(ts)}건, WR={wr*100:.0f}%)",
                })
            elif ev < -0.5 and len(ts) >= 3:
                changes.append({
                    "coin": coin, "action": "DECREASE",
                    "ev": round(ev, 2),
                    "reason": f"EV={ev:.2f}% ({len(ts)}건, WR={wr*100:.0f}%)",
                })

        v.allocation_changes = sorted(
            changes, key=lambda x: x["ev"], reverse=True
        )

    # ── 4. 포지션 사이징 추천 ────────────────────────────────

    def _recommend_sizing(
        self, v: CIOVerdict, trades: List[dict],
    ) -> None:
        """확신도 기반 사이징 규칙 추천."""
        if len(trades) < 5:
            v.sizing_rule = "데이터 부족 — 균등 사이징 유지"
            return

        # 큰 포지션 거래 vs 작은 포지션 거래 성과 비교
        median_size = sorted(
            t.get("invested_krw", 0) for t in trades
        )[len(trades) // 2]

        big = [t for t in trades if t.get("invested_krw", 0) > median_size]
        small = [t for t in trades if t.get("invested_krw", 0) <= median_size]

        big_pnl = sum(t.get("pnl_krw", 0) for t in big)
        small_pnl = sum(t.get("pnl_krw", 0) for t in small)

        if big_pnl < 0 and small_pnl > 0:
            v.sizing_rule = (
                f"큰 포지션 손실({big_pnl:+,.0f}원), "
                f"작은 포지션 수익({small_pnl:+,.0f}원) → "
                f"포지션 축소 권장"
            )
        elif big_pnl > small_pnl * 2:
            v.sizing_rule = "큰 포지션이 수익 주도 → 현재 사이징 적절"
        else:
            v.sizing_rule = "사이징 영향 중립 — 진입 품질에 집중"

    # ── 5. 탐색 슬롯 평가 ────────────────────────────────────

    def _evaluate_exploration(
        self, v: CIOVerdict, exp_slots: List[dict],
    ) -> None:
        """탐색 실험 결과를 독립적으로 평가한다."""
        advice = []

        active = [s for s in exp_slots if s.get("trade_count", 0) > 0]
        if not active:
            advice.append("탐색 거래 없음 — 아직 판단 불가")
            v.exploration_advice = advice
            return

        total_pnl = sum(s.get("total_pnl_krw", 0) for s in active)
        total_trades = sum(s.get("trade_count", 0) for s in active)
        advice.append(
            f"탐색 {len(active)}개 슬롯, {total_trades}건, "
            f"PnL {total_pnl:+,.0f}원"
        )

        # 유형별 성과 비교
        by_type = defaultdict(list)
        for s in active:
            by_type[s.get("variant_type", "?")].append(s)

        best_type = None
        best_pnl = float("-inf")
        for vtype, slots in by_type.items():
            type_pnl = sum(s.get("total_pnl_krw", 0) for s in slots)
            type_trades = sum(s.get("trade_count", 0) for s in slots)
            if type_pnl > best_pnl:
                best_pnl = type_pnl
                best_type = vtype
            advice.append(
                f"  {vtype}: {type_trades}건, PnL {type_pnl:+,.0f}원"
            )

        if best_type and best_pnl > 0:
            advice.append(
                f"→ {best_type} 유형이 가장 수익성 높음 — 이 유형 변형 늘릴 것"
            )

        # 개별 스타
        stars = sorted(active, key=lambda s: s.get("total_pnl_krw", 0), reverse=True)
        for s in stars[:3]:
            if s.get("total_pnl_krw", 0) > 0:
                advice.append(
                    f"★ {s['variant_id']} ({s.get('description','')[:30]}) "
                    f"— {s['trade_count']}건 {s.get('total_pnl_krw',0):+,.0f}원"
                )

        v.exploration_advice = advice

    # ── 6. 종합 등급 ─────────────────────────────────────────

    def _compute_grade(
        self, v: CIOVerdict, trades: List[dict],
    ) -> None:
        """종합 성과 등급 산출."""
        if len(trades) < 3:
            v.grade = "-"
            v.score = 0
            return

        score = 50  # 기본점

        # 승률 점수
        wr = sum(1 for t in trades if t.get("pnl_pct", 0) > 0) / len(trades) * 100
        score += (wr - 50) * 0.5  # 50% 기준 ±

        # PF 점수
        gross_p = sum(t["pnl_krw"] for t in trades if t["pnl_krw"] > 0)
        gross_l = abs(sum(t["pnl_krw"] for t in trades if t["pnl_krw"] <= 0))
        pf = gross_p / gross_l if gross_l > 0 else 0
        if pf >= 2.0:
            score += 20
        elif pf >= 1.5:
            score += 10
        elif pf < 1.0:
            score -= 20

        # 시장 판단
        score += v.market_score * 0.1

        score = max(0, min(100, score))
        v.score = round(score, 1)

        if score >= 80:
            v.grade = "A"
        elif score >= 65:
            v.grade = "B"
        elif score >= 50:
            v.grade = "C"
        elif score >= 35:
            v.grade = "D"
        else:
            v.grade = "F"

    # ── 7. 종합 조언 ─────────────────────────────────────────

    def _generate_advice(
        self, v: CIOVerdict, trades: List[dict],
    ) -> None:
        """가장 중요한 3가지 조언 생성."""
        advice = []

        # 시장 액션
        if v.market_action == "STOP":
            advice.append("거래 중단 권고 — 시장 컨디션 최악")
        elif v.market_action == "DEFENSIVE":
            advice.append("방어적 운용 — 포지션 50% 축소")
        elif v.market_action == "AGGRESSIVE":
            advice.append("공격적 운용 — 유망 코인에 자본 집중")

        # 귀인 기반 조언
        attr = v.attribution
        if isinstance(attr, dict) and "sizing_bias" in attr:
            if "배" in attr["sizing_bias"]:
                advice.append(
                    f"포지션 비대칭 해소 필요: {attr['sizing_bias']}"
                )
            cause = attr.get("biggest_loss_cause", "")
            amount = attr.get("biggest_loss_amount", 0)
            if amount < -1_000_000:
                advice.append(
                    f"최대 손실 원인 [{cause}] {amount:+,.0f}원 → 이 청산 조건 완화"
                )

        # 배분 조언
        increases = [c for c in v.allocation_changes if c["action"] == "INCREASE"]
        decreases = [c for c in v.allocation_changes if c["action"] == "DECREASE"]
        if increases:
            coins = ", ".join(c["coin"] for c in increases[:3])
            advice.append(f"자본 증가: {coins} (EV 양수)")
        if decreases:
            coins = ", ".join(c["coin"] for c in decreases[:3])
            advice.append(f"자본 감소: {coins} (EV 음수)")

        v.top_advice = advice[:5]

    # ── 출력 / 저장 ──────────────────────────────────────────

    def _print_verdict(self, v: CIOVerdict) -> None:
        """콘솔 출력."""
        print(f"\n{'█' * 60}")
        print(f"  CIO 독립 평가 | {v.timestamp} | "
              f"등급: {v.grade} ({v.score:.0f}점)")
        print(f"{'█' * 60}")

        print(f"  시장: {v.market_action} (점수 {v.market_score:+d})")
        print(f"    {v.market_reason}")

        attr = v.attribution
        if isinstance(attr, dict) and "avg_win_pct" in attr:
            print(f"  귀인: 평균수익 {attr['avg_win_pct']:+.2f}% vs "
                  f"평균손실 {attr['avg_loss_pct']:+.2f}% | "
                  f"사이징 {attr['sizing_bias']}")
            print(f"    최대 손실: [{attr['biggest_loss_cause']}] "
                  f"{attr['biggest_loss_amount']:+,.0f}원 "
                  f"({attr['biggest_loss_count']}건)")
            print(f"    집중도: {attr['coin_concentration']}")

        if v.allocation_changes:
            print(f"  배분:")
            for c in v.allocation_changes[:5]:
                arrow = "▲" if c["action"] == "INCREASE" else "▼"
                print(f"    {arrow} {c['coin']:>6} | {c['reason']}")

        print(f"  사이징: {v.sizing_rule}")

        if v.exploration_advice:
            print(f"  탐색:")
            for a in v.exploration_advice:
                print(f"    {a}")

        if v.top_advice:
            print(f"  {'─' * 56}")
            print(f"  조언:")
            for i, a in enumerate(v.top_advice, 1):
                print(f"    {i}. {a}")
        print(f"{'█' * 60}")

    def _save_verdict(self, v: CIOVerdict) -> None:
        """평가 결과 저장."""
        try:
            entry = {
                "timestamp": v.timestamp,
                "grade": v.grade,
                "score": v.score,
                "market_action": v.market_action,
                "market_score": v.market_score,
                "sizing_rule": v.sizing_rule,
                "advice": v.top_advice,
                "allocation": v.allocation_changes[:5],
                "attribution": v.attribution,
            }
            history = []
            if os.path.exists(self.REPORT_PATH):
                with open(self.REPORT_PATH) as f:
                    history = json.load(f)
                if not isinstance(history, list):
                    history = [history]
            history.append(entry)
            history = history[-50:]  # 최근 50건
            with open(self.REPORT_PATH, "w") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug(f"CIO 저장 실패: {e}")

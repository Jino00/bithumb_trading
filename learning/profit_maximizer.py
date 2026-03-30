"""이익 최대화 에이전트 — 모든 거래 데이터를 분석하여 수익 극대화 방법을 찾는다.

30분마다 실행되며:
1. 수익/손실 패턴 분석 (어디서 돈을 벌고, 어디서 잃는지)
2. 최적 포지션 사이징 제안 (이기는 조건에 더 크게 베팅)
3. 탐색 슬롯 우수 변형 조기 감지 (승격 후보 추천)
4. 코인×전략×레짐 최적 조합 발견
5. 실시간 액션으로 변환하여 즉시 적용
"""
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

import config

logger = logging.getLogger("profit_maximizer")


@dataclass
class ProfitAction:
    """이익 최대화를 위한 구체적 액션."""
    action_type: str  # BOOST | REDUCE | BLOCK | SWITCH | PROMOTE
    target: str       # 코인, 전략, 변형 ID
    reason: str       # 왜 이 액션인지
    expected_impact: float  # 예상 수익 개선 (원)
    confidence: float  # 0.0~1.0


@dataclass
class ProfitReport:
    """이익 최대화 분석 보고서."""
    timestamp: str
    total_trades: int
    total_pnl: float
    actions: List[ProfitAction] = field(default_factory=list)
    best_coins: List[dict] = field(default_factory=list)
    worst_coins: List[dict] = field(default_factory=list)
    best_strategies: List[dict] = field(default_factory=list)
    exploration_stars: List[dict] = field(default_factory=list)
    sizing_suggestion: str = ""


class ProfitMaximizer:
    """이익 최대화 서브에이전트.

    run() 호출 시 전체 분석 → ProfitReport + 즉시 적용 가능한 액션 반환.
    """

    def __init__(self, verbose: bool = False) -> None:
        self._verbose = verbose
        self._last_report: Optional[ProfitReport] = None
        self._run_count = 0

    def run(
        self,
        trades: List[dict],
        positions: List[dict],
        exploration_slots: List[dict],
    ) -> ProfitReport:
        """전체 분석 실행 → 보고서 + 액션 리스트 반환."""
        self._run_count += 1
        report = ProfitReport(
            timestamp=datetime.now().strftime("%Y-%m-%d %H:%M"),
            total_trades=len(trades),
            total_pnl=sum(t.get("pnl_krw", 0) for t in trades),
        )

        if len(trades) < 3:
            report.sizing_suggestion = "거래 3건 미만 — 데이터 수집 중"
            self._last_report = report
            return report

        # 5가지 분석 모듈 실행
        report.best_coins, report.worst_coins = self._analyze_coins(trades)
        report.best_strategies = self._analyze_strategies(trades)
        report.exploration_stars = self._find_exploration_stars(exploration_slots)
        report.sizing_suggestion = self._analyze_sizing(trades)
        report.actions = self._generate_actions(
            trades, positions, exploration_slots, report
        )

        self._last_report = report
        self._print_report(report)
        self._save_report(report)
        return report

    # ── 1. 코인별 수익성 분석 ─────────────────────────────────

    def _analyze_coins(
        self, trades: List[dict],
    ) -> Tuple[List[dict], List[dict]]:
        """코인별 수익성 순위 → 최고/최저 코인."""
        by_coin = defaultdict(list)
        for t in trades:
            by_coin[t.get("coin", "?")].append(t)

        coin_stats = []
        for coin, ts in by_coin.items():
            total_pnl = sum(t.get("pnl_krw", 0) for t in ts)
            wins = sum(1 for t in ts if t.get("pnl_pct", 0) > 0)
            wr = wins / len(ts) * 100 if ts else 0
            avg_pnl = sum(t.get("pnl_pct", 0) for t in ts) / len(ts)
            coin_stats.append({
                "coin": coin, "trades": len(ts),
                "win_rate": round(wr, 1),
                "total_pnl": round(total_pnl),
                "avg_pnl": round(avg_pnl, 2),
            })

        ranked = sorted(coin_stats, key=lambda x: x["total_pnl"], reverse=True)
        best = [c for c in ranked if c["total_pnl"] > 0][:5]
        worst = [c for c in ranked if c["total_pnl"] < 0][-5:]
        return best, worst

    # ── 2. 전략별 수익성 분석 ─────────────────────────────────

    def _analyze_strategies(self, trades: List[dict]) -> List[dict]:
        """전략별 수익성 → RR ratio, PF 계산."""
        by_strat = defaultdict(list)
        for t in trades:
            by_strat[t.get("strategy", "?")].append(t)

        strat_stats = []
        for strat, ts in by_strat.items():
            wins = [t for t in ts if t.get("pnl_pct", 0) > 0]
            losses = [t for t in ts if t.get("pnl_pct", 0) <= 0]
            avg_win = (sum(t["pnl_pct"] for t in wins) / len(wins)
                       if wins else 0)
            avg_loss = (sum(t["pnl_pct"] for t in losses) / len(losses)
                        if losses else 0)
            gross_profit = sum(t["pnl_krw"] for t in wins)
            gross_loss = abs(sum(t["pnl_krw"] for t in losses))
            pf = (gross_profit / gross_loss) if gross_loss > 0 else 999
            rr = abs(avg_win / avg_loss) if avg_loss != 0 else 999
            strat_stats.append({
                "strategy": strat, "trades": len(ts),
                "win_rate": round(len(wins) / len(ts) * 100, 1),
                "avg_win": round(avg_win, 2),
                "avg_loss": round(avg_loss, 2),
                "rr_ratio": round(rr, 2),
                "profit_factor": round(min(pf, 99), 2),
                "total_pnl": round(sum(t["pnl_krw"] for t in ts)),
            })
        return sorted(strat_stats, key=lambda x: x["total_pnl"], reverse=True)

    # ── 3. 탐색 슬롯 우수 변형 조기 감지 ─────────────────────

    def _find_exploration_stars(
        self, exp_slots: List[dict],
    ) -> List[dict]:
        """탐색 슬롯 중 유망한 변형을 조기에 감지한다."""
        stars = []
        for s in exp_slots:
            tc = s.get("trade_count", 0)
            if tc < 2:
                continue
            wr = s.get("win_rate", 0)
            pf = s.get("profit_factor", 0)
            pnl = s.get("total_pnl_krw", 0)
            # 조기 유망 기준: 5건 이상 + 승률 60%+ 또는 3건 이상 + PnL 양수
            if (tc >= 5 and wr >= 60) or (tc >= 3 and pnl > 0):
                stars.append({
                    "variant_id": s.get("variant_id", ""),
                    "type": s.get("variant_type", ""),
                    "coin": s.get("coin", ""),
                    "description": s.get("description", ""),
                    "trades": tc,
                    "win_rate": wr,
                    "profit_factor": pf,
                    "total_pnl": pnl,
                    "readiness": min(tc / 20 * 100, 100),
                })
        return sorted(stars, key=lambda x: x["total_pnl"], reverse=True)

    # ── 4. 포지션 사이징 분석 ─────────────────────────────────

    def _analyze_sizing(self, trades: List[dict]) -> str:
        """포지션 사이징 패턴 분석 → 개선 제안."""
        wins = [t for t in trades if t.get("pnl_pct", 0) > 0]
        losses = [t for t in trades if t.get("pnl_pct", 0) <= 0]
        if not wins or not losses:
            return "승/패 데이터 부족"

        avg_win_size = sum(t.get("invested_krw", 0) for t in wins) / len(wins)
        avg_loss_size = sum(t.get("invested_krw", 0) for t in losses) / len(losses)

        if avg_loss_size > avg_win_size * 1.3:
            ratio = avg_loss_size / max(avg_win_size, 1)
            return (f"패배 포지션이 승리의 {ratio:.1f}배 → "
                    f"손실 포지션 축소 필요")
        elif avg_win_size > avg_loss_size * 1.5:
            return "포지션 사이징 양호 — 승리 시 더 크게 베팅 중"
        else:
            return "포지션 균등 — 승리 조건에서 사이즈 확대 권장"

    # ── 5. 액션 생성 ─────────────────────────────────────────

    def _generate_actions(
        self,
        trades: List[dict],
        positions: List[dict],
        exp_slots: List[dict],
        report: ProfitReport,
    ) -> List[ProfitAction]:
        """분석 결과를 구체적 액션으로 변환한다."""
        actions = []

        # 액션 1: 수익 코인에 자본 집중
        for coin in report.best_coins[:3]:
            if coin["trades"] >= 3 and coin["win_rate"] >= 60:
                actions.append(ProfitAction(
                    action_type="BOOST",
                    target=coin["coin"],
                    reason=f"{coin['trades']}건 WR={coin['win_rate']}% "
                           f"PnL={coin['total_pnl']:+,}원",
                    expected_impact=coin["total_pnl"] * 0.5,
                    confidence=min(coin["trades"] / 20, 1.0),
                ))

        # 액션 2: 손실 코인 축소/차단
        for coin in report.worst_coins:
            if coin["trades"] >= 3 and coin["win_rate"] < 35:
                actions.append(ProfitAction(
                    action_type="REDUCE",
                    target=coin["coin"],
                    reason=f"{coin['trades']}건 WR={coin['win_rate']}% "
                           f"PnL={coin['total_pnl']:+,}원",
                    expected_impact=abs(coin["total_pnl"]) * 0.3,
                    confidence=min(coin["trades"] / 10, 1.0),
                ))

        # 액션 3: 탐색 슬롯 유망주 조기 승격 추천
        for star in report.exploration_stars[:3]:
            if star["readiness"] >= 50:
                actions.append(ProfitAction(
                    action_type="PROMOTE",
                    target=star["variant_id"],
                    reason=f"{star['description'][:30]} | "
                           f"{star['trades']}건 WR={star['win_rate']:.0f}% "
                           f"PnL={star['total_pnl']:+,.0f}원",
                    expected_impact=star["total_pnl"] * 2,
                    confidence=star["readiness"] / 100,
                ))

        # 액션 4: 최적 RR ratio 전략으로 전환 추천
        for strat in report.best_strategies:
            if (strat["trades"] >= 5 and strat["rr_ratio"] >= 1.5
                    and strat["profit_factor"] >= 1.3):
                actions.append(ProfitAction(
                    action_type="SWITCH",
                    target=strat["strategy"],
                    reason=f"RR={strat['rr_ratio']:.1f} PF={strat['profit_factor']:.1f} "
                           f"WR={strat['win_rate']}%",
                    expected_impact=strat["total_pnl"],
                    confidence=min(strat["trades"] / 20, 1.0),
                ))

        return sorted(actions, key=lambda a: a.expected_impact, reverse=True)

    # ── 출력 / 저장 ──────────────────────────────────────────

    def _print_report(self, report: ProfitReport) -> None:
        """콘솔 보고서 출력."""
        print(f"\n{'═' * 60}")
        print(f"  이익 최대화 에이전트 | {report.timestamp}")
        print(f"  거래 {report.total_trades}건 | "
              f"총 PnL {report.total_pnl:+,.0f}원")
        print(f"{'═' * 60}")

        if report.best_coins:
            print(f"  수익 코인:")
            for c in report.best_coins[:3]:
                print(f"    {c['coin']:>6} | {c['trades']}건 "
                      f"WR={c['win_rate']}% | {c['total_pnl']:+,.0f}원")

        if report.worst_coins:
            print(f"  손실 코인:")
            for c in report.worst_coins[:3]:
                print(f"    {c['coin']:>6} | {c['trades']}건 "
                      f"WR={c['win_rate']}% | {c['total_pnl']:+,.0f}원")

        if report.exploration_stars:
            print(f"  탐색 유망주:")
            for s in report.exploration_stars[:3]:
                print(f"    {s['variant_id']} | {s['coin']} | "
                      f"{s['trades']}건 WR={s['win_rate']:.0f}% | "
                      f"{s['total_pnl']:+,.0f}원 | "
                      f"준비도 {s['readiness']:.0f}%")

        print(f"  사이징: {report.sizing_suggestion}")

        if report.actions:
            print(f"  ── 액션 ({len(report.actions)}개) ──")
            for a in report.actions[:5]:
                print(f"    [{a.action_type:>7}] {a.target:>10} | "
                      f"{a.reason[:40]} | "
                      f"기대 {a.expected_impact:+,.0f}원 "
                      f"(신뢰 {a.confidence:.0%})")
        print(f"{'═' * 60}")

    def _save_report(self, report: ProfitReport) -> None:
        """보고서를 JSON으로 저장한다."""
        path = ".claude/memory/profit_maximizer_log.json"
        try:
            entry = {
                "timestamp": report.timestamp,
                "total_trades": report.total_trades,
                "total_pnl": report.total_pnl,
                "best_coins": report.best_coins[:3],
                "worst_coins": report.worst_coins[:3],
                "exploration_stars": report.exploration_stars[:3],
                "sizing": report.sizing_suggestion,
                "actions": [
                    {"type": a.action_type, "target": a.target,
                     "reason": a.reason, "impact": a.expected_impact}
                    for a in report.actions[:5]
                ],
            }
            import os
            history = []
            if os.path.exists(path):
                with open(path) as f:
                    history = json.load(f)
                if not isinstance(history, list):
                    history = [history]
            history.append(entry)
            # 최근 100건만 유지
            history = history[-100:]
            with open(path, "w") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug(f"보고서 저장 실패: {e}")


# ── 포트폴리오 매니저 통합용 래퍼 ────────────────────────────

def apply_profit_actions(
    manager, actions: List[ProfitAction],
) -> int:
    """ProfitAction을 포트폴리오 매니저에 실제 적용한다."""
    applied = 0
    for action in actions:
        if action.confidence < 0.5:
            continue  # 신뢰도 50% 미만은 건너뜀

        if action.action_type == "BOOST":
            _apply_boost(manager, action)
            applied += 1
        elif action.action_type == "REDUCE":
            _apply_reduce(manager, action)
            applied += 1

    return applied


def _apply_boost(manager, action: ProfitAction) -> None:
    """수익 코인의 배분 가중치를 올린다."""
    coin = action.target
    if coin in manager._slots:
        slot = manager._slots[coin]
        old_w = slot.allocation_weight
        slot.allocation_weight = min(old_w * 1.3, config.ALLOC_MAX_WEIGHT)
        logger.info(f"[이익극대] {coin} 가중치 {old_w:.2f}→"
                    f"{slot.allocation_weight:.2f} ({action.reason})")


def _apply_reduce(manager, action: ProfitAction) -> None:
    """손실 코인의 배분 가중치를 내린다."""
    coin = action.target
    if coin in manager._slots:
        slot = manager._slots[coin]
        old_w = slot.allocation_weight
        slot.allocation_weight = max(old_w * 0.7, config.ALLOC_MIN_WEIGHT)
        logger.info(f"[이익극대] {coin} 가중치 {old_w:.2f}→"
                    f"{slot.allocation_weight:.2f} ({action.reason})")

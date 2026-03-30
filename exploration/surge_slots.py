"""급등주 전용 슬롯 — 10개 포트로 급등 코인만 추적하고 거래마다 학습한다.

작동 원리:
  1. SurgeDetector가 IGNITION/ACCELERATION 감지하면 즉시 진입
  2. 트레일링 스탑으로 수익 추적, CLIMAX 도달 전 청산
  3. 매 거래 종료 시 SurgeLearner가 인사이트 기록
  4. 학습된 패턴으로 다음 급등 진입/청산 최적화

학습 항목:
  - 어떤 코인이 급등 빈도가 높은가
  - IGNITION vs ACCELERATION 어디서 진입이 유리한가
  - 최적 트레일링 스탑 %는 얼마인가
  - 보유 시간과 수익의 관계
  - 급등 후 얼마나 빨리 빠져야 하는가
"""
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional
from collections import defaultdict

import config

logger = logging.getLogger("surge_slots")


@dataclass
class SurgeTrade:
    """급등 거래 기록."""
    coin: str
    phase: str            # IGNITION / ACCELERATION
    entry_price: float
    exit_price: float = 0
    entry_time: str = ""
    exit_time: str = ""
    invested_krw: float = 0
    pnl_pct: float = 0
    pnl_krw: float = 0
    hold_seconds: int = 0
    trailing_high: float = 0
    exit_reason: str = ""   # TRAILING_STOP / TIME_LIMIT / CLIMAX / TP


@dataclass
class SurgeSlot:
    """급등 전용 슬롯."""
    coin: str
    trader: object  # AdaptivePaperTrader
    phase: str      # 진입 시점의 급등 페이즈
    entry_time: str = ""
    allocated_krw: float = 0


class SurgeLearner:
    """급등 거래 학습 엔진 — 매 거래 종료 시 패턴을 분석하고 인사이트에 기록."""

    INSIGHTS_PATH = ".claude/memory/surge_insights.json"

    def __init__(self) -> None:
        self._trades: List[SurgeTrade] = []
        self._load_history()

    def record(self, trade: SurgeTrade) -> Dict:
        """거래 기록 + 인사이트 추출."""
        self._trades.append(trade)
        insight = self._analyze_trade(trade)
        self._save_history()
        self._save_to_main_insights(trade, insight)
        return insight

    def get_optimal_params(self) -> Dict:
        """학습된 최적 파라미터 반환."""
        if len(self._trades) < 5:
            return {"trailing_pct": 2.0, "max_hold_sec": 1800}

        # 수익 거래만 분석
        wins = [t for t in self._trades if t.pnl_pct > 0]
        if not wins:
            return {"trailing_pct": 2.0, "max_hold_sec": 1800}

        avg_hold = sum(t.hold_seconds for t in wins) / len(wins)
        avg_high = sum(
            (t.trailing_high - t.entry_price) / t.entry_price * 100
            for t in wins if t.entry_price > 0
        ) / len(wins)

        # 최적 트레일링: 최고점 평균의 40% (너무 타이트하면 조기 청산)
        optimal_trail = max(1.0, avg_high * 0.4)
        optimal_hold = min(3600, int(avg_hold * 1.5))

        return {
            "trailing_pct": round(optimal_trail, 1),
            "max_hold_sec": optimal_hold,
        }

    def get_stats(self) -> Dict:
        """학습 통계 반환."""
        if not self._trades:
            return {"total": 0}
        wins = [t for t in self._trades if t.pnl_pct > 0]
        by_phase = defaultdict(list)
        for t in self._trades:
            by_phase[t.phase].append(t)
        by_coin = defaultdict(list)
        for t in self._trades:
            by_coin[t.coin].append(t)

        # 코인별 급등 빈도 TOP 5
        coin_freq = sorted(
            by_coin.items(), key=lambda x: len(x[1]), reverse=True
        )[:5]

        return {
            "total": len(self._trades),
            "wins": len(wins),
            "win_rate": round(len(wins) / len(self._trades) * 100, 1),
            "total_pnl": round(sum(t.pnl_krw for t in self._trades)),
            "avg_pnl_pct": round(
                sum(t.pnl_pct for t in self._trades) / len(self._trades), 2
            ),
            "avg_hold_sec": round(
                sum(t.hold_seconds for t in self._trades) / len(self._trades)
            ),
            "by_phase": {
                phase: {
                    "count": len(ts),
                    "win_rate": round(
                        sum(1 for t in ts if t.pnl_pct > 0) / len(ts) * 100, 1
                    ),
                    "avg_pnl": round(
                        sum(t.pnl_pct for t in ts) / len(ts), 2
                    ),
                }
                for phase, ts in by_phase.items()
            },
            "top_coins": [
                {"coin": coin, "count": len(ts)}
                for coin, ts in coin_freq
            ],
        }

    def _analyze_trade(self, trade: SurgeTrade) -> Dict:
        """개별 거래 인사이트 추출."""
        insight = {
            "coin": trade.coin,
            "phase": trade.phase,
            "win": trade.pnl_pct > 0,
            "pnl_pct": trade.pnl_pct,
            "hold_seconds": trade.hold_seconds,
            "exit_reason": trade.exit_reason,
        }

        # 패턴 진단
        if trade.pnl_pct > 5:
            insight["diagnosis"] = "대성공 — 급등 초기 포착 + 충분히 홀딩"
        elif trade.pnl_pct > 1:
            insight["diagnosis"] = "양호 — 급등 수익 확보"
        elif trade.pnl_pct > 0:
            insight["diagnosis"] = "미미 — 수수료 수준, 트레일링 조정 필요"
        elif trade.hold_seconds < 60:
            insight["diagnosis"] = "가짜 급등 — 1분 내 반전, 필터 강화 필요"
        elif trade.exit_reason == "TRAILING_STOP":
            insight["diagnosis"] = "트레일링 청산 — 트레일링 % 검토"
        else:
            insight["diagnosis"] = "급등 실패 — 진입 타이밍 또는 코인 선택 문제"

        logger.info(
            f"[급등학습] {trade.coin} | {trade.phase} | "
            f"{trade.pnl_pct:+.2f}% | {trade.hold_seconds}초 | "
            f"{insight['diagnosis']}"
        )
        return insight

    def _save_to_main_insights(self, trade: SurgeTrade, insight: Dict) -> None:
        """메인 인사이트 시스템에 급등 거래 기록."""
        main_path = ".claude/memory/trade_insights.json"
        try:
            entries = []
            if os.path.exists(main_path):
                with open(main_path) as f:
                    raw = json.load(f)
                entries = raw if isinstance(raw, list) else raw.get("entries", [])

            entries.append({
                "timestamp": datetime.now().isoformat(),
                "coin": trade.coin,
                "strategy": f"SURGE_{trade.phase}",
                "category": "SURGE_WIN" if trade.pnl_pct > 0 else "SURGE_LOSS",
                "win": trade.pnl_pct > 0,
                "pnl_pct": trade.pnl_pct,
                "pnl_krw": trade.pnl_krw,
                "hold_minutes": trade.hold_seconds / 60,
                "diagnosis": insight.get("diagnosis", ""),
                "entry_regime": trade.phase,
                "volatility_tier": "EXTREME",
            })

            with open(main_path, "w") as f:
                json.dump(entries[-500:], f, ensure_ascii=False)
        except Exception as e:
            logger.debug(f"메인 인사이트 저장 실패: {e}")

    def _load_history(self) -> None:
        """이전 급등 거래 이력 로드."""
        if os.path.exists(self.INSIGHTS_PATH):
            try:
                with open(self.INSIGHTS_PATH) as f:
                    raw = json.load(f)
                trades = raw.get("trades", [])
                for t in trades:
                    self._trades.append(SurgeTrade(**t))
            except Exception:
                pass

    def _save_history(self) -> None:
        """급등 거래 이력 저장."""
        try:
            data = {
                "updated_at": datetime.now().isoformat(),
                "stats": self.get_stats(),
                "optimal_params": self.get_optimal_params(),
                "trades": [
                    {
                        "coin": t.coin, "phase": t.phase,
                        "entry_price": t.entry_price,
                        "exit_price": t.exit_price,
                        "entry_time": t.entry_time,
                        "exit_time": t.exit_time,
                        "invested_krw": t.invested_krw,
                        "pnl_pct": t.pnl_pct, "pnl_krw": t.pnl_krw,
                        "hold_seconds": t.hold_seconds,
                        "trailing_high": t.trailing_high,
                        "exit_reason": t.exit_reason,
                    }
                    for t in self._trades[-200:]  # 최근 200건
                ],
            }
            os.makedirs(os.path.dirname(self.INSIGHTS_PATH), exist_ok=True)
            with open(self.INSIGHTS_PATH, "w") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug(f"급등 이력 저장 실패: {e}")


class SurgeSlotManager:
    """급등 전용 10개 슬롯 매니저.

    SurgeDetector에서 IGNITION/ACCELERATION 알림 → 즉시 진입.
    트레일링 스탑으로 수익 추적. 매 거래 후 SurgeLearner가 학습.
    """

    def __init__(
        self, capital: float, max_slots: int = 10,
        verbose: bool = False,
    ) -> None:
        self._capital = capital
        self._max_slots = max_slots
        self._per_slot = capital / max_slots
        self._verbose = verbose
        self._slots: Dict[str, SurgeSlot] = {}
        self._learner = SurgeLearner()
        self._trade_count = 0
        self._total_pnl = 0.0

    def on_surge(self, coin: str, phase: str, price: float) -> bool:
        """급등 알림 수신 → 빈 슬롯에 즉시 진입."""
        if phase == "CLIMAX":
            return False  # CLIMAX는 절대 진입 금지
        if coin in self._slots:
            return False  # 이미 보유 중
        if len(self._slots) >= self._max_slots:
            return False  # 슬롯 풀

        # 학습된 최적 파라미터 적용
        params = self._learner.get_optimal_params()

        # 트레이더 생성
        from paper_trader import AdaptivePaperTrader
        invest = min(self._per_slot, config.POSITION_CAP_EXTREME_KRW)
        trader = AdaptivePaperTrader(
            coin=coin, capital=invest,
            interval_min=config.PAPER_TRADING_INTERVAL_SEC,
            verbose=False, candle_interval="1h",
        )
        trader._managed = True
        trader._suppress_hold_log = True
        trader._volatility_tier = "EXTREME"
        trader._surge_boost = True  # 즉시 진입 모드

        # 간소화 startup
        try:
            df = trader._fetch_ohlcv(200)
            if df is None:
                return False
            from backtest_scalp import compute_indicators, compute_regime
            df = compute_indicators(df)
            regimes = compute_regime(df)
            trader._cached_df = df
            trader._cached_regimes = regimes
            trader._active_strategy_id = "SURGE"
            trader._active_strategy_name = f"SURGE_{phase}"
        except Exception:
            return False

        self._slots[coin] = SurgeSlot(
            coin=coin, trader=trader, phase=phase,
            entry_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            allocated_krw=invest,
        )

        print(f"  🚀 [급등슬롯] {coin} 진입 | {phase} | "
              f"{price:,.0f}원 | {invest:,.0f}원")
        return True

    def trading_cycle(self) -> None:
        """급등 코인 능동 탐색 + 보유 슬롯 매매 사이클."""
        # 1. 능동 탐색: 빈 슬롯이 있으면 급등 코인 스캔
        if len(self._slots) < self._max_slots:
            self._scan_for_surges()

        # 2. 보유 슬롯 매매 사이클
        for coin in list(self._slots.keys()):
            slot = self._slots[coin]
            prev_trades = len(slot.trader._trades)

            try:
                slot.trader._safe_trading_cycle()
            except Exception as e:
                if self._verbose:
                    logger.debug(f"[급등] {coin} 사이클 오류: {e}")

            # 거래 완료 감지 → 학습
            if len(slot.trader._trades) > prev_trades:
                for trade in slot.trader._trades[prev_trades:]:
                    self._record_trade(slot, trade)

            # 포지션 없으면 슬롯 해제
            if slot.trader._position is None and len(slot.trader._trades) > 0:
                del self._slots[coin]

    def _scan_for_surges(self) -> None:
        """빗썸 전체 코인에서 급등 중인 코인을 능동 발굴한다."""
        try:
            from exchange.bithumb_client import BithumbClient
            client = BithumbClient("", "")

            # 전체 코인 시세 조회
            import pybithumb
            all_tickers = pybithumb.get_tickers()
            if not all_tickers:
                return

            surges = []
            for coin in all_tickers:
                if coin in self._slots:
                    continue
                try:
                    df = pybithumb.get_candlestick(coin, chart_intervals="1m")
                    if df is None or len(df) < 5:
                        continue
                    # 최근 5분간 가격 변화
                    recent = df.tail(5)
                    price_change = (
                        (float(recent["close"].iloc[-1]) - float(recent["close"].iloc[0]))
                        / float(recent["close"].iloc[0]) * 100
                    )
                    # 거래량 변화
                    vol_avg = float(df["volume"].tail(20).mean())
                    vol_now = float(df["volume"].iloc[-1])
                    vol_mult = vol_now / vol_avg if vol_avg > 0 else 0

                    if price_change >= 2.0 and vol_mult >= 2.0:
                        surges.append({
                            "coin": coin,
                            "price_change": price_change,
                            "vol_mult": vol_mult,
                            "price": float(recent["close"].iloc[-1]),
                        })
                except Exception:
                    continue

            # 가장 급등 중인 코인부터 진입
            surges.sort(key=lambda x: x["price_change"], reverse=True)
            for s in surges[:3]:  # 한 사이클에 최대 3개
                if len(self._slots) >= self._max_slots:
                    break
                phase = "ACCELERATION" if s["price_change"] >= 3.0 else "IGNITION"
                self.on_surge(s["coin"], phase, s["price"])
        except Exception as e:
            if self._verbose:
                logger.debug(f"[급등스캔] 오류: {e}")

    def _record_trade(self, slot: SurgeSlot, trade) -> None:
        """거래 완료 → SurgeLearner에 기록."""
        entry_time = slot.entry_time
        now = datetime.now()
        try:
            et = datetime.strptime(entry_time, "%Y-%m-%d %H:%M:%S")
            hold_sec = int((now - et).total_seconds())
        except Exception:
            hold_sec = 0

        surge_trade = SurgeTrade(
            coin=slot.coin,
            phase=slot.phase,
            entry_price=trade.entry_price,
            exit_price=trade.exit_price,
            entry_time=entry_time,
            exit_time=now.strftime("%Y-%m-%d %H:%M:%S"),
            invested_krw=trade.invested_krw,
            pnl_pct=trade.pnl_pct,
            pnl_krw=trade.pnl_krw,
            hold_seconds=hold_sec,
            trailing_high=getattr(trade, "trailing_high", trade.exit_price),
            exit_reason=trade.exit_reason,
        )

        insight = self._learner.record(surge_trade)
        self._trade_count += 1
        self._total_pnl += trade.pnl_krw

        print(f"  🚀 [급등학습] {slot.coin} | {slot.phase} | "
              f"{trade.pnl_pct:+.2f}% | {trade.pnl_krw:+,.0f}원 | "
              f"{hold_sec}초 | {insight.get('diagnosis', '')}")

    def get_status(self) -> Dict:
        """대시보드용 상태."""
        stats = self._learner.get_stats()
        return {
            "active_slots": len(self._slots),
            "max_slots": self._max_slots,
            "capital": self._capital,
            "trade_count": self._trade_count,
            "total_pnl": round(self._total_pnl),
            "learning_stats": stats,
            "optimal_params": self._learner.get_optimal_params(),
            "slots": [
                {"coin": s.coin, "phase": s.phase,
                 "entry_time": s.entry_time,
                 "allocated_krw": s.allocated_krw}
                for s in self._slots.values()
            ],
        }

"""멀티코인 페이퍼 포트폴리오 매니저 — 3단계 파이프라인으로 코인을 조율한다.

3단계 파이프라인:
  [스크리닝 풀 453개] → [대기석 최대 20개] → [활성 슬롯 5개]

고정 슬롯(BTC, ETH) + 동적 슬롯 3개로 운영하며,
대기석에서 2시간 이상 모니터링 후 승격한다.

사용법:
  python3 paper_portfolio_manager.py --capital 10000000 --verbose
  python3 paper_portfolio_manager.py --capital 10000000 --end-time "2026-03-11 07:00"
"""
import argparse
import json
import os
import signal as signal_mod
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set

import schedule

import config
from dashboard.shared_state import PaperStateWriter
from market_intel.daily_report import generate_daily_report, load_latest_prediction
from market_intel.data_collector import MarketDataCollector
from market_intel.signal_aggregator import SignalAggregator, MarketPrediction
from market_intel.whale_tracker import WhaleTracker
from market_intel.realtime_whale import RealtimeWhaleDetector, WhaleAlert
from market_intel.surge_detector import (
    SurgeDetector, SurgeAlert, PHASE_IGNITION, PHASE_ACCELERATION, PHASE_CLIMAX
)
from risk.daily_loss_guard import DailyLossGuard
from strategy.strategy_selector import StrategySelector
from strategy.mtf_filter import compute_higher_tf_trend
from paper_trader import AdaptivePaperTrader, PaperTrade
from screener.coin_screener import CoinScreener, CoinScore
from screener.interval_classifier import (
    classify_interval,
    classify_interval_by_symbol,
)
from screener.waiting_bench import WaitingBench, BenchCoin
from tools.weekly_trend_learner import run_weekly_learning


@dataclass
class PaperCoinSlot:
    """활성 코인 슬롯 상태."""
    coin: str
    trader: AdaptivePaperTrader
    allocated_krw: float
    activated_at: datetime
    allocation_weight: float = 1.0  # 배분 가중치 (0.5~1.8)
    draining: bool = False          # True → 신규 진입 차단, 포지션 청산 후 제거
    drain_reason: str = ""
    interval: str = "1h"            # 캔들 간격 (1h/30m/10m)
    is_fixed: bool = False          # True → 고정 슬롯 (BTC/ETH, 교체 불가)

    @property
    def stay_hours(self) -> float:
        """활성 슬롯 체류 시간 (시간)."""
        return (datetime.now() - self.activated_at).total_seconds() / 3600


class PaperPortfolioManager:
    """멀티코인 페이퍼 트레이딩 오케스트레이터 (3단계 파이프라인).

    3단계 파이프라인:
      [스크리닝 풀] → [대기석(Bench)] → [활성 슬롯]

    슬롯 구성:
      1-2: 고정 (BTC, ETH) — 절대 교체 안 함
      3-5: 동적 — 대기석에서 승격, 최소 6시간 체류

    라이프사이클:
      1. startup() — 고정 슬롯 활성화 + 스캔 + 대기석 → 동적 슬롯
      2. run() — 스케줄러 루프 (매 1분 트레이딩, 매 5분 스캔)
      3. shutdown() — 전체 포지션 청산 + 최종 보고서
    """

    def __init__(
        self,
        initial_capital: float = config.PAPER_INITIAL_KRW,
        max_positions: int = config.MAX_POSITIONS,
        scan_interval_min: int = config.PAPER_SCAN_INTERVAL_MINUTES,
        trading_interval_sec: int = config.PAPER_TRADING_INTERVAL_SEC,
        report_interval_min: int = config.PAPER_REPORT_INTERVAL_MIN,
        verbose: bool = False,
        end_time: Optional[datetime] = None,
    ) -> None:
        self._initial_capital = max(initial_capital, 1.0)
        self._unallocated_krw = self._initial_capital
        self._max_positions = max(max_positions, 1)
        self._per_coin_krw = self._initial_capital / self._max_positions
        self._scan_interval_min = scan_interval_min
        self._trading_interval_sec = trading_interval_sec
        self._report_interval_min = report_interval_min
        self._verbose = verbose
        self._end_time = end_time

        # 3단계 파이프라인 구성
        self._fixed_coins = set(config.FIXED_SLOTS)  # {"BTC", "ETH", "SOL"}
        self._bench = WaitingBench(max_size=config.BENCH_MAX_SIZE)

        # 외부 컴포넌트
        self._screener = CoinScreener(
            min_volume_krw=config.SCREENER_MIN_VOLUME_KRW,
            min_range_pct=config.SCREENER_MIN_RANGE_PCT,
            top_volume_n=config.SCREENER_TOP_VOLUME_N,
        )

        # 시장 인텔리전스
        self._intel_collector = MarketDataCollector()
        self._intel_aggregator = SignalAggregator()
        self._latest_prediction: Optional[MarketPrediction] = None
        self._last_intel_time: Optional[datetime] = None

        # 고래 추적 + 전략 선택 + 일일 가드
        self._whale_tracker = WhaleTracker()  # 폴백: REST 기반 스캔
        self._realtime_whale = RealtimeWhaleDetector(
            whale_mult=5.0,
            whale_min_krw=1_000_000,
            on_whale_alert=self._on_whale_alert,
        )
        self._strategy_selector = StrategySelector()
        self._daily_guard = DailyLossGuard()
        self._last_whale_scan: Optional[datetime] = None

        # ★ 실시간 급등 감지기
        self._surge_detector = SurgeDetector(
            price_surge_1m_pct=config.SURGE_PRICE_1M_PCT,
            price_surge_5m_pct=config.SURGE_PRICE_5M_PCT,
            volume_surge_mult=config.SURGE_VOLUME_MULT,
            climax_pct=config.SURGE_CLIMAX_PCT,
            alert_cooldown_sec=config.SURGE_ALERT_COOLDOWN_SEC,
            max_surge_age_sec=config.SURGE_MAX_AGE_SEC,
            on_surge_alert=self._on_surge_alert,
        ) if config.SURGE_DETECTION_ENABLED else None

        # 상태
        self._slots: Dict[str, PaperCoinSlot] = {}
        self._blacklist: Dict[str, datetime] = {}  # coin → 차단 만료 시각
        self._whale_protected: Set[str] = set()    # 고래 보호 코인 (드레인 유예)
        self._whale_protect_until: Dict[str, datetime] = {}  # coin → 보호 만료
        self._running = False
        self._scan_count = 0
        self._cycle_count = 0
        # ★ 이벤트 기반 학습: 거래 누적 카운터
        self._trades_since_last_adapt = 0
        self._adapt_trade_trigger = getattr(
            config, "ADAPTIVE_TRADE_TRIGGER", 5
        )

        # 쓰레드 안전: 고래 콜백(별도 쓰레드)과 메인 루프 간 동기화
        self._slot_lock = threading.Lock()

    # ── 라이프사이클 ──────────────────────────────────────────

    def startup(self) -> bool:
        """파이프라인 초기화: 스캔 → 대기석 → 슬롯 자동 채우기."""
        self._print_header()

        # Step 1: 고정 슬롯 활성화 (설정된 경우에만)
        fixed_activated = 0
        if config.FIXED_SLOTS:
            print("\n[고정] 고정 슬롯 활성화 중...")
            for coin in config.FIXED_SLOTS:
                interval = classify_interval_by_symbol(coin)
                if self._try_activate_fixed(coin, interval):
                    fixed_activated += 1
                    print(f"  ✓ {coin} (고정, 간격: {interval})")
                else:
                    print(f"  ✗ {coin} 활성화 실패 — 재시도 예정")

        # Step 2: 스크리닝 풀 스캔
        print("\n[스캔] 초기 코인 스크리닝 중...")
        scores = self._screener.scan()
        self._scan_count += 1

        if not scores:
            print("[경고] 스크리너 결과 없음")
        else:
            print(f"[스캔] 후보 {len(scores)}개 발견")

        # Step 3: 대기석(벤치) 채우기
        bench_added = 0
        for score in (scores or []):
            if score.symbol in self._slots:
                continue
            if self._bench.add(score):
                bench_added += 1
        if bench_added > 0:
            print(f"[벤치] {bench_added}개 코인 대기석 추가")

        # Step 4: 슬롯 채우기 (startup 시에는 대기시간 면제)
        available = self._max_positions - len(self._slots)

        if available > 0 and scores:
            print(f"\n[슬롯] {available}개 슬롯 채우기 시도 (startup 대기 면제)")
            activated = 0
            candidates = [
                s for s in scores
                if s.symbol not in self._slots
                and s.symbol not in self._blacklist
            ]
            for score in candidates:
                if activated >= available:
                    break
                interval = classify_interval(score)
                if self._try_activate(score, interval):
                    activated += 1
                    print(f"  ✓ {score.symbol} (간격: {interval}, "
                          f"변동폭: {score.range_pct:.1f}%)")

        total_active = len(self._slots)
        if total_active == 0:
            print("[오류] 활성화된 코인이 없습니다")
            return False

        # 가중치 기반 재배분
        print(f"\n[배분] 전략 품질 + 변동폭 기반 스마트 배분")
        self._rebalance_allocations()

        print(f"\n[시작] {total_active}개 코인 활성화 완료")
        for coin, slot in self._slots.items():
            strategy = slot.trader._active_strategy_name
            print(f"  {coin}: {strategy} ({slot.interval}) | "
                  f"×{slot.allocation_weight:.2f} → "
                  f"{slot.allocated_krw:,.0f}원")
        print(f"[벤치] 대기석: {len(self._bench)}개 코인 모니터링 중")

        # Step 5: 실시간 고래 감지기 + 급등 감지기 시작
        tracked_coins = list(self._slots.keys())
        bench_coins = [bc.symbol for bc in self._bench.all_coins()]
        all_tracked = list(set(tracked_coins + bench_coins[:10]))
        if all_tracked:
            # ★ 급등 감지기를 고래 감지기에 연동 (동일 WebSocket 공유)
            if self._surge_detector:
                self._realtime_whale.set_surge_detector(self._surge_detector)
                print(f"[급등] 실시간 급등 감지기 활성화 "
                      f"(IGNITION: 1분 {config.SURGE_PRICE_1M_PCT}%+ / "
                      f"볼륨 {config.SURGE_VOLUME_MULT}x+)")
            self._realtime_whale.set_coins(all_tracked)
            self._realtime_whale.start()
            print(f"[고래] 실시간 고래 감지 시작: {len(all_tracked)}개 코인")

        PaperStateWriter.update_portfolio(self)
        return True

    def run(self) -> None:
        """메인 스케줄러 루프."""
        self._running = True

        schedule.every(self._trading_interval_sec).seconds.do(
            self._safe_all_cycles
        )
        schedule.every(self._scan_interval_min).minutes.do(
            self._safe_scan_and_update
        )
        # ★ 퀵 스캔: 1분마다 핫 리스트만 빠르게 재스캔 (~3초)
        quick_min = getattr(config, "PAPER_QUICK_SCAN_INTERVAL_MINUTES", 1)
        schedule.every(quick_min).minutes.do(
            self._safe_quick_scan
        )
        schedule.every(self._report_interval_min).minutes.do(
            self._print_portfolio_report
        )
        # 시장 인텔리전스: 6시간마다 수집 + 분석
        schedule.every(6).hours.do(self._safe_intel_update)
        # 학습 사이클: 6시간마다 전체 코인 적응
        schedule.every(6).hours.do(self._safe_adaptation_cycle)

        # ★ 주간 트렌드 학습: 매주 월요일 03:00
        if config.WEEKLY_LEARNER_ENABLED:
            schedule.every().monday.at(
                config.WEEKLY_LEARNER_TIME
            ).do(self._safe_weekly_learning)
            print(f"[주간학습] 매주 {config.WEEKLY_LEARNER_DAY} "
                  f"{config.WEEKLY_LEARNER_TIME} 자동 실행 예약")

        # 즉시 첫 인텔리전스 수집 + 트레이딩 사이클
        self._safe_intel_update()
        self._safe_all_cycles()

        signal_mod.signal(signal_mod.SIGINT, self._handle_shutdown)
        signal_mod.signal(signal_mod.SIGTERM, self._handle_shutdown)

        # ★ 급등락 코인 실시간 모니터링 타이머
        volatile_check_interval = config.VOLATILE_FAST_CYCLE_SEC
        last_volatile_check = time.time()

        while self._running:
            if self._end_time and datetime.now() >= self._end_time:
                print(f"\n[종료] 종료 시각 도달: {self._end_time}")
                break
            schedule.run_pending()

            # ★ 급등락 코인 포지션 실시간 체크 (10초마다)
            now_ts = time.time()
            if now_ts - last_volatile_check >= volatile_check_interval:
                self._fast_check_volatile_positions()
                self._check_surge_positions()
                last_volatile_check = now_ts

            time.sleep(1)

        self.shutdown()

    def shutdown(self) -> None:
        """전체 포지션 청산 + 최종 보고서."""
        self._running = False
        schedule.clear()

        # 실시간 고래 감지기 중지
        try:
            self._realtime_whale.stop()
        except Exception:
            pass
        print("\n" + "=" * 60)
        print("  포트폴리오 최종 정산")
        print("=" * 60)

        for coin, slot in list(self._slots.items()):
            if slot.trader._position:
                print(f"  [{coin}] 포지션 강제 청산...")
                try:
                    price = getattr(slot.trader, "_last_price", 0)
                    if not price or price <= 0:
                        price = slot.trader._position.entry_price
                    slot.trader._execute_sell(price, "SHUTDOWN")
                except Exception as e:
                    print(f"  [{coin}] 청산 실패: {e}")
            self._unallocated_krw += slot.trader._balance_krw

        self._print_portfolio_report()
        PaperStateWriter.update_portfolio(self)

    def _handle_shutdown(self, signum, frame) -> None:
        """시그널 핸들러."""
        print("\n[시그널] 종료 요청 수신")
        self._running = False

    # ── 트레이딩 사이클 ───────────────────────────────────────

    def _safe_all_cycles(self) -> None:
        """모든 활성 트레이더의 사이클 실행 (쓰레드 안전)."""
        self._cycle_count += 1

        # ★ 거래 수 스냅샷 → 사이클 실행 → 학습 트리거 (단일 lock scope)
        new_trades = 0
        with self._slot_lock:
            trades_before = {}
            for coin, slot in list(self._slots.items()):
                trades_before[coin] = slot.trader._trade_adapter.trade_count

            for coin, slot in list(self._slots.items()):
                # 드레인 중 + 포지션 없으면 스킵
                if slot.draining and slot.trader._position is None:
                    continue
                try:
                    slot.trader.trading_cycle()
                except Exception as e:
                    import traceback
                    print(f"[{coin}] 사이클 오류: {e}")
                    traceback.print_exc()

            # ★ 이벤트 기반 학습: 새 거래가 발생하면 카운트
            for coin, slot in list(self._slots.items()):
                count_now = slot.trader._trade_adapter.trade_count
                prev = trades_before.get(coin, count_now)
                new_trades += max(0, count_now - prev)

        if new_trades > 0:
            self._trades_since_last_adapt += new_trades

            # ★ 거래 완료된 코인 성과 체크 → 자동 차단
            with self._slot_lock:
                for coin in list(trades_before.keys()):
                    prev = trades_before.get(coin, 0)
                    if coin in self._slots:
                        now_count = self._slots[coin].trader._trade_adapter.trade_count
                        if now_count > prev:
                            self._check_coin_performance(coin)

            if self._trades_since_last_adapt >= self._adapt_trade_trigger:
                if self._verbose:
                    print(f"[학습] ★ 이벤트 트리거: {self._trades_since_last_adapt}건 "
                          f"누적 → 즉시 학습 실행")
                self._trades_since_last_adapt = 0
                self._safe_adaptation_cycle()

        # 드레인 완료 슬롯 정리 — 거래 유무와 무관하게 항상 실행
        self._clean_drained()

        # ★ 전략 없는 슬롯 자동 드레인 — 10분 이상 NONE 상태면 교체
        with self._slot_lock:
            self._drain_no_strategy_slots()

        # 대시보드 상태 갱신
        PaperStateWriter.update_portfolio(self)

    def _fast_check_volatile_positions(self) -> None:
        """★ 급등락 코인 포지션 실시간 모니터링 (10초마다).

        HOT/EXTREME 티어의 포지션만 현재가를 조회하여
        트레일링 스탑/SL/TP를 즉시 체크한다.
        일반 트레이딩 사이클(1분)보다 6배 빠르게 반응.
        """
        with self._slot_lock:
            for coin, slot in list(self._slots.items()):
                trader = slot.trader
                if trader._position is None:
                    continue
                if trader._position.volatility_tier == "NORMAL":
                    continue
                try:
                    trader.fast_check_volatile_position()
                except Exception as e:
                    if self._verbose:
                        print(f"  [🔥{coin}] 실시간 체크 오류: {e}")

    # ── 스캔 & 리밸런싱 ───────────────────────────────────────

    def _safe_quick_scan(self) -> None:
        """★ 퀵 스캔 — 핫 리스트 코인만 빠르게 재스캔 (~3초).

        452개 전체(~40초) 대신 30개만 조회하여 급변하는 시장에 빠르게 반응.
        """
        try:
            scores = self._screener.quick_scan()
            if not scores:
                return

            with self._slot_lock:
                # 벤치 점수 갱신
                score_map = {s.symbol: s for s in scores}
                for bc in self._bench.all_coins():
                    if bc.symbol in score_map:
                        s = score_map[bc.symbol]
                        self._bench.update_monitoring(
                            bc.symbol, s.close, s.volume_krw
                        )

                # 슬롯 교체 시도 (급변 감지)
                self._try_swap_weakest()

        except Exception as e:
            if self._verbose:
                print(f"[퀵스캔] 오류: {e}")

    def _safe_scan_and_update(self) -> None:
        """주기적 풀 스캔 — 코인 추가/제거."""
        try:
            self._scan_and_update()
        except Exception as e:
            print(f"[스캔] 오류: {e}")

    def _scan_and_update(self) -> None:
        """주기적 스캔 — 3단계 파이프라인 로직 (고래 추적 통합).

        쓰레드 안전: _slot_lock으로 슬롯/벤치 변경을 보호한다.
        """
        # 일일 손실 가드 체크
        if self._daily_guard.is_trading_blocked():
            status = self._daily_guard.status()
            print(f"[가드] 일일 거래 차단: {status['block_reason']}")
            return

        self._clean_blacklist()
        scores = self._screener.scan()
        self._scan_count += 1

        # 실시간 고래 데이터 반영 (WebSocket 기반, 폴링 폴백)
        self._apply_realtime_whale_data()

        if not scores:
            if self._verbose:
                print(f"[스캔#{self._scan_count}] 후보 0개 — 스킵")
            self._monitor_bench()
            return

        screened_symbols = {s.symbol for s in scores}
        score_map = {s.symbol: s for s in scores}

        if self._verbose:
            current_coins = set(self._slots.keys())
            new_coins = screened_symbols - current_coins
            dropped = current_coins - screened_symbols - {
                c for c, s in self._slots.items() if s.is_fixed
            }
            print(f"[스캔#{self._scan_count}] 후보 {len(scores)}개 | "
                  f"현재 {len(self._slots)}슬롯 | "
                  f"신규 {len(new_coins)}개 | 탈락 {len(dropped)}개")

        # 슬롯/벤치 변경은 락으로 보호 (고래 콜백 쓰레드와 동기화)
        with self._slot_lock:
            # 1) 고정 슬롯 복구 (혹시 실패했거나 없으면)
            self._recover_fixed_slots()

            # 2) 동적 슬롯: 스크리너 탈락 코인 드레인 (고정 슬롯 + 고래 보호 제외)
            self._clean_whale_protection()  # 만료된 고래 보호 정리
            for coin in list(self._slots.keys()):
                slot = self._slots[coin]
                if slot.is_fixed:
                    continue  # 고정 슬롯은 절대 드레인 안 함
                if coin not in screened_symbols and not slot.draining:
                    # ★ 고래 보호 중이면 드레인 유예
                    if coin in self._whale_protected:
                        if self._verbose:
                            remain = self._whale_protect_until.get(coin)
                            mins = (
                                (remain - datetime.now()).total_seconds() / 60
                                if remain else 0
                            )
                            print(f"  🐋🛡️ {coin} 고래 보호 → "
                                  f"드레인 유예 ({mins:.0f}분 남음)")
                        continue
                    self._drain_coin(coin, "스크리너 탈락")

            # 3) 벤치 업데이트: 탈락 제거 + 신규 추가
            self._update_bench(scores, screened_symbols)

            # 4) 벤치 가격/거래량 모니터링
            self._monitor_bench()

            # 5) 빈 동적 슬롯에 벤치 승격 대상 채우기
            self._promote_from_bench()

            # 6) 교체: 벤치 최강 vs 동적 슬롯 최약 비교
            self._try_swap_weakest()

    # ── 자본 배분 ─────────────────────────────────────────────

    def _calc_allocation_weight(
        self, score: CoinScore, trader: AdaptivePaperTrader
    ) -> float:
        """전략 품질 + 변동폭 + 실시간 거래 성과 기반 가중치 계산 (0.5~2.0).

        ★ 가장 성공한 트레이더에 더 많은 자본을 배분한다:
          - 백테스트 품질 (40%)
          - 변동폭 (20%)
          - 실시간 거래 성과 (40%) — 승률 + PnL 기반
        """
        best = trader._last_eval.best if trader._last_eval else None

        # 전략 점수 정규화 (0~1, 30점을 1.0으로 클램프)
        raw_score = best.score if best else 0
        quality = min(1.0, max(0.0, raw_score) / 30.0)

        # 변동폭 정규화 (10%를 1.0으로)
        vol_norm = min(score.range_pct / 10.0, 1.0)

        # ★ 실시간 거래 성과 보정 (거래 10건 이상 시 적용)
        perf_score = 0.5  # 기본값 (데이터 부족)
        live_trades = trader._trades
        if len(live_trades) >= 10:
            wins = sum(1 for t in live_trades if t.pnl_pct > 0)
            wr = wins / len(live_trades)  # 0~1
            avg_pnl = sum(t.pnl_pct for t in live_trades) / len(live_trades)

            # 승률 기여 (0~0.5, WR 60% → 0.5)
            wr_score = min(0.5, max(0.0, (wr - 0.3) / 0.6))
            # 평균 PnL 기여 (0~0.5, +2% → 0.5)
            pnl_score = min(0.5, max(0.0, (avg_pnl + 1) / 6))

            perf_score = wr_score + pnl_score
            perf_score = min(1.0, max(0.0, perf_score))

        # 복합 가중치: 백테스트 40% + 변동폭 20% + 실거래 성과 40%
        raw = (0.4 * quality + 0.2 * vol_norm + 0.4 * perf_score)

        # 거래 수 신뢰도 보정 (20건 미만이면 감소)
        trades_count = best.trades_count if best else 0
        confidence = min(1.0, trades_count / config.ALLOC_CONFIDENCE_TRADES)
        adjusted = raw * (0.6 + 0.4 * confidence)

        return max(config.ALLOC_MIN_WEIGHT,
                   min(config.ALLOC_MAX_WEIGHT, adjusted))

    def _rebalance_allocations(self) -> None:
        """활성 슬롯들의 자본을 가중치 비례로 배분한다.

        ★ 전 슬롯 동적 — 스크리너가 실시간으로 최적 코인 자동 선택.
        성과 좋은 코인에 더 많은 자본 배분 (가중치 기반).
        빈 슬롯 자본은 미배분으로 대기 → 급등 감지 시 즉시 투입.
        """
        if not self._slots:
            return

        # 전체 배분 가능 자본 (포지션 보유 슬롯은 제외)
        total = self._unallocated_krw
        held_slots = []
        for slot in self._slots.values():
            if slot.trader._position is not None:
                # ★ 포지션 보유 슬롯: 재배분에서 제외 (잔액 보호)
                held_slots.append(slot)
            else:
                total += slot.trader._balance_krw
        self._unallocated_krw = 0.0

        # ★ 유동적 코인 수: 활성 코인에 전액 배분, 최소 금액만 예비
        active_count = len(self._slots)
        # 급등 감지 즉시 투입용 예비금 (코인 1개 분량 또는 미배분 잔액)
        min_reserve = config.MIN_COIN_ALLOCATION_KRW
        reserve = min(min_reserve, total * 0.1)  # 최대 10%만 예비
        allocatable = total - reserve
        if allocatable < 0:
            allocatable = total
            reserve = 0
        self._unallocated_krw = reserve

        # 가중치 합 계산
        weight_sum = sum(s.allocation_weight for s in self._slots.values())
        if weight_sum <= 0:
            weight_sum = active_count

        if self._verbose:
            print(f"  [배분] 총 {total:,.0f}원 → "
                  f"활성 {allocatable:,.0f}원 ({active_count}코인) + "
                  f"예비 {reserve:,.0f}원 (급등 투입용)")

        # 가중치 비례 재배분 — ★ 포지션 보유 시 잔액 보호
        for coin, slot in self._slots.items():
            new_alloc = allocatable * (slot.allocation_weight / weight_sum)
            old_balance = slot.trader._balance_krw

            if slot.trader._position is not None:
                # ★ 포지션 보유 중: balance를 건드리지 않음
                # balance는 매수 시 차감, 매도 시 복원 → 실거래 기록 보존
                slot.allocated_krw = old_balance + slot.trader._position.invested_krw
                if self._verbose:
                    print(f"  [{coin}] {old_balance:,.0f}원 유지 "
                          f"(포지션 보유 {slot.trader._position.invested_krw:,.0f}원)")
            else:
                # 포지션 없음: 새 배분금으로 설정
                slot.trader._balance_krw = new_alloc
                slot.allocated_krw = new_alloc
                if self._verbose:
                    diff = new_alloc - old_balance
                    print(f"  [{coin}] {old_balance:,.0f} → "
                          f"{new_alloc:,.0f}원 (×{slot.allocation_weight:.2f}, "
                          f"{diff:+,.0f}원)")

    # ── 코인 관리 ─────────────────────────────────────────────

    def _try_activate(
        self, score: CoinScore, interval: str = "1h"
    ) -> bool:
        """코인 활성화 시도 — 최소 점수 + 최소 자본 충족 시에만."""
        coin = score.symbol

        # ★ 영구 블랙리스트 체크
        if coin in config.PERMANENT_BLACKLIST:
            return False

        # ★ 최소 자본 확인 (코인당 최소 50만원)
        min_alloc = config.MIN_COIN_ALLOCATION_KRW
        if self._unallocated_krw < min_alloc:
            return False

        # 슬롯 상한 확인
        if len(self._slots) >= self._max_positions:
            return False

        allocation = min(self._per_coin_krw, self._unallocated_krw)

        # 트레이더 생성 + 코인별 간격 적용
        trader = AdaptivePaperTrader(
            coin=coin,
            capital=allocation,
            interval_min=self._trading_interval_sec,
            report_min=self._report_interval_min,
            verbose=self._verbose,
            candle_interval=interval,
        )
        trader._managed = True  # 포트폴리오 매니저가 상태 기록 담당

        # ★ 변동성 티어 전달 (스크리너에서 분류한 HOT/EXTREME)
        vol_tier = getattr(score, "volatility_tier", "NORMAL")
        trader._volatility_tier = vol_tier
        if vol_tier != "NORMAL":
            print(f"  🔥 [{coin}] {vol_tier} 코인 — 실시간 대응 모드 활성화 "
                  f"(변동폭 {score.range_pct:.0f}%)")

        # 6전략 평가 (startup)
        success = trader.startup()
        if not success:
            self._add_blacklist(coin, "startup 실패")
            return False

        if not trader._active_strategy_id:
            self._add_blacklist(coin, "양호한 전략 없음")
            return False

        # ★ 레짐 필터 — BEAR 거부, SIDEWAYS는 BULL 부족 시만 허용
        regime = trader._monitor.current_regime
        if regime in ("TRENDING_DOWN", "BEAR"):
            if self._verbose:
                print(f"  ✗ {coin} BEAR 레짐 → 활성화 거부 (BULL 우선)")
            return False
        if regime in ("SIDEWAYS", "RANGING"):
            bull_count = sum(
                1 for s in self._slots.values()
                if not s.is_fixed
                and s.trader._monitor.current_regime in ("TRENDING_UP", "BULL")
            )
            empty_dynamic = self._max_positions - len(self._slots)
            # BULL 슬롯이 충분하면 SIDEWAYS 거부
            if bull_count >= 3 or empty_dynamic <= 0:
                if self._verbose:
                    print(f"  ✗ {coin} SIDEWAYS 레짐 → 거부 "
                          f"(BULL {bull_count}개 충분)")
                return False
            if self._verbose:
                print(f"  △ {coin} SIDEWAYS지만 BULL 부족 "
                      f"({bull_count}개) → 보충 허용")

        # ★ 최소 점수 확인 — 전략 평가 점수가 기준 미달이면 활성화 거부
        best_score = 0.0
        if trader._last_eval and trader._last_eval.best:
            best_score = trader._last_eval.best.score
        if best_score < config.MIN_ACTIVATION_SCORE:
            if self._verbose:
                print(f"  ✗ {coin} 점수 미달 ({best_score:.1f} < "
                      f"{config.MIN_ACTIVATION_SCORE}) — 활성화 거부")
            return False

        # 가중치 계산 + 슬롯 등록
        weight = self._calc_allocation_weight(score, trader)
        self._unallocated_krw -= allocation
        self._slots[coin] = PaperCoinSlot(
            coin=coin,
            trader=trader,
            allocated_krw=allocation,
            activated_at=datetime.now(),
            allocation_weight=weight,
            interval=interval,
            is_fixed=False,
        )

        # 벤치에서 제거 (승격된 경우)
        self._bench.remove(coin)
        return True

    def _try_activate_fixed(self, coin: str, interval: str) -> bool:
        """고정 슬롯 전용 활성화 (BTC/ETH, 블랙리스트 면제)."""
        if coin in config.PERMANENT_BLACKLIST:
            return False
        if coin in self._slots:
            return True  # 이미 활성화됨

        if self._unallocated_krw < self._per_coin_krw * 0.3:
            return False

        allocation = min(self._per_coin_krw, self._unallocated_krw)

        trader = AdaptivePaperTrader(
            coin=coin,
            capital=allocation,
            interval_min=self._trading_interval_sec,
            report_min=self._report_interval_min,
            verbose=self._verbose,
            candle_interval=interval,
        )
        trader._managed = True

        success = trader.startup()
        if not success:
            # 고정 슬롯은 블랙리스트에 넣지 않음 — 다음 스캔에서 재시도
            print(f"[고정] {coin} startup 실패 — 재시도 예정")
            return False

        # 고정 슬롯 가중치: 인사이트 기반 비중 적용 (BTC 50%, SOL 30%, ETH 20%)
        weight = config.FIXED_SLOT_WEIGHTS.get(coin, 1.0)
        if trader._last_eval and trader._last_eval.best:
            raw_score = max(0.0, trader._last_eval.best.score)
            quality_adj = min(1.2, max(0.8, raw_score / 30.0))
            weight *= quality_adj

        self._unallocated_krw -= allocation
        self._slots[coin] = PaperCoinSlot(
            coin=coin,
            trader=trader,
            allocated_krw=allocation,
            activated_at=datetime.now(),
            allocation_weight=weight,
            interval=interval,
            is_fixed=True,
        )
        return True

    def _drain_no_strategy_slots(self) -> None:
        """전략 NONE인 슬롯을 10분 후 자동 드레인 — 슬롯 낭비 방지.

        전략 평가에서 양호한 전략을 못 찾은 코인은 거래 기회 0.
        빠르게 교체하여 수익 가능한 코인에 슬롯을 양보한다.
        """
        min_stay_for_drain = 0.17  # ~10분 (시간 단위)
        for coin in list(self._slots.keys()):
            slot = self._slots[coin]
            if slot.is_fixed or slot.draining:
                continue
            trader = slot.trader
            # 전략이 NONE이고 10분 이상 체류한 슬롯 → 드레인
            if (not trader._active_strategy_id
                    and slot.stay_hours >= min_stay_for_drain):
                if self._verbose:
                    print(f"[자동드레인] {coin} 전략 NONE "
                          f"({slot.stay_hours:.1f}h) → 드레인")
                self._drain_coin(coin, "전략 NONE (자동)")
            # 거래 0건 + 30분 이상 체류 → 드레인 (기회를 못 잡는 코인)
            elif (len(trader._trades) == 0
                  and slot.stay_hours >= 0.5
                  and trader._position is None):
                if self._verbose:
                    print(f"[자동드레인] {coin} 거래 0건 "
                          f"({slot.stay_hours:.1f}h) → 드레인")
                self._drain_coin(coin, "거래 0건 30분 (자동)")

    def _drain_coin(self, coin: str, reason: str) -> None:
        """코인 드레인 모드 전환 (포지션 있으면 청산 대기)."""
        slot = self._slots.get(coin)
        if not slot:
            return

        # 고정 슬롯은 절대 드레인 안 함
        if slot.is_fixed:
            if self._verbose:
                print(f"[드레인] {coin} 고정 슬롯 — 드레인 차단 ({reason})")
            return

        if slot.trader._position is None:
            # 포지션 없으면 즉시 제거
            self._unallocated_krw += slot.trader._balance_krw
            del self._slots[coin]
            print(f"[드레인] {coin} 즉시 제거 ({reason})")
        else:
            slot.draining = True
            slot.drain_reason = reason
            print(f"[드레인] {coin} 드레인 모드 ({reason}), 포지션 청산 대기")

    def _clean_drained(self) -> None:
        """드레인 완료 슬롯 제거 + 자본 회수."""
        for coin in list(self._slots.keys()):
            slot = self._slots[coin]
            if slot.draining and slot.trader._position is None:
                self._unallocated_krw += slot.trader._balance_krw
                print(f"[드레인] {coin} 슬롯 제거 완료, "
                      f"회수: {slot.trader._balance_krw:,.0f}원")
                del self._slots[coin]

    # ── 3단계 파이프라인: 벤치 & 승격 ─────────────────────────

    def _recover_fixed_slots(self) -> None:
        """고정 슬롯 복구 — 누락된 고정 코인 재활성화."""
        for coin in config.FIXED_SLOTS:
            if coin not in self._slots:
                interval = classify_interval_by_symbol(coin)
                if self._try_activate_fixed(coin, interval):
                    print(f"[고정] {coin} 복구 완료 (간격: {interval})")

    def _update_bench(
        self, scores: List[CoinScore], screened_symbols: set
    ) -> None:
        """벤치 업데이트: 탈락 코인 제거 + 신규 추가."""
        # 스크리너에서 탈락한 벤치 코인 제거 (고래 보호 코인 제외)
        for bc in self._bench.all_coins():
            if bc.symbol not in screened_symbols:
                if bc.symbol in self._whale_protected:
                    continue  # ★ 고래 보호 중이면 벤치에서 제거 안 함
                self._bench.remove(bc.symbol)

        # 신규 후보 벤치 추가
        added = 0
        for score in scores:
            if score.symbol in self._fixed_coins:
                continue
            if score.symbol in self._slots:
                continue
            if score.symbol in self._blacklist:
                continue
            if self._bench.add(score):
                added += 1

        if added > 0 and self._verbose:
            print(f"[벤치] 신규 {added}개 추가 "
                  f"(총 {len(self._bench)}개)")

    def _monitor_bench(self) -> None:
        """벤치 코인 가격/거래량 모니터링 (가벼운 추적)."""
        import pybithumb

        for bc in self._bench.all_coins():
            try:
                detail = pybithumb.get_market_detail(bc.symbol)
                if detail and detail[3] is not None:
                    price = detail[3]  # close
                    vol = detail[4] if detail[4] else 0
                    volume_krw = price * vol
                    self._bench.update_monitoring(
                        bc.symbol, price, volume_krw
                    )
            except Exception:
                pass  # 모니터링 실패는 무시

    def _promote_from_bench(self) -> None:
        """벤치 승격 대상을 빈 동적 슬롯에 채운다."""
        dynamic_slots = self._max_positions - len(self._fixed_coins)
        active_dynamic = sum(
            1 for s in self._slots.values()
            if not s.is_fixed and not s.draining
        )
        available = dynamic_slots - active_dynamic

        if available <= 0:
            return

        eligible = self._bench.eligible_for_promotion()
        if not eligible:
            return

        promoted = 0
        for bc in eligible:
            if promoted >= available:
                break
            if bc.symbol in self._blacklist:
                continue
            if self._try_activate(bc.score, bc.interval):
                promoted += 1
                print(f"[승격] {bc.symbol} 벤치→활성 "
                      f"(대기: {bc.wait_hours:.1f}h, "
                      f"간격: {bc.interval})")

    def _try_swap_weakest(self) -> None:
        """벤치 최강 vs 동적 슬롯 최약 비교 → 조건 충족 시 교체.

        ★ 점수 비교 기준: 전략 평가 점수(best.score)를 통일 기준으로 사용.
        벤치 코인은 아직 전략 평가를 하지 않았으므로 range_pct(변동폭)를 proxy로 쓰되,
        동적 슬롯도 동일하게 범위 비교한다.
        """
        eligible = self._bench.eligible_for_promotion()
        if not eligible:
            if self._verbose:
                bench_all = self._bench.all_coins()
                if bench_all:
                    waits = [f"{b.symbol}({b.wait_hours:.1f}h)" for b in bench_all[:5]]
                    print(f"  [교체] 승격 자격 없음 — 벤치: {', '.join(waits)}")
            return

        # 벤치 최강 코인
        bench_best = eligible[0]
        bench_score = bench_best.score.range_pct  # 변동폭 %

        # 동적 슬롯 중 교체 가능한 최약 코인 찾기
        dynamic_slots = [
            (coin, slot)
            for coin, slot in self._slots.items()
            if not slot.is_fixed
            and not slot.draining
            and slot.trader._position is None  # 포지션 보유 중 교체 금지
        ]

        # stay_hours 미충족 슬롯 분리 (디버그용)
        eligible_slots = [
            (c, s) for c, s in dynamic_slots
            if s.stay_hours >= config.ACTIVE_MIN_STAY_HOURS
        ]
        blocked_by_stay = [
            (c, s) for c, s in dynamic_slots
            if s.stay_hours < config.ACTIVE_MIN_STAY_HOURS
        ]

        if self._verbose and blocked_by_stay:
            names = [f"{c}({s.stay_hours:.2f}h/{config.ACTIVE_MIN_STAY_HOURS}h)"
                     for c, s in blocked_by_stay[:3]]
            print(f"  [교체] 체류시간 미달: {', '.join(names)}")

        if not eligible_slots:
            if self._verbose:
                has_pos = [(c, s) for c, s in self._slots.items()
                           if not s.is_fixed and not s.draining
                           and s.trader._position is not None]
                if has_pos:
                    print(f"  [교체] 포지션 보유로 교체 불가: "
                          f"{', '.join(c for c, _ in has_pos[:3])}")
            return

        # ★ 슬롯 "실효 점수" — 거래 실적 기반 (거래 0건이면 낮은 점수)
        def _slot_effectiveness(cs):
            """슬롯 실효 점수: 거래 수, 수익률, 전략 점수를 종합.
            거래 0건 = 기회를 못 잡는 코인 → 교체 우선."""
            _, s = cs
            t = s.trader
            trades = len(t._trades)
            ret_pct = sum(tr.pnl_pct for tr in t._trades) if t._trades else 0.0
            strat_score = 0.0
            if t._last_eval and t._last_eval.best:
                strat_score = t._last_eval.best.score
            # 거래 0건이면 체류시간에 비례해 점수 하락 (오래 있는데 거래 없으면 교체)
            if trades == 0:
                stay_penalty = min(s.stay_hours, 2.0)  # 최대 -2
                return strat_score - stay_penalty * 5
            # 거래 있으면 수익률 + 전략 점수
            return strat_score + ret_pct

        weakest_coin, weakest_slot = min(eligible_slots, key=_slot_effectiveness)
        weakest_eff = _slot_effectiveness((weakest_coin, weakest_slot))

        # ★ 벤치 점수 vs 슬롯 실효점수 비교 (동일 스케일)
        # 벤치는 range_pct를 proxy로, 슬롯은 실효 점수
        # 기준: 벤치 변동폭이 슬롯 실효 점수보다 15% 이상 높으면 교체
        threshold = max(weakest_eff, 1.0) * config.SWAP_SCORE_ADVANTAGE

        if self._verbose:
            wt = weakest_slot.trader
            print(f"  [교체] 비교: 벤치 {bench_best.symbol} "
                  f"(변동폭:{bench_score:.1f}%) vs "
                  f"슬롯 {weakest_coin} (실효:{weakest_eff:.1f}, "
                  f"거래:{len(wt._trades)}건, "
                  f"체류:{weakest_slot.stay_hours:.2f}h) "
                  f"— 기준:{threshold:.1f}")

        if bench_score <= threshold:
            return

        # 교체 실행
        print(f"[교체] {weakest_coin} (실효: {weakest_eff:.1f}) → "
              f"{bench_best.symbol} (변동폭: {bench_score:.1f}%)")

        # 기존 슬롯 제거
        self._unallocated_krw += weakest_slot.trader._balance_krw
        del self._slots[weakest_coin]
        self._add_blacklist(weakest_coin, "교체 아웃")

        # 새 코인 활성화
        self._try_activate(bench_best.score, bench_best.interval)

    # ── 블랙리스트 ────────────────────────────────────────────

    def _check_coin_performance(self, coin: str) -> None:
        """코인별 성과 기반 자동 차단 — 거래 종료 후 호출."""
        if coin not in self._slots:
            return
        trades = self._slots[coin].trader._trades
        if len(trades) < config.COIN_PERF_MIN_TRADES:
            return
        wins = sum(1 for t in trades if t.pnl_krw > 0)
        wr = wins / len(trades) * 100
        total_pnl = sum(t.pnl_krw for t in trades)
        if wr < config.COIN_PERF_BLOCK_WR and total_pnl < config.COIN_PERF_BLOCK_LOSS_KRW:
            expires = datetime.now() + timedelta(hours=config.COIN_PERF_BLOCK_TTL_HOURS)
            self._blacklist[coin] = expires
            print(f"[성과차단] {coin}: {len(trades)}건 WR {wr:.0f}%, "
                  f"PnL {total_pnl:,.0f}원 → {config.COIN_PERF_BLOCK_TTL_HOURS}h 차단")

    def _add_blacklist(self, coin: str, reason: str) -> None:
        """코인을 블랙리스트에 추가 (24시간 차단)."""
        expires = datetime.now() + timedelta(hours=config.BLACKLIST_TTL_HOURS)
        self._blacklist[coin] = expires
        if self._verbose:
            print(f"[블랙리스트] {coin}: {reason} "
                  f"(만료: {expires.strftime('%H:%M')})")

    def _clean_blacklist(self) -> None:
        """만료된 블랙리스트 항목 제거."""
        now = datetime.now()
        expired = [c for c, t in self._blacklist.items() if now >= t]
        for c in expired:
            del self._blacklist[c]
            if self._verbose:
                print(f"[블랙리스트] {c} 해제")

    def _clean_whale_protection(self) -> None:
        """만료된 고래 보호 항목 제거."""
        now = datetime.now()
        expired = [
            c for c, t in self._whale_protect_until.items()
            if now >= t
        ]
        for c in expired:
            self._whale_protected.discard(c)
            del self._whale_protect_until[c]
            if self._verbose:
                print(f"[고래] {c} 보호 만료")

    # ── 고래 추적 (실시간 WebSocket + REST 폴백) ──────────────

    def _on_whale_alert(self, alert: WhaleAlert) -> None:
        """실시간 고래 알림 콜백 — 대형 거래 즉시 반영 + 트레이딩 트리거.

        ★ 고래 우선 원칙:
          - 고래 매수 감지 코인은 30분간 "보호" 상태 → 스크리너 드레인 유예
          - 고래가 블랙리스트 코인을 매수하면 블랙리스트 해제
          - 고래 매수 즉시 trading_cycle 실행

        쓰레드 안전:
          - 이 콜백은 WebSocket 쓰레드에서 호출됨
          - _slot_lock으로 슬롯/벤치 접근 동기화
        """
        coin = alert.coin

        if self._verbose:
            emoji = "🟢" if alert.direction == "BUY" else "🔴"
            print(
                f"  🐋 {emoji} {coin} {alert.direction} "
                f"{alert.amount_krw:,.0f}원 (x{alert.size_ratio:.1f})"
            )

        # 일일 가드 차단 중이면 무시
        if self._daily_guard.is_trading_blocked():
            return

        with self._slot_lock:
            slot = self._slots.get(coin)

            if alert.direction == "BUY":
                # ★ 고래 보호: 30분간 스크리너 드레인 유예
                self._whale_protected.add(coin)
                self._whale_protect_until[coin] = (
                    datetime.now() + timedelta(minutes=30)
                )

                # ★ 고래 매수 → 블랙리스트 해제 (고래가 우선)
                if coin in self._blacklist:
                    del self._blacklist[coin]
                    print(f"  🐋✅ {coin} 고래 매수 → 블랙리스트 해제")

                if slot and not slot.draining:
                    # 활성 슬롯의 코인 → 고래 매수 부스트 + 즉시 사이클
                    slot.trader._whale_buy_boost = True
                    try:
                        slot.trader.trading_cycle()
                        if self._verbose:
                            print(f"  🐋→⚡ {coin} 즉시 트레이딩 사이클 실행")
                    except Exception as e:
                        if self._verbose:
                            print(f"  🐋→⚡ {coin} 즉시 사이클 오류: {e}")

                elif slot and slot.draining:
                    # ★ 드레인 중인데 고래 매수 → 드레인 취소
                    slot.draining = False
                    slot.drain_reason = ""
                    slot.trader._whale_buy_boost = True
                    print(f"  🐋🔄 {coin} 고래 매수 → 드레인 취소!")
                    try:
                        slot.trader.trading_cycle()
                    except Exception:
                        pass

            elif alert.direction == "SELL" and slot and slot.trader._position:
                # ★ 소형/변동성 코인은 고래 매도 민감도 완화
                # EXTREME: x15.0 이상 + 500만원 이상만 진짜 고래로 판정
                # HOT:     x10.0 이상 + 300만원 이상만 진짜 고래로 판정
                # NORMAL:  기존 기준 (x5.0 + 100만원) 유지
                tier = slot.trader._volatility_tier
                tier_mult = {"EXTREME": 15.0, "HOT": 10.0}.get(tier, 5.0)
                tier_min_krw = {"EXTREME": 5_000_000, "HOT": 3_000_000}.get(tier, 1_000_000)

                if alert.size_ratio >= tier_mult and alert.amount_krw >= tier_min_krw:
                    slot.trader._whale_sell_alert = True
                    if self._verbose:
                        print(f"  🐋⚠️ {coin} 진짜 고래 매도 "
                              f"({alert.amount_krw:,.0f}원, x{alert.size_ratio:.1f}) "
                              f"— 포지션 주의")
                elif self._verbose:
                    print(f"  🐋 {coin} 소형 매도 무시 "
                          f"({alert.amount_krw:,.0f}원, x{alert.size_ratio:.1f} "
                          f"< 티어 기준 x{tier_mult:.0f}/{tier_min_krw:,.0f}원)")

    # ── 급등 감지 콜백 ─────────────────────────────────────────

    def _on_surge_alert(self, alert: SurgeAlert) -> None:
        """실시간 급등 감지 콜백 — IGNITION/ACCELERATION 시 즉시 반응.

        ★ 급등 대응 원칙:
          - IGNITION: 벤치에 추가 + 빈 동적 슬롯 있으면 즉시 승격
          - ACCELERATION: 이미 슬롯에 있으면 즉시 트레이딩 사이클 실행
          - CLIMAX: 절대 진입 금지 (이미 10%+ 상승)
          - 포지션 크기: 총 자본의 SURGE_CAPITAL_PCT% 이하 (고위험 제한)

        쓰레드 안전:
          - 이 콜백은 WebSocket 쓰레드에서 호출됨
          - _slot_lock으로 슬롯/벤치 접근 동기화
        """
        coin = alert.coin

        # CLIMAX → 절대 진입 금지
        if not alert.is_tradeable:
            print(f"  🚀🚫 [{coin}] CLIMAX — {alert.reason} → 추격 금지!")
            return

        phase_emoji = "🔥" if alert.phase == PHASE_IGNITION else "🚀"
        print(
            f"  {phase_emoji} [{coin}] {alert.phase} — "
            f"{alert.reason} @ {alert.current_price:,.0f}"
        )

        with self._slot_lock:
            slot = self._slots.get(coin)

            if slot and not slot.draining:
                # 이미 활성 슬롯에 있음 → 즉시 트레이딩 사이클 실행
                slot.trader._surge_boost = True
                try:
                    slot.trader.trading_cycle()
                    print(f"  {phase_emoji}→⚡ {coin} 급등 부스트 — 즉시 사이클 실행")
                except Exception as e:
                    print(f"  {phase_emoji}→⚡ {coin} 즉시 사이클 오류: {e}")
                return

            if slot and slot.draining:
                # 드레인 중인데 급등 → 드레인 취소
                slot.draining = False
                slot.drain_reason = ""
                slot.trader._surge_boost = True
                print(f"  {phase_emoji}🔄 {coin} 급등 감지 → 드레인 취소!")
                try:
                    slot.trader.trading_cycle()
                except Exception:
                    pass
                return

            # 슬롯에 없음 → 빈 동적 슬롯이 있으면 즉시 승격
            dynamic_slots = self._max_positions - len(self._fixed_coins)
            active_dynamic = sum(
                1 for s in self._slots.values()
                if not s.is_fixed and not s.draining
            )
            available = dynamic_slots - active_dynamic

            if available <= 0:
                # 빈 슬롯 없음 → 벤치에만 추가
                if coin not in self._bench:
                    try:
                        score = self._screener.scan_single(coin)
                        if score:
                            self._bench.add(score)
                            print(f"  {phase_emoji}→벤치 {coin} 급등 코인 벤치 추가")
                    except Exception:
                        pass
                return

            # ★ 빈 슬롯 있음 → 즉시 활성화!
            if coin in self._blacklist:
                del self._blacklist[coin]
                print(f"  {phase_emoji} {coin} 급등 → 블랙리스트 해제")

            try:
                score = self._screener.scan_single(coin)
                if score:
                    interval = classify_interval(score)
                    # 급등 코인은 짧은 캔들 사용 (최대 30m)
                    if interval == "1h":
                        interval = "30m"
                    if self._try_activate(score, interval):
                        print(
                            f"  {phase_emoji}→✅ {coin} 급등 즉시 슬롯 승격! "
                            f"({alert.phase}, 간격: {interval})"
                        )
                    else:
                        self._bench.add(score)
                        print(f"  {phase_emoji}→벤치 {coin} 활성화 실패, 벤치 추가")
            except Exception as e:
                print(f"  {phase_emoji} {coin} 급등 처리 오류: {e}")

    def _check_surge_positions(self) -> None:
        """★ 급등 포지션 시간 초과 체크 (30분 최대 보유).

        10초 모니터링 루프에서 호출됨.
        급등으로 진입한 포지션이 SURGE_MAX_HOLD_SEC을 초과하면 강제 청산.
        """
        if not self._surge_detector:
            return

        now = datetime.now()
        max_age = timedelta(seconds=config.SURGE_MAX_HOLD_SEC)

        with self._slot_lock:
            for coin, slot in list(self._slots.items()):
                trader = slot.trader
                if trader._position is None:
                    continue
                # surge_entry_time이 설정된 포지션만 체크
                surge_time = getattr(trader._position, "surge_entry_time", None)
                if surge_time and (now - surge_time) > max_age:
                    try:
                        sell_price = getattr(trader, "_last_price", 0)
                        if not sell_price or sell_price <= 0:
                            sell_price = trader._position.entry_price
                        trader._execute_sell(
                            sell_price,
                            "SURGE_TIMEOUT",
                        )
                        print(f"  🚀⏰ {coin} 급등 포지션 시간 초과 청산")
                    except Exception as e:
                        print(f"  🚀⏰ {coin} 청산 오류: {e}")

    def _apply_realtime_whale_data(self) -> None:
        """실시간 고래 데이터를 벤치에 반영한다.

        WebSocket이 연결되어 있으면 실시간 데이터를 사용하고,
        끊어진 경우에만 REST 폴링(_periodic_whale_scan_fallback)으로 폴백한다.
        """
        if self._realtime_whale.is_connected:
            self._apply_ws_whale_to_bench()
            # 추적 코인 목록 업데이트
            self._update_whale_tracking_coins()
        else:
            # WebSocket 끊김 → REST 폴백 (10분마다)
            self._periodic_whale_scan_fallback()

    def _apply_ws_whale_to_bench(self) -> None:
        """WebSocket 실시간 고래 데이터에서 BULLISH 코인을 벤치에 추가."""
        bullish_coins = self._realtime_whale.get_bullish_coins()

        if not bullish_coins:
            return

        summary = self._realtime_whale.get_summary()
        if self._verbose:
            print(
                f"[고래RT] {summary['market_sentiment']} | "
                f"고래 {summary['total_whale_trades']}건 "
                f"(매수{summary['whale_buys']}/매도{summary['whale_sells']})"
            )

        for coin in bullish_coins:
            if coin in self._slots or coin in self._bench:
                continue

            # ★ 고래 BULLISH 코인은 블랙리스트 면제
            if coin in self._blacklist:
                del self._blacklist[coin]
                print(f"[고래RT] {coin} 고래 BULLISH → 블랙리스트 해제")

            # 고래 보호 설정
            self._whale_protected.add(coin)
            self._whale_protect_until[coin] = (
                datetime.now() + timedelta(minutes=30)
            )

            # 벤치 추가를 위해 CoinScore 조회
            try:
                score = self._screener.scan_single(coin)
                if score:
                    state = self._realtime_whale.get_coin_state(coin)
                    buys = state.whale_buys if state else 0
                    sells = state.whale_sells if state else 0
                    vol = state.whale_volume_krw if state else 0
                    self._bench.add(score)
                    print(
                        f"[고래RT→벤치] {coin} "
                        f"(매수{buys}/매도{sells}, "
                        f"{vol:,.0f}원)"
                    )
            except Exception:
                pass

        # 5분마다 윈도우 리셋 (오래된 고래 데이터 정리)
        now = datetime.now()
        if (self._last_whale_scan is None or
                (now - self._last_whale_scan).total_seconds() >= 300):
            self._realtime_whale.reset_windows()
            self._last_whale_scan = now

    def _update_whale_tracking_coins(self) -> None:
        """활성 슬롯 + 벤치 상위 코인으로 추적 목록 갱신."""
        tracked = set(self._slots.keys())
        bench_coins = [bc.symbol for bc in self._bench.all_coins()[:10]]
        all_tracked = list(tracked | set(bench_coins))
        self._realtime_whale.set_coins(all_tracked)

    def _periodic_whale_scan_fallback(self) -> None:
        """REST 폴백: WebSocket 끊긴 경우 2분마다 고래 스캔.

        빗썸 공개 API rate limit 감안:
        - 1회 스캔 ≈ 21건 API 호출 (1 티커 + 10 체결 + 10 호가)
        - 2분 간격이면 시간당 약 630건 → 빗썸 제한(초당 20건) 대비 안전
        """
        now = datetime.now()
        if (self._last_whale_scan and
                (now - self._last_whale_scan).total_seconds() < 120):
            return

        try:
            report = self._whale_tracker.scan_all_coins()
            self._last_whale_scan = now

            if not report.top_coins:
                return

            if self._verbose:
                hot_coins = [a.coin for a in report.top_coins[:5]
                             if a.whale_trade_count >= 2]
                if hot_coins:
                    signals = []
                    for a in report.top_coins[:5]:
                        if a.whale_trade_count >= 2:
                            signals.append(
                                f"{a.coin}({a.signal[:1]},{a.whale_trade_count}건)"
                            )
                    print(f"[고래FB] {report.market_sentiment} | "
                          f"TOP: {' '.join(signals)}")

            for activity in report.top_coins[:5]:
                if (activity.signal == "BULLISH"
                        and activity.whale_trade_count >= 3
                        and activity.coin not in self._slots
                        and activity.coin not in self._bench):

                    # ★ 고래 BULLISH → 블랙리스트 면제
                    if activity.coin in self._blacklist:
                        del self._blacklist[activity.coin]
                        print(f"[고래FB] {activity.coin} "
                              f"고래 BULLISH → 블랙리스트 해제")

                    # 고래 보호 설정
                    self._whale_protected.add(activity.coin)
                    self._whale_protect_until[activity.coin] = (
                        datetime.now() + timedelta(minutes=30)
                    )

                    try:
                        score = self._screener.scan_single(activity.coin)
                        if score:
                            self._bench.add(score)
                            print(f"[고래FB→벤치] {activity.coin} "
                                  f"(매수{activity.whale_buy_count}/"
                                  f"매도{activity.whale_sell_count}, "
                                  f"{activity.whale_volume_krw:,.0f}원)")
                    except Exception:
                        pass

        except Exception as e:
            if self._verbose:
                print(f"[고래FB] 스캔 오류: {e}")

    def record_trade_to_guard(self, pnl_pct: float) -> None:
        """거래 완료 시 일일 가드에 기록한다."""
        self._daily_guard.record_trade(pnl_pct)
        if self._daily_guard.is_trading_blocked():
            status = self._daily_guard.status()
            print(f"[가드] ⚠️ {status['block_reason']}")
            print(f"[가드] 오늘 누적: {status['daily_pnl_pct']:+.2f}%, "
                  f"{status['daily_trades']}건")

    # ── 학습 사이클 ──────────────────────────────────────────────

    def _safe_adaptation_cycle(self) -> None:
        """전체 코인 적응 학습 사이클 (안전 래퍼)."""
        try:
            self._run_adaptation_all()
        except Exception as e:
            print(f"[학습] 오류: {e}")

    def _run_adaptation_all(self) -> None:
        """모든 활성 슬롯의 학습 사이클을 실행한다.

        각 코인별로 독립적으로 학습:
          - 시간대 필터 (저성과 시간 차단)
          - 추세 필터 (하락추세 매수 차단)
          - 포지션 크기 (연속 손실 시 축소)
          - SL/TP 적응 (충분한 데이터 시)
        """
        total_adapted = 0
        for coin, slot in self._slots.items():
            if slot.draining:
                continue
            try:
                adapted = slot.trader.run_adaptation_cycle()
                total_adapted += adapted
            except Exception as e:
                if self._verbose:
                    print(f"[학습] {coin} 오류: {e}")

        if total_adapted > 0:
            print(f"[학습] 전체 적응 완료: {total_adapted}건 적용")

            # 학습 상태 요약
            if self._verbose:
                for coin, slot in self._slots.items():
                    if slot.draining:
                        continue
                    status = slot.trader.learning_status()
                    if status["adaptation_count"] > 0:
                        print(f"  {coin}: 차단시간={status['blocked_hours']} "
                              f"추세차단={status['block_downtrend']} "
                              f"배율={status['position_multiplier']:.2f}x")

        # ★ 성과 기반 리밸런싱: 성공한 트레이더에 자본 재배분
        self._performance_rebalance()

    def _safe_weekly_learning(self) -> None:
        """★ 주간 시장 트렌드 학습 (매주 월요일 오전 3시).

        Gemini + Google Search grounding으로:
          1. 현재 코인 시장에서 가장 성공한 매매 방식 조사
          2. 우리 전략과 비교하여 파라미터 조정 제안
          3. 안전 범위 내 자동 적용 (SL/TP/RR/ATR)
          4. 주간 리포트 저장
        """
        try:
            insight = run_weekly_learning(dry_run=False)
            if insight and insight.applied:
                # 파라미터가 변경되면 모든 활성 트레이더에 반영
                self._apply_weekly_insight_to_traders(insight)
        except Exception as e:
            print(f"[주간학습] 오류: {e}")

    def _apply_weekly_insight_to_traders(self, insight) -> None:
        """주간 학습 결과를 활성 트레이더들에 반영한다.

        config 값이 이미 변경된 상태이므로,
        각 트레이더의 adapted SL/TP를 업데이트한다.
        """
        adj = insight.parameter_adjustments
        if not adj:
            return

        updated = 0
        for coin, slot in self._slots.items():
            if slot.draining:
                continue

            # SL/TP 적응값 업데이트 (주간 학습이 개별 학습보다 우선)
            sl = adj.get("sl_pct")
            tp = adj.get("tp_pct")
            if sl is not None:
                slot.trader._adapted_sl_pct = float(sl)
            if tp is not None:
                slot.trader._adapted_tp_pct = float(tp)
            updated += 1

        if updated > 0:
            print(f"[주간학습] {updated}개 트레이더에 파라미터 반영 완료")

            # 추천 전략 활성화
            if insight.recommended_strategies:
                for name in insight.recommended_strategies:
                    self._strategy_selector.enable_strategy(name)
                print(f"[주간학습] 추천 전략 활성화: "
                      f"{', '.join(insight.recommended_strategies)}")

            # ★ 회피 전략 비활성화 (실제로 차단)
            if insight.avoid_strategies:
                for name in insight.avoid_strategies:
                    self._strategy_selector.disable_strategy(
                        name, reason="주간학습 회피 권고"
                    )
                print(f"[주간학습] 회피 전략 비활성화: "
                      f"{', '.join(insight.avoid_strategies)}")

    def _performance_rebalance(self) -> None:
        """★ 성과 기반 리밸런싱 — 성공한 트레이더에 자본을 더 배분한다.

        학습 사이클 후 호출되어, 실시간 거래 성과를 가중치에 반영한다.
        거래 기록이 쌓일수록 성과가 좋은 코인에 자본이 집중된다.
        """
        if not self._slots:
            return

        # 거래 10건 이상인 슬롯만 성과 기반 가중치 갱신
        updated = 0
        for coin, slot in self._slots.items():
            if slot.draining:
                continue
            if len(slot.trader._trades) < 10:
                continue

            # CoinScore가 필요 — screener에서 다시 조회
            try:
                score = self._screener.scan_single(coin)
                if not score:
                    continue
            except Exception:
                continue

            old_weight = slot.allocation_weight
            new_weight = self._calc_allocation_weight(score, slot.trader)

            if abs(new_weight - old_weight) > 0.05:
                slot.allocation_weight = new_weight
                updated += 1
                if self._verbose:
                    direction = "↑" if new_weight > old_weight else "↓"
                    print(f"  [배분] {coin}: ×{old_weight:.2f} "
                          f"→ ×{new_weight:.2f} {direction}")

        if updated > 0:
            self._rebalance_allocations()
            print(f"[배분] 성과 기반 리밸런싱 완료: {updated}개 슬롯 조정")

    # ── 시장 인텔리전스 ──────────────────────────────────────────

    def _safe_intel_update(self) -> None:
        """시장 인텔리전스 수집 + 분석 (안전 래퍼)."""
        try:
            self._intel_update()
        except Exception as e:
            print(f"[인텔] 오류: {e}")

    def _intel_update(self) -> None:
        """시장 데이터 수집 → 시그널 분석 → 예측 생성."""
        now = datetime.now()

        # 쿨다운: 최소 1시간 간격
        if self._last_intel_time:
            elapsed = (now - self._last_intel_time).total_seconds()
            if elapsed < 3600:
                return

        print(f"\n[인텔] 시장 인텔리전스 수집 중...")
        snapshot = self._intel_collector.collect_all()
        prediction = self._intel_aggregator.analyze(snapshot)
        self._latest_prediction = prediction
        self._last_intel_time = now

        print(f"[인텔] {prediction.summary_line}")

        # 예측 기반 포지션 조정
        self._apply_intel_to_strategy(prediction)

        # 일일 리포트 저장 (하루 1회)
        self._save_daily_if_needed()

    def _apply_intel_to_strategy(self, pred: MarketPrediction) -> None:
        """인텔리전스 예측을 트레이딩 전략에 반영한다 (쓰레드 안전)."""
        with self._slot_lock:
            self._apply_intel_to_strategy_locked(pred)

    def _apply_intel_to_strategy_locked(self, pred: MarketPrediction) -> None:
        """인텔리전스 예측 적용 (락 내부)."""
        if pred.action == "SELL":
            # 극도 약세: 모든 동적 슬롯 드레인 (고래 보호 제외)
            drained = 0
            for coin in list(self._slots.keys()):
                slot = self._slots[coin]
                if not slot.is_fixed and not slot.draining:
                    if coin in self._whale_protected:
                        print(f"[인텔] {coin} 고래 보호 → SELL 드레인 유예")
                        continue
                    self._drain_coin(coin, "인텔: SELL 시그널")
                    drained += 1
            print(f"[인텔] SELL 시그널 — {drained}개 슬롯 드레인")

        elif pred.action == "REDUCE":
            # 약세: 최약 동적 슬롯 드레인
            dynamic = [
                (c, s) for c, s in self._slots.items()
                if not s.is_fixed and not s.draining
                and s.stay_hours >= config.ACTIVE_MIN_STAY_HOURS
            ]
            if dynamic:
                weakest = min(
                    dynamic,
                    key=lambda cs: cs[1].allocation_weight,
                )
                self._drain_coin(
                    weakest[0], "인텔: REDUCE 시그널"
                )
                print(f"[인텔] REDUCE — {weakest[0]} 드레인")

        elif pred.action == "AGGRESSIVE_BUY":
            # 극도 강세: 빈 슬롯 즉시 채우기
            print(f"[인텔] AGGRESSIVE_BUY — 빈 슬롯 즉시 승격 시도")
            self._promote_from_bench()

    def _save_daily_if_needed(self) -> None:
        """하루 1회 일일 리포트를 파일로 저장한다."""
        report_dir = os.path.join(
            os.path.dirname(__file__),
            ".claude", "memory", "daily_intel",
        )
        os.makedirs(report_dir, exist_ok=True)

        date_str = datetime.now().strftime("%Y-%m-%d")
        json_path = os.path.join(report_dir, f"{date_str}.json")

        # 이미 오늘 리포트가 있으면 스킵
        if os.path.exists(json_path):
            return

        # 전체 리포트 생성 (파일 저장 포함)
        try:
            generate_daily_report()
        except Exception as e:
            print(f"[인텔] 일일 리포트 저장 실패: {e}")

    # ── KPI 집계 ──────────────────────────────────────────────

    def portfolio_total_value(self) -> float:
        """전체 포트폴리오 가치 (미배분 + 각 트레이더 잔고 + 포지션 현재가)."""
        total = self._unallocated_krw
        for slot in self._slots.values():
            total += slot.trader._balance_krw
            if slot.trader._position:
                pos = slot.trader._position
                # ★ 현재 시장가로 포지션 가치 계산 (진입가 아님)
                current_price = getattr(slot.trader, "_last_price", 0)
                if current_price and current_price > 0:
                    total += pos.quantity * current_price
                else:
                    total += pos.invested_krw  # 시장가 없으면 투자금으로 폴백
        return total

    def all_trades(self) -> List[PaperTrade]:
        """모든 코인의 거래 기록 합산 (시간순)."""
        trades: List[PaperTrade] = []
        for slot in self._slots.values():
            trades.extend(slot.trader._trades)
        return sorted(trades, key=lambda t: t.exit_time)

    def all_triggers(self) -> list:
        """모든 코인의 트리거 이벤트 합산."""
        triggers = []
        for slot in self._slots.values():
            triggers.extend(getattr(slot.trader, '_triggers', []))
        return triggers

    def portfolio_win_rate(self) -> float:
        """포트폴리오 전체 승률."""
        trades = self.all_trades()
        if not trades:
            return 0.0
        wins = sum(1 for t in trades if t.pnl_krw > 0)
        return (wins / len(trades)) * 100

    # ── 보고서 ────────────────────────────────────────────────

    def _print_header(self) -> None:
        """시작 헤더 출력."""
        end_str = (f"자동 종료: {self._end_time}"
                   if self._end_time else "수동 종료 (Ctrl+C)")
        print(f"\n{'=' * 64}")
        print(f"  유동적 포트폴리오 시스템 (조건 충족 코인만 활성화)")
        print(f"  자본: {self._initial_capital:,.0f}원 | "
              f"상한: {self._max_positions}코인 | "
              f"최소 점수: {config.MIN_ACTIVATION_SCORE} | "
              f"최소 배분: {config.MIN_COIN_ALLOCATION_KRW:,}원")
        print(f"  벤치: {config.BENCH_MAX_SIZE}코인 | "
              f"급등 감지: {'ON' if config.SURGE_DETECTION_ENABLED else 'OFF'}")
        print(f"  스캔: {self._scan_interval_min}분 | "
              f"트레이딩: {self._trading_interval_sec}초 | "
              f"보고: {self._report_interval_min}분")
        print(f"  {end_str}")
        print(f"{'=' * 64}")

    def _print_portfolio_report(self) -> None:
        """주기적 포트폴리오 보고서."""
        total = self.portfolio_total_value()
        ret_pct = ((total / self._initial_capital) - 1) * 100
        trades = self.all_trades()
        win_rate = self.portfolio_win_rate()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        print(f"\n{'─' * 64}")
        print(f"  포트폴리오 보고서 | {now}")
        print(f"{'─' * 64}")
        print(f"  총 가치: {total:,.0f}원 ({ret_pct:+.2f}%)")
        print(f"  미배분: {self._unallocated_krw:,.0f}원")
        print(f"  거래: {len(trades)}건 | 승률: {win_rate:.1f}%")
        print(f"  활성: {len(self._slots)}코인 | "
              f"벤치: {len(self._bench)}코인 | "
              f"블랙리스트: {len(self._blacklist)}코인")

        for coin, slot in self._slots.items():
            t = slot.trader
            bal = t._balance_krw
            ret = ((bal / slot.allocated_krw) - 1) * 100 if slot.allocated_krw > 0 else 0
            status = "DRAIN" if slot.draining else t._active_strategy_name
            pos_str = ""
            if t._position:
                pos_str = f" [보유: {t._position.entry_price:,.0f}원]"
            print(f"  {coin:>6} | {slot.interval:>3} | {status:<16} | "
                  f"×{slot.allocation_weight:.2f} | "
                  f"{bal:>12,.0f}원 ({ret:+6.2f}%){pos_str}")

        # 벤치 요약 (승격 자격 코인만)
        eligible = self._bench.eligible_for_promotion()
        if eligible:
            print(f"  ── 승격 대기 ({len(eligible)}개) ──")
            for bc in eligible[:3]:
                print(f"    {bc.symbol:>6} | {bc.interval:>3} | "
                      f"변동폭: {bc.score.range_pct:.1f}% | "
                      f"대기: {bc.wait_hours:.1f}h")

        # ★ 급등 감지 요약
        if self._surge_detector:
            surge_summary = self._surge_detector.get_summary()
            if surge_summary["active_surges"] > 0 or surge_summary["climax_coins"] > 0:
                print(f"  ── 급등 감지 ──")
                for s in surge_summary["surges"]:
                    emoji = "🚀" if s["tradeable"] else "🚫"
                    print(f"    {emoji} {s['coin']:>6} | {s['phase']:<13} | "
                          f"{s['price_change']} | 볼륨 {s['volume_ratio']}")

        # 시장 인텔리전스 요약
        if self._latest_prediction:
            pred = self._latest_prediction
            print(f"  ── 인텔리전스 ──")
            print(f"    {pred.summary_line}")
            trend = self._intel_aggregator.trend_direction()
            if trend != "INSUFFICIENT_DATA":
                print(f"    추세: {trend}")
        print(f"{'─' * 64}")


# ── CLI 진입점 ──────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="멀티코인 페이퍼 포트폴리오 매니저"
    )
    parser.add_argument(
        "--capital", type=float, default=config.PAPER_INITIAL_KRW,
        help=f"시작 자본 (기본: {config.PAPER_INITIAL_KRW:,.0f}원)"
    )
    parser.add_argument(
        "--max-positions", type=int, default=config.MAX_POSITIONS,
        help=f"최대 동시 코인 수 (기본: {config.MAX_POSITIONS})"
    )
    parser.add_argument(
        "--scan-interval", type=int, default=config.PAPER_SCAN_INTERVAL_MINUTES,
        help=f"코인 스캔 주기 분 (기본: {config.PAPER_SCAN_INTERVAL_MINUTES})"
    )
    parser.add_argument(
        "--verbose", action="store_true", help="상세 출력"
    )
    parser.add_argument(
        "--end-time", type=str, default=None,
        help="자동 종료 시각 (예: '2026-03-11 07:00')"
    )
    parser.add_argument(
        "--reset", action="store_true",
        help="이전 잔액 무시하고 --capital 값으로 초기화"
    )
    return parser.parse_args()


def _load_previous_capital(default_capital: float) -> float:
    """이전 세션의 총자산을 paper_state.json에서 복원한다."""
    state_file = os.path.join(
        os.path.dirname(__file__), "paper_state.json"
    )
    try:
        if os.path.exists(state_file):
            with open(state_file, "r") as f:
                state = json.load(f)
            prev_value = state.get("kpi", {}).get("total_value", 0)
            prev_capital = state.get("kpi", {}).get("initial_capital", 0)
            if prev_value > 0 and prev_capital > 0:
                print(f"[잔액 유지] 이전 세션 총자산: {prev_value:,.0f}원 "
                      f"(초기 {prev_capital:,.0f}원)")
                return prev_value
    except Exception as e:
        print(f"[잔액 유지] 복원 실패: {e}")
    return default_capital


def main() -> None:
    args = parse_args()

    end_time = None
    if args.end_time:
        end_time = datetime.strptime(args.end_time, "%Y-%m-%d %H:%M")
        print(f"자동 종료 예정: {end_time}")

    # ★ 잔액 유지 모드: --reset 없으면 이전 잔액 복원
    if hasattr(args, 'reset') and args.reset:
        capital = args.capital
        print(f"[리셋 모드] 새 자본: {capital:,.0f}원")
    else:
        capital = _load_previous_capital(args.capital)

    manager = PaperPortfolioManager(
        initial_capital=capital,
        max_positions=args.max_positions,
        scan_interval_min=args.scan_interval,
        trading_interval_sec=config.PAPER_TRADING_INTERVAL_SEC,
        report_interval_min=config.PAPER_REPORT_INTERVAL_MIN,
        verbose=args.verbose,
        end_time=end_time,
    )

    if not manager.startup():
        print("[실패] 포트폴리오 초기화 실패")
        sys.exit(1)

    manager.run()


if __name__ == "__main__":
    main()

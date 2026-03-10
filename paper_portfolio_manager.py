"""멀티코인 페이퍼 포트폴리오 매니저 — 여러 AdaptivePaperTrader를 조율한다.

CoinScreener로 30분마다 코인을 발굴하고, 각 코인에 대해
6전략 평가 → 최적 전략 선택 → 독립 트레이딩 사이클을 관리한다.

사용법:
  python3 paper_portfolio_manager.py --capital 10000000 --verbose
  python3 paper_portfolio_manager.py --capital 10000000 --end-time "2026-03-11 07:00"
"""
import argparse
import signal as signal_mod
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import schedule

import config
from dashboard.shared_state import PaperStateWriter
from paper_trader import AdaptivePaperTrader, PaperTrade
from screener.coin_screener import CoinScreener, CoinScore


@dataclass
class PaperCoinSlot:
    """활성 코인 슬롯 상태."""
    coin: str
    trader: AdaptivePaperTrader
    allocated_krw: float
    activated_at: datetime
    draining: bool = False        # True → 신규 진입 차단, 포지션 청산 후 제거
    drain_reason: str = ""


class PaperPortfolioManager:
    """멀티코인 페이퍼 트레이딩 오케스트레이터.

    라이프사이클:
      1. startup() — 초기 스캔 + 상위 N개 코인 활성화
      2. run() — 스케줄러 루프 (매 5분 트레이딩, 매 30분 스캔)
      3. shutdown() — 전체 포지션 청산 + 최종 보고서
    """

    def __init__(
        self,
        initial_capital: float = config.PAPER_INITIAL_KRW,
        max_positions: int = config.MAX_POSITIONS,
        scan_interval_min: int = config.PAPER_SCAN_INTERVAL_MINUTES,
        trading_interval_min: int = config.PAPER_TRADING_INTERVAL_MIN,
        report_interval_min: int = config.PAPER_REPORT_INTERVAL_MIN,
        verbose: bool = False,
        end_time: Optional[datetime] = None,
    ) -> None:
        self._initial_capital = initial_capital
        self._unallocated_krw = initial_capital
        self._max_positions = max_positions
        self._per_coin_krw = initial_capital / max_positions
        self._scan_interval_min = scan_interval_min
        self._trading_interval_min = trading_interval_min
        self._report_interval_min = report_interval_min
        self._verbose = verbose
        self._end_time = end_time

        # 외부 컴포넌트
        self._screener = CoinScreener(
            min_volume_krw=config.SCREENER_MIN_VOLUME_KRW,
            min_range_pct=config.SCREENER_MIN_RANGE_PCT,
            top_volume_n=config.SCREENER_TOP_VOLUME_N,
        )

        # 상태
        self._slots: Dict[str, PaperCoinSlot] = {}
        self._blacklist: Dict[str, datetime] = {}  # coin → 차단 만료 시각
        self._running = False
        self._scan_count = 0
        self._cycle_count = 0

    # ── 라이프사이클 ──────────────────────────────────────────

    def startup(self) -> bool:
        """초기 스캔 → 상위 코인 활성화."""
        self._print_header()
        print("\n[스캔] 초기 코인 스크리닝 중...")
        scores = self._screener.scan()
        self._scan_count += 1

        if not scores:
            print("[오류] 스크리너 결과 없음")
            return False

        print(f"[스캔] 후보 {len(scores)}개 발견, "
              f"상위 {self._max_positions}개 활성화 시도")

        activated = 0
        for score in scores:
            if activated >= self._max_positions:
                break
            if self._try_activate(score):
                activated += 1

        if activated == 0:
            print("[오류] 활성화된 코인이 없습니다")
            return False

        print(f"\n[시작] {activated}개 코인 활성화 완료")
        for coin, slot in self._slots.items():
            strategy = slot.trader._active_strategy_name
            print(f"  {coin}: {strategy} (자본: {slot.allocated_krw:,.0f}원)")

        PaperStateWriter.update_portfolio(self)
        return True

    def run(self) -> None:
        """메인 스케줄러 루프."""
        self._running = True

        schedule.every(self._trading_interval_min).minutes.do(
            self._safe_all_cycles
        )
        schedule.every(self._scan_interval_min).minutes.do(
            self._safe_scan_and_update
        )
        schedule.every(self._report_interval_min).minutes.do(
            self._print_portfolio_report
        )

        # 즉시 첫 트레이딩 사이클
        self._safe_all_cycles()

        signal_mod.signal(signal_mod.SIGINT, self._handle_shutdown)
        signal_mod.signal(signal_mod.SIGTERM, self._handle_shutdown)

        while self._running:
            if self._end_time and datetime.now() >= self._end_time:
                print(f"\n[종료] 종료 시각 도달: {self._end_time}")
                break
            schedule.run_pending()
            time.sleep(1)

        self.shutdown()

    def shutdown(self) -> None:
        """전체 포지션 청산 + 최종 보고서."""
        self._running = False
        schedule.clear()
        print("\n" + "=" * 60)
        print("  포트폴리오 최종 정산")
        print("=" * 60)

        for coin, slot in list(self._slots.items()):
            if slot.trader._position:
                print(f"  [{coin}] 포지션 강제 청산...")
            self._unallocated_krw += slot.trader._balance_krw

        self._print_portfolio_report()
        PaperStateWriter.update_portfolio(self)

    def _handle_shutdown(self, signum, frame) -> None:
        """시그널 핸들러."""
        print("\n[시그널] 종료 요청 수신")
        self._running = False

    # ── 트레이딩 사이클 ───────────────────────────────────────

    def _safe_all_cycles(self) -> None:
        """모든 활성 트레이더의 사이클 실행."""
        self._cycle_count += 1

        for coin, slot in list(self._slots.items()):
            # 드레인 중 + 포지션 없으면 스킵
            if slot.draining and slot.trader._position is None:
                continue
            try:
                slot.trader.trading_cycle()
            except Exception as e:
                print(f"[{coin}] 사이클 오류: {e}")

        # 드레인 완료 슬롯 정리
        self._clean_drained()

        # 대시보드 상태 갱신
        PaperStateWriter.update_portfolio(self)

    # ── 스캔 & 리밸런싱 ───────────────────────────────────────

    def _safe_scan_and_update(self) -> None:
        """주기적 스캔 — 코인 추가/제거."""
        try:
            self._scan_and_update()
        except Exception as e:
            print(f"[스캔] 오류: {e}")

    def _scan_and_update(self) -> None:
        """30분 주기 스캔 로직."""
        self._clean_blacklist()
        scores = self._screener.scan()
        self._scan_count += 1

        if not scores:
            return

        screened_symbols = {s.symbol for s in scores}

        # 1) 스크리너 탈락 코인 드레인
        for coin in list(self._slots.keys()):
            slot = self._slots[coin]
            if coin not in screened_symbols and not slot.draining:
                self._drain_coin(coin, "스크리너 탈락")

        # 2) 빈 슬롯에 새 코인 활성화
        active_count = sum(
            1 for s in self._slots.values() if not s.draining
        )
        available = self._max_positions - active_count

        if available > 0:
            candidates = [
                s for s in scores
                if s.symbol not in self._slots
                and s.symbol not in self._blacklist
            ]
            activated = 0
            for score in candidates:
                if activated >= available:
                    break
                if self._try_activate(score):
                    activated += 1
                    print(f"[스캔] 신규 활성화: {score.symbol} "
                          f"(변동폭: {score.range_pct:.1f}%, "
                          f"거래대금: {score.volume_krw / 1e8:.0f}억원)")

    # ── 코인 관리 ─────────────────────────────────────────────

    def _try_activate(self, score: CoinScore) -> bool:
        """단일 코인 활성화 시도."""
        coin = score.symbol

        # 자본 확인
        if self._unallocated_krw < self._per_coin_krw * 0.5:
            return False

        allocation = min(self._per_coin_krw, self._unallocated_krw)

        # 트레이더 생성 + 관리 모드 설정
        trader = AdaptivePaperTrader(
            coin=coin,
            capital=allocation,
            interval_min=self._trading_interval_min,
            report_min=self._report_interval_min,
            verbose=self._verbose,
        )
        trader._managed = True  # 포트폴리오 매니저가 상태 기록 담당

        # 6전략 평가 (startup)
        success = trader.startup()
        if not success:
            self._add_blacklist(coin, "startup 실패")
            return False

        if not trader._active_strategy_id:
            self._add_blacklist(coin, "양호한 전략 없음")
            return False

        # 슬롯 등록
        self._unallocated_krw -= allocation
        self._slots[coin] = PaperCoinSlot(
            coin=coin,
            trader=trader,
            allocated_krw=allocation,
            activated_at=datetime.now(),
        )
        return True

    def _drain_coin(self, coin: str, reason: str) -> None:
        """코인 드레인 모드 전환 (포지션 있으면 청산 대기)."""
        slot = self._slots.get(coin)
        if not slot:
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

    # ── 블랙리스트 ────────────────────────────────────────────

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

    # ── KPI 집계 ──────────────────────────────────────────────

    def portfolio_total_value(self) -> float:
        """전체 포트폴리오 가치 (미배분 + 각 트레이더 잔고 + 포지션 시가)."""
        total = self._unallocated_krw
        for slot in self._slots.values():
            total += slot.trader._balance_krw
            if slot.trader._position:
                pos = slot.trader._position
                total += pos.quantity * pos.entry_price
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
        print(f"  멀티코인 페이퍼 포트폴리오 시스템")
        print(f"  자본: {self._initial_capital:,.0f}원 | "
              f"최대: {self._max_positions}코인 | "
              f"코인당: {self._per_coin_krw:,.0f}원")
        print(f"  스캔: {self._scan_interval_min}분 | "
              f"트레이딩: {self._trading_interval_min}분 | "
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

        print(f"\n{'─' * 60}")
        print(f"  포트폴리오 보고서 | {now}")
        print(f"{'─' * 60}")
        print(f"  총 가치: {total:,.0f}원 ({ret_pct:+.2f}%)")
        print(f"  미배분: {self._unallocated_krw:,.0f}원")
        print(f"  거래: {len(trades)}건 | 승률: {win_rate:.1f}%")
        print(f"  활성: {len(self._slots)}코인 | "
              f"블랙리스트: {len(self._blacklist)}코인")

        for coin, slot in self._slots.items():
            t = slot.trader
            bal = t._balance_krw
            ret = ((bal / slot.allocated_krw) - 1) * 100
            status = "DRAIN" if slot.draining else t._active_strategy_name
            pos_str = ""
            if t._position:
                pos_str = f" [보유: {t._position.entry_price:,.0f}원]"
            print(f"  {coin:>6} | {status:<16} | "
                  f"{bal:>12,.0f}원 ({ret:+6.2f}%){pos_str}")
        print(f"{'─' * 60}")


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
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    end_time = None
    if args.end_time:
        end_time = datetime.strptime(args.end_time, "%Y-%m-%d %H:%M")
        print(f"자동 종료 예정: {end_time}")

    manager = PaperPortfolioManager(
        initial_capital=args.capital,
        max_positions=args.max_positions,
        scan_interval_min=args.scan_interval,
        trading_interval_min=config.PAPER_TRADING_INTERVAL_MIN,
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

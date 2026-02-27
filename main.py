"""
bithumb-trading-bot 메인 실행 파일

사용법:
  python main.py                    # 멀티 코인 모드 (기본값)
  python main.py --single           # 단일 코인 모드 (기존 호환)
  python main.py --paper            # 멀티 코인 페이퍼 트레이딩
  python main.py --single --paper   # 단일 코인 페이퍼 트레이딩
  python main.py --backtest         # 백테스트 + 그리드서치만 실행

startup() 실행 순서 (단일 코인):
  1. 1년 과거 데이터 수집
  2. 그리드서치로 최적 파라미터 탐색
  3. StrategyGate 4조건 검증 (미통과 시 즉시 종료)
  4. 승인된 전략으로 스케줄러 기동
  5. 매 사이클마다 실전 승률 모니터링 (65% 이하 시 자동 비활성화)

startup_multi() 실행 순서 (멀티 코인):
  1. 공유 자원 생성 (client, trade_logger, notifier)
  2. PortfolioManager 초기화
  3. 초기 스캔 + 코인 활성화
  4. 멀티코인 스케줄러 기동
"""
import argparse
import atexit
import logging
import signal
import sys
import time
from collections import deque
from datetime import datetime
from typing import Optional

import schedule

import config
from analyzer.analyzer import TradeAnalyzer
from backtest.backtest_engine import BacktestEngine
from backtest.data_fetcher import DataFetcher
from exchange.bithumb_client import BithumbClient
from exchange.paper_client import PaperClient
from learning.adaptive_engine import AdaptiveEngine
from learning.learning_log import LearningLog
from logger.trade_logger import TradeLogger
from notifier.telegram_notifier import TelegramNotifier
from risk.risk_manager import RiskManager
from portfolio.portfolio_manager import PortfolioManager
from scheduler.schedule_config import setup_multi_coin_schedule, setup_openclaw_schedule, setup_schedule
from screener.coin_screener import CoinScreener
from strategy.rsi_strategy import RSIStrategy, SignalContext
from strategy.strategy_gate import StrategyGate

# ── 로깅 설정 ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("bot.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("main")


# ── 실전 승률 모니터 ──────────────────────────────────────────────────────────

class LiveMonitor:
    """
    최근 N건의 실전 거래 승률을 추적한다.
    threshold 이하로 떨어지면 is_below_threshold()가 True를 반환한다.

    Args:
        window:    최근 N건 (기본 20)
        threshold: 비활성화 기준 승률 % (기본 65.0)
        min_sample: 판단에 필요한 최소 샘플 수 (기본 5)
    """

    def __init__(
        self,
        window: int = 20,
        threshold: float = 65.0,
        min_sample: int = 5,
    ) -> None:
        self.threshold = threshold
        self.min_sample = min_sample
        self._results: deque = deque(maxlen=window)

    def record(self, pnl_pct: float) -> None:
        self._results.append(pnl_pct > 0)

    def current_win_rate(self) -> float:
        if not self._results:
            return 100.0
        return sum(self._results) / len(self._results) * 100

    def is_below_threshold(self) -> bool:
        if len(self._results) < self.min_sample:
            return False
        return self.current_win_rate() < self.threshold

    def status(self) -> str:
        n = len(self._results)
        wr = self.current_win_rate()
        return (
            f"실전 승률={wr:.1f}% ({n}건) "
            + ("⚠ 임계값 미달" if self.is_below_threshold() else "✓ 정상")
        )


# ── 거래 사이클 ───────────────────────────────────────────────────────────────

class TradingBot:
    """실전 거래 사이클을 담당한다."""

    def __init__(
        self,
        client,
        strategy: RSIStrategy,
        risk_manager: RiskManager,
        trade_logger: TradeLogger,
        live_monitor: LiveMonitor,
        coin: str = "BTC",
        notifier: Optional[TelegramNotifier] = None,
        adaptive_engine: Optional[AdaptiveEngine] = None,
    ) -> None:
        self.coin = coin
        self.client = client
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.trade_logger = trade_logger
        self.live_monitor = live_monitor
        self.notifier = notifier
        self.adaptive_engine = adaptive_engine

        self._active: bool = True
        self._current_entry_id: Optional[int] = None
        self._entry_time: Optional[datetime] = None
        self._entry_price: Optional[float] = None

        # 봇 재시작 시 미청산 포지션 복구
        self._recover_open_position()

    def run_cycle(self) -> None:
        """한 사이클: 시세 → 신호 → 리스크 체크 → 주문 → 로그"""
        coin = self.coin

        if not self._active:
            logger.warning("봇이 비활성화 상태입니다.")
            return

        try:
            # 1) 실전 승률 모니터링
            if self.live_monitor.is_below_threshold():
                wr = self.live_monitor.current_win_rate()
                logger.warning(
                    f"실전 승률 {wr:.1f}% < {self.live_monitor.threshold}% — "
                    f"전략 자동 비활성화"
                )
                self.trade_logger.log_event(
                    "STRATEGY_DEACTIVATED",
                    coin,
                    {"reason": f"실전 승률 {wr:.1f}% 임계값 미달", "win_rate": wr},
                )
                if self.notifier:
                    self.notifier.notify_strategy_deactivated(wr, self.live_monitor.threshold)
                self._active = False
                return

            # 2) MDD 초과 확인
            if self.risk_manager.is_mdd_exceeded():
                logger.warning("MDD 한도 초과 — 거래 중단")
                self.trade_logger.log_event("MDD_EXCEEDED", coin, self.risk_manager.status())
                if self.notifier:
                    status = self.risk_manager.status()
                    self.notifier.notify_mdd_exceeded(
                        status["current_drawdown_pct"], self.risk_manager.max_drawdown_pct
                    )
                return

            # 3) OHLCV + 신호
            df = self.client.get_ohlcv(
                coin, interval=config.RSI_CANDLE_INTERVAL, count=config.OHLCV_CANDLE_COUNT
            )
            if df is None or df.empty:
                logger.error("OHLCV 조회 실패")
                return

            ctx: SignalContext = self.strategy.generate_signal_with_context(df)
            current_price = self.client.get_current_price(coin)
            if current_price is None:
                logger.error("현재가 조회 실패")
                return

            logger.info(
                f"[{coin}] price={current_price:,.0f} RSI={ctx.rsi_value:.1f} "
                f"vol={ctx.volume_ratio:.2f}x trend={ctx.trend} → {ctx.signal}"
            )

            # 4) 포지션 보유 중: 청산 체크
            if self._current_entry_id is not None and self._entry_price is not None:
                self._check_exit(coin, current_price, ctx)

            # 5) 포지션 없음: 진입 체크
            elif ctx.signal == "BUY":
                # 적응형 필터 체크
                if self.adaptive_engine:
                    blocked, reason = self.adaptive_engine.should_block_buy(
                        hour=datetime.now().hour, trend=ctx.trend
                    )
                    if blocked:
                        logger.info(f"[Adaptive] 매수 차단: {reason}")
                        self.trade_logger.log_event(
                            "BUY_BLOCKED", coin, {"reason": reason, "rsi": ctx.rsi_value}
                        )
                        return
                self._execute_buy(coin, current_price, ctx)

        except Exception as e:
            logger.exception(f"거래 사이클 오류: {e}")
            self.trade_logger.log_event("ERROR", coin, {"error": str(e)})
            if self.notifier:
                self.notifier.notify_error(f"[{coin}] {e}")

    # ── 진입 / 청산 ────────────────────────────────────────

    def _execute_buy(
        self, coin: str, price: float, ctx: SignalContext
    ) -> None:
        """매수 주문 실행 및 로그"""
        trade_krw = (
            self.adaptive_engine.get_trade_amount(config.TRADE_AMOUNT)
            if self.adaptive_engine
            else config.TRADE_AMOUNT
        )
        amount = trade_krw / price
        try:
            result = self.client.buy(coin, amount)
        except Exception as e:
            self.trade_logger.log_event("ORDER_ERROR", coin, {"side": "BUY", "error": str(e)})
            raise

        entry_id = self.trade_logger.log_entry(
            strategy_name=self.strategy.name,
            coin=coin,
            price=price,
            amount=amount,
            reason=ctx.reason,
            rsi_value=ctx.rsi_value,
            volume_ratio=ctx.volume_ratio,
            trend=ctx.trend,
            volatility=ctx.volatility,
            indicators=ctx.indicators,
            result=result,
        )
        self.risk_manager.record_trade("BUY", price)
        self._current_entry_id = entry_id
        self._entry_price = price
        self._entry_time = datetime.now()
        if self.notifier:
            self.notifier.notify_buy(coin, price, amount, ctx.reason)

    def _check_exit(
        self, coin: str, current_price: float, ctx: SignalContext
    ) -> None:
        """청산 조건 확인 후 매도 실행"""
        pnl_pct = (current_price - self._entry_price) / self._entry_price * 100

        should_exit = (
            pnl_pct <= -config.STOP_LOSS_PCT
            or pnl_pct >= config.TAKE_PROFIT_PCT
            or ctx.signal == "SELL"
        )

        if not should_exit:
            return

        exit_reason = RSIStrategy.build_exit_reason(
            rsi=ctx.rsi_value if ctx.signal == "SELL" else None,
            pnl_pct=pnl_pct,
            stop_loss_pct=config.STOP_LOSS_PCT,
            take_profit_pct=config.TAKE_PROFIT_PCT,
            overbought=self.strategy.overbought,
        )

        hold_minutes = (
            (datetime.now() - self._entry_time).total_seconds() / 60
            if self._entry_time else 0.0
        )

        balance = self.client.get_coin_balance(coin) or 0.0
        if balance <= 0:
            logger.warning("청산할 잔고 없음")
            self._reset_position()
            return

        try:
            result = self.client.sell(coin, balance)
        except Exception as e:
            self.trade_logger.log_event(
                "ORDER_ERROR", coin, {"side": "SELL", "error": str(e)}
            )
            raise

        self.trade_logger.log_exit(
            entry_id=self._current_entry_id,
            coin=coin,
            price=current_price,
            amount=balance,
            exit_reason=exit_reason,
            pnl_pct=round(pnl_pct, 4),
            hold_minutes=round(hold_minutes, 1),
            result=result,
        )
        self.risk_manager.record_trade("SELL", current_price)
        self.live_monitor.record(pnl_pct)
        self._reset_position()
        if self.notifier:
            self.notifier.notify_sell(coin, current_price, balance, pnl_pct, exit_reason)

        logger.info(
            f"청산 완료 | pnl={pnl_pct:+.2f}% | hold={hold_minutes:.0f}m | {exit_reason}"
        )
        logger.info(f"[Monitor] {self.live_monitor.status()}")

    def _reset_position(self) -> None:
        self._current_entry_id = None
        self._entry_price = None
        self._entry_time = None

    def _recover_open_position(self) -> None:
        """봇 재시작 시 미청산 포지션을 DB에서 복구한다."""
        open_entry = self.trade_logger.get_open_entry(self.coin)
        if open_entry:
            self._current_entry_id = open_entry["id"]
            self._entry_price = open_entry["price"]
            try:
                self._entry_time = datetime.fromisoformat(open_entry["timestamp"])
            except Exception:
                self._entry_time = datetime.now()
            logger.info(
                f"미청산 포지션 복구: entry_id={self._current_entry_id} "
                f"price={self._entry_price:,.0f}"
            )

    @property
    def is_active(self) -> bool:
        return self._active


# ── 시작 로직 ─────────────────────────────────────────────────────────────────

def startup(paper: bool = False) -> Optional[TradingBot]:
    """
    봇 시작 전 검증 절차.

    Args:
        paper: True이면 페이퍼 트레이딩 모드로 시작

    Returns:
        TradingBot 인스턴스 (성공) | None (실패)
    """
    mode_label = "[PAPER] 페이퍼 트레이딩" if paper else "실전 거래"
    logger.info("=" * 60)
    logger.info(f"  bithumb-trading-bot 시작 ({mode_label})")
    logger.info("=" * 60)

    # ── 컴포넌트 초기화 ───────────────────────────────────
    real_client = BithumbClient(config.BITHUMB_API_KEY, config.BITHUMB_SECRET_KEY)
    if paper:
        client = PaperClient(real_client, initial_krw=config.PAPER_INITIAL_KRW)
    else:
        client = real_client
    trade_logger = TradeLogger(config.DB_PATH)
    risk_manager = RiskManager(
        stop_loss_pct=config.STOP_LOSS_PCT,
        take_profit_pct=config.TAKE_PROFIT_PCT,
        max_drawdown_pct=config.MAX_DRAWDOWN_PCT,
    )
    live_monitor = LiveMonitor(
        window=config.LIVE_MONITOR_WINDOW,
        threshold=config.LIVE_WIN_RATE_THRESHOLD,
        min_sample=config.LIVE_MONITOR_MIN_SAMPLE,
    )

    # ── Step 1: 과거 데이터 수집 ──────────────────────────
    logger.info(f"[Step 1] 과거 데이터 수집 ({config.TRADE_COIN} / {config.BACKTEST_DAYS}일)")
    fetcher = DataFetcher(client)
    historical_df = fetcher.fetch(
        config.TRADE_COIN,
        days=config.BACKTEST_DAYS,
        interval="24h",  # 1년 일봉 → 365개
    )

    if historical_df is None or historical_df.empty:
        logger.error("과거 데이터 수집 실패 — 봇 종료")
        trade_logger.log_event("STARTUP_FAIL", config.TRADE_COIN, {"reason": "과거 데이터 없음"})
        return None

    logger.info(f"  수집 완료: {len(historical_df)}개 캔들")

    # ── Step 2: 그리드서치로 최적 파라미터 탐색 ───────────
    logger.info("[Step 2] 그리드서치 파라미터 최적화")
    base_strategy = RSIStrategy(
        period=config.RSI_PERIOD,
        oversold=config.RSI_OVERSOLD,
        overbought=config.RSI_OVERBOUGHT,
    )
    engine = BacktestEngine(base_strategy)
    gs = engine.grid_search(historical_df)
    logger.info(engine.top_results(gs, n=3))

    best_params = gs.best_params
    best_result = gs.best_result
    best_result.best_params = best_params

    # ── Step 3: StrategyGate 4조건 검증 ───────────────────
    logger.info("[Step 3] StrategyGate 검증")
    gate = StrategyGate(
        min_win_rate=config.MIN_WIN_RATE,
        min_trades=config.MIN_BACKTEST_TRADES,
        max_mdd=config.MAX_DRAWDOWN_PCT,
        min_profit_factor=config.MIN_PROFIT_FACTOR,
    )
    gate_result = gate.check(best_result)

    if not gate_result.passed:
        logger.error(
            f"StrategyGate 미통과 — {', '.join(gate_result.fail_reasons)}"
        )
        trade_logger.log_event(
            "GATE_FAIL",
            config.TRADE_COIN,
            {
                "fail_reasons": gate_result.fail_reasons,
                "win_rate": gate_result.win_rate,
                "profit_factor": gate_result.profit_factor,
                "mdd": gate_result.max_drawdown_pct,
                "total_trades": gate_result.total_trades,
            },
        )
        return None

    logger.info(
        f"  StrategyGate 통과 — 최적 파라미터: {best_params} | "
        f"승률={best_result.win_rate:.1f}% | PF={best_result.profit_factor:.2f}"
    )

    # ── Step 4: 승인된 파라미터로 전략 인스턴스 생성 ───────
    logger.info("[Step 4] 전략 배포")
    live_strategy = RSIStrategy(
        period=best_params.get("period", config.RSI_PERIOD),
        oversold=best_params.get("oversold", config.RSI_OVERSOLD),
        overbought=best_params.get("overbought", config.RSI_OVERBOUGHT),
    )

    trade_logger.log_event(
        "STRATEGY_DEPLOYED",
        config.TRADE_COIN,
        {
            "params": best_params,
            "backtest_win_rate": best_result.win_rate,
            "backtest_pf": best_result.profit_factor,
            "backtest_mdd": best_result.max_drawdown_pct,
        },
    )
    logger.info(f"  전략 배포 완료: RSI(period={live_strategy.period}, "
                f"oversold={live_strategy.oversold}, "
                f"overbought={live_strategy.overbought})")

    # ── Step 5: 적응형 학습 엔진 초기화 ────────────────────
    notifier = TelegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID)
    learning_log = LearningLog(config.DB_PATH)
    adaptive_engine = AdaptiveEngine(
        strategy=live_strategy,
        trade_logger=trade_logger,
        learning_log=learning_log,
        gate=gate,
        client=client,
        notifier=notifier,
        coin=config.TRADE_COIN,
    )
    logger.info("[Step 5] 적응형 학습 엔진 초기화 완료")

    # ── Step 6: TradingBot 생성 ────────────────────────────
    bot = TradingBot(
        client=client,
        strategy=live_strategy,
        risk_manager=risk_manager,
        trade_logger=trade_logger,
        live_monitor=live_monitor,
        coin=config.TRADE_COIN,
        notifier=notifier,
        adaptive_engine=adaptive_engine,
    )
    mode_label = "PAPER" if paper else "LIVE"
    notifier.notify_bot_start(mode_label, config.TRADE_COIN)
    return bot


# ── Graceful Shutdown ─────────────────────────────────────────────────────────

_shutdown_requested = False


def _handle_shutdown(signum, frame) -> None:
    """SIGINT/SIGTERM 수신 시 안전한 종료 플래그를 설정한다."""
    global _shutdown_requested
    sig_name = signal.Signals(signum).name
    logger.info(f"종료 신호 수신: {sig_name} — 안전한 종료 시작")
    _shutdown_requested = True


def _cleanup(bot: Optional["TradingBot"], trade_logger: Optional[TradeLogger]) -> None:
    """봇 종료 시 열린 포지션 상태를 기록하고 리소스를 정리한다."""
    logger.info("클린업 시작...")
    if bot and bot._current_entry_id is not None:
        logger.warning(
            f"미청산 포지션 존재: entry_id={bot._current_entry_id} "
            f"price={bot._entry_price:,.0f}"
        )
        if trade_logger:
            trade_logger.log_event(
                "SHUTDOWN_WITH_POSITION",
                config.TRADE_COIN,
                {
                    "entry_id": bot._current_entry_id,
                    "entry_price": bot._entry_price,
                    "reason": "graceful shutdown",
                },
            )
    if trade_logger:
        trade_logger.log_event("BOT_SHUTDOWN", config.TRADE_COIN, {"reason": "graceful shutdown"})
    if bot and hasattr(bot, "notifier") and bot.notifier:
        bot.notifier.notify_bot_stop()
    logger.info("봇 종료 완료")


# ── 메인 루프 ─────────────────────────────────────────────────────────────────

def main_single(paper: bool = False) -> None:
    """단일 코인 모드 메인 루프 (기존 호환)."""
    global _shutdown_requested

    # 시그널 핸들러 등록
    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

    bot = startup(paper=paper)
    if bot is None:
        logger.error("봇 초기화 실패 — 종료")
        sys.exit(1)

    # atexit로 종료 시 클린업 보장
    atexit.register(_cleanup, bot, bot.trade_logger)

    # ── 5-job OpenClaw 스케줄 정의 ──────────────────────────

    def trading_job():
        """매 5분: 신호 감지 및 매매"""
        if bot.is_active:
            bot.run_cycle()
        else:
            logger.warning("봇 비활성화 상태 — 사이클 건너뜀")

    def performance_job():
        """매 1시간: 실전 성과 집계 로그"""
        logger.info(f"[Performance] {bot.live_monitor.status()}")
        logger.info(f"[Performance] Risk: {bot.risk_manager.status()}")
        _print_analysis(bot.trade_logger)

    def backtest_job():
        """매일 00:00: 1년 롤링 백테스트 재실행"""
        logger.info("[Daily] 일일 롤링 백테스트 시작")
        try:
            fetcher = DataFetcher(bot.client)
            df = fetcher.fetch(config.TRADE_COIN, days=config.BACKTEST_DAYS, interval="24h")
            if df is not None and not df.empty:
                engine = BacktestEngine(bot.strategy)
                result = engine.run(df)
                gate = StrategyGate(
                    min_win_rate=config.MIN_WIN_RATE,
                    min_trades=config.MIN_BACKTEST_TRADES,
                    max_mdd=config.MAX_DRAWDOWN_PCT,
                    min_profit_factor=config.MIN_PROFIT_FACTOR,
                )
                gate_result = gate.check(result)
                if not gate_result.passed:
                    logger.warning(f"[Daily] 롤링 백테스트 게이트 미통과: {gate_result.fail_reasons}")
                    bot.trade_logger.log_event(
                        "DAILY_GATE_FAIL", config.TRADE_COIN,
                        {"fail_reasons": gate_result.fail_reasons},
                    )
                    if bot.notifier:
                        bot.notifier.send(
                            f"<b>일일 백테스트 게이트 미통과</b>\n{', '.join(gate_result.fail_reasons)}"
                        )
                else:
                    logger.info("[Daily] 롤링 백테스트 게이트 통과")
        except Exception as e:
            logger.error(f"[Daily] 백테스트 오류: {e}")

    def gridsearch_job():
        """매주 월요일 00:05: 파라미터 그리드서치"""
        logger.info("[Weekly] 주간 그리드서치 시작")
        try:
            fetcher = DataFetcher(bot.client)
            df = fetcher.fetch(config.TRADE_COIN, days=config.BACKTEST_DAYS, interval="24h")
            if df is not None and not df.empty:
                engine = BacktestEngine(bot.strategy)
                gs = engine.grid_search(df)
                logger.info(engine.top_results(gs, n=3))
                bot.trade_logger.log_event(
                    "WEEKLY_GRIDSEARCH", config.TRADE_COIN,
                    {"best_params": gs.best_params, "win_rate": gs.best_result.win_rate},
                )
                # 적응형 엔진에 결과 전달 (다음 adaptation_cycle에서 평가)
                if bot.adaptive_engine:
                    bot.adaptive_engine.receive_gridsearch_result(
                        gs.best_params, gs.best_result
                    )
        except Exception as e:
            logger.error(f"[Weekly] 그리드서치 오류: {e}")

    def report_job():
        """매일 09:00: 리포트 생성 및 알림"""
        logger.info("[Report] 일일 리포트 생성")
        try:
            trades = bot.trade_logger.get_completed_trades()
            if trades:
                analyzer = TradeAnalyzer(trades)
                report_text = analyzer.report()
                logger.info("\n" + report_text)
                if bot.notifier:
                    # 텔레그램 메시지 길이 제한으로 요약만 전송
                    r = analyzer.analyze()
                    bot.notifier.send(
                        f"<b>일일 리포트</b>\n"
                        f"총 거래: {r.total_trades}\n"
                        f"승률: {r.win_rate:.1f}%\n"
                        f"PF: {r.profit_factor:.2f}\n"
                        f"Monitor: {bot.live_monitor.status()}"
                    )
        except Exception as e:
            logger.error(f"[Report] 리포트 생성 오류: {e}")

    def adaptation_job():
        """매 6시간: 적응형 학습 사이클"""
        if bot.adaptive_engine:
            logger.info("[Adaptive] 적응형 학습 사이클 시작")
            try:
                proposals = bot.adaptive_engine.run_adaptation_cycle()
                logger.info(f"[Adaptive] 사이클 완료: {len(proposals)}건 적용")
            except Exception as e:
                logger.error(f"[Adaptive] 학습 사이클 오류: {e}")

    setup_openclaw_schedule(
        trading_job=trading_job,
        performance_job=performance_job,
        backtest_job=backtest_job,
        gridsearch_job=gridsearch_job,
        report_job=report_job,
        adaptation_job=adaptation_job,
    )
    logger.info("OpenClaw 스케줄러 기동 (6-job)")

    # 즉시 1회 실행
    trading_job()

    while not _shutdown_requested:
        schedule.run_pending()
        time.sleep(1)

    # 종료 처리
    logger.info("메인 루프 종료 — 클린업 실행")
    _cleanup(bot, bot.trade_logger)
    atexit.unregister(_cleanup)  # atexit 중복 실행 방지


def _print_analysis(trade_logger: TradeLogger) -> None:
    """거래 분석 리포트를 로그로 출력한다."""
    try:
        trades = trade_logger.get_completed_trades()
        if trades:
            analyzer = TradeAnalyzer(trades)
            logger.info("\n" + analyzer.report())
    except Exception as e:
        logger.error(f"분석 리포트 출력 실패: {e}")


# ── 멀티코인 모드 ──────────────────────────────────────────────────────────────

def startup_multi(paper: bool = False) -> Optional[PortfolioManager]:
    """
    멀티코인 모드 시작.

    1. 공유 자원 생성 (client, trade_logger, notifier)
    2. PortfolioManager 초기화
    3. 초기 스캔 + 코인 활성화

    Returns:
        PortfolioManager 인스턴스 (성공) | None (실패)
    """
    mode_label = "[PAPER] 페이퍼 트레이딩" if paper else "실전 거래"
    logger.info("=" * 60)
    logger.info(f"  bithumb-trading-bot 멀티코인 모드 시작 ({mode_label})")
    logger.info("=" * 60)

    # 공유 자원 생성
    real_client = BithumbClient(config.BITHUMB_API_KEY, config.BITHUMB_SECRET_KEY)
    if paper:
        client = PaperClient(real_client, initial_krw=config.PAPER_INITIAL_KRW)
    else:
        client = real_client

    trade_logger = TradeLogger(config.DB_PATH)
    notifier = TelegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID)

    # 스크리너 생성
    screener = CoinScreener(
        min_volume_krw=config.SCREENER_MIN_VOLUME_KRW,
        min_range_pct=config.SCREENER_MIN_RANGE_PCT,
        top_volume_n=config.SCREENER_TOP_VOLUME_N,
    )

    # PortfolioManager 생성
    portfolio = PortfolioManager(
        client=client,
        trade_logger=trade_logger,
        notifier=notifier,
        screener=screener,
        max_positions=config.MAX_POSITIONS,
        portfolio_mdd_pct=config.PORTFOLIO_MDD_PCT,
        per_coin_allocation_pct=config.PER_COIN_ALLOCATION_PCT,
        blacklist_ttl_hours=config.BLACKLIST_TTL_HOURS,
    )

    # 초기 스캔
    logger.info("[Startup] 초기 코인 스캔 시작")
    activated = portfolio.scan_and_update()
    if activated:
        logger.info(f"[Startup] 초기 활성화: {', '.join(activated)}")
    else:
        logger.warning("[Startup] 초기 스캔에서 활성화된 코인 없음 — 다음 스캔까지 대기")

    mode = "PAPER" if paper else "LIVE"
    notifier.send(
        f"<b>멀티코인 봇 시작</b>\n"
        f"모드: {mode}\n"
        f"최대 포지션: {config.MAX_POSITIONS}\n"
        f"활성 코인: {', '.join(portfolio.active_coins) or '대기 중'}"
    )

    return portfolio


def _cleanup_multi(
    portfolio: Optional[PortfolioManager],
    trade_logger: Optional[TradeLogger],
) -> None:
    """멀티코인 모드 종료 시 모든 활성 코인의 상태를 기록한다."""
    logger.info("멀티코인 클린업 시작...")
    if portfolio:
        for coin in portfolio.all_coins:
            if portfolio.has_position(coin):
                logger.warning(f"미청산 포지션: {coin}")
                if trade_logger:
                    trade_logger.log_event(
                        "SHUTDOWN_WITH_POSITION", coin,
                        {"reason": "graceful shutdown (multi)"},
                    )
    if trade_logger:
        trade_logger.log_event("BOT_SHUTDOWN", "PORTFOLIO", {"reason": "graceful shutdown"})
    if portfolio and portfolio._slots:
        first_slot = next(iter(portfolio._slots.values()), None)
        if first_slot and hasattr(first_slot.bot, "notifier") and first_slot.bot.notifier:
            first_slot.bot.notifier.notify_bot_stop("멀티코인 graceful shutdown")
    logger.info("멀티코인 봇 종료 완료")


def main_multi(paper: bool = False) -> None:
    """멀티코인 모드 메인 루프."""
    global _shutdown_requested

    signal.signal(signal.SIGINT, _handle_shutdown)
    signal.signal(signal.SIGTERM, _handle_shutdown)

    portfolio = startup_multi(paper=paper)
    if portfolio is None:
        logger.error("멀티코인 봇 초기화 실패 — 종료")
        sys.exit(1)

    atexit.register(_cleanup_multi, portfolio, portfolio.trade_logger)

    # ── 멀티코인 스케줄 잡 정의 ─────────────────────────────

    def trading_job():
        """매 5분: 모든 활성 코인 트레이딩 사이클"""
        portfolio.run_all_cycles()

    def scan_job():
        """매 30분: 스크리너 실행 + 코인 활성화/비활성화"""
        try:
            scores = portfolio.screener.scan()
            # 스크리너 탈락 코인 비활성화
            deactivated = portfolio.check_and_deactivate_stale(scores)
            if deactivated:
                logger.info(f"[Scan] 비활성화: {', '.join(deactivated)}")
            # 신규 코인 활성화
            activated = portfolio.scan_and_update()
            if activated:
                logger.info(f"[Scan] 신규 활성화: {', '.join(activated)}")
            logger.info(f"[Scan] 포트폴리오: {portfolio.status_text()}")
        except Exception as e:
            logger.error(f"[Scan] 스캔 오류: {e}")

    def performance_job():
        """매 1시간: 포트폴리오 성과 집계"""
        logger.info(f"[Performance]\n{portfolio.status_text()}")
        if portfolio.notifier:
            portfolio.notifier.notify_portfolio_status(portfolio.status_text())

    def adaptation_job():
        """매 6시간: 모든 활성 코인 적응형 학습"""
        portfolio.run_all_adaptations()

    def report_job():
        """매일 09:00: 포트폴리오 리포트"""
        logger.info("[Report] 포트폴리오 일일 리포트 생성")
        try:
            trades = portfolio.trade_logger.get_completed_trades()
            if trades:
                analyzer = TradeAnalyzer(trades)
                report_text = analyzer.report()
                logger.info("\n" + report_text)
                if portfolio.notifier:
                    r = analyzer.analyze()
                    portfolio.notifier.send(
                        f"<b>포트폴리오 일일 리포트</b>\n"
                        f"총 거래: {r.total_trades}\n"
                        f"승률: {r.win_rate:.1f}%\n"
                        f"PF: {r.profit_factor:.2f}\n"
                        f"활성 코인: {', '.join(portfolio.active_coins)}"
                    )
        except Exception as e:
            logger.error(f"[Report] 리포트 오류: {e}")

    setup_multi_coin_schedule(
        trading_job=trading_job,
        scan_job=scan_job,
        performance_job=performance_job,
        adaptation_job=adaptation_job,
        report_job=report_job,
    )
    logger.info("멀티코인 스케줄러 기동 (5-job)")

    # 즉시 1회 실행
    trading_job()

    while not _shutdown_requested:
        schedule.run_pending()
        time.sleep(1)

    # 종료 처리
    logger.info("멀티코인 메인 루프 종료 — 클린업 실행")
    _cleanup_multi(portfolio, portfolio.trade_logger)
    atexit.unregister(_cleanup_multi)


def run_backtest_only(interval: str = "24h") -> int:
    """
    --backtest 모드: 백테스트 + 그리드서치 결과를 출력하고 종료.

    Args:
        interval: 캔들 단위 ('1h' 권장 — 신호 건수 충분, '24h' — 빠른 확인용)

    Returns:
        exit code (0=성공/게이트통과, 1=데이터없음/게이트실패)
    """
    print("=" * 60)
    print(f"  bithumb-trading-bot — 백테스트 모드 [{interval}봉]")
    print("=" * 60)

    client = BithumbClient(config.BITHUMB_API_KEY, config.BITHUMB_SECRET_KEY)
    fetcher = DataFetcher(client)

    print(f"\n[1/3] 과거 데이터 수집 ({config.TRADE_COIN} / {config.BACKTEST_DAYS}일 / {interval}봉)")
    df = fetcher.fetch(config.TRADE_COIN, days=config.BACKTEST_DAYS, interval=interval)
    if df is None or df.empty:
        print("  ✗ 데이터 수집 실패")
        return 1

    print(f"  ✓ {len(df)}개 캔들 ({df.index[0].date()} ~ {df.index[-1].date()})")

    print(f"\n[2/3] 그리드서치 파라미터 최적화")
    base_strategy = RSIStrategy(config.RSI_PERIOD, config.RSI_OVERSOLD, config.RSI_OVERBOUGHT)
    engine = BacktestEngine(base_strategy)
    gs = engine.grid_search(df)

    print("\n" + engine.top_results(gs, n=5))

    print(f"\n[3/3] StrategyGate 4조건 검증")
    gate = StrategyGate(
        min_win_rate=config.MIN_WIN_RATE,
        min_trades=config.MIN_BACKTEST_TRADES,
        max_mdd=config.MAX_DRAWDOWN_PCT,
        min_profit_factor=config.MIN_PROFIT_FACTOR,
    )
    # check() 한 번만 호출해 결과 재사용 (이중 로그 방지)
    gate_result = gate.check(gs.best_result)

    checks = [
        ("승률",  gate_result.win_rate_pass,       f"{gate_result.win_rate:.1f}%    (기준: ≥{config.MIN_WIN_RATE}%)"),
        ("샘플",  gate_result.min_trades_pass,      f"{gate_result.total_trades}건   (기준: ≥{config.MIN_BACKTEST_TRADES})"),
        ("MDD",   gate_result.mdd_pass,             f"{gate_result.max_drawdown_pct:.1f}%  (기준: ≤{config.MAX_DRAWDOWN_PCT}%)"),
        ("PF",    gate_result.profit_factor_pass,   f"{gate_result.profit_factor:.2f}   (기준: ≥{config.MIN_PROFIT_FACTOR})"),
    ]
    for name, ok, val in checks:
        mark = "✓" if ok else "✗"
        print(f"  {mark} {name}: {val}")

    if gate_result.passed:
        print(f"\n  ✓ PASS — 최적 파라미터: {gs.best_params}")
        print("  실전 배포 가능합니다. `python main.py` 로 봇을 시작하세요.")
    else:
        print(f"\n  ✗ FAIL — {', '.join(gate_result.fail_reasons)}")
        print("\n  [원인 분석]")
        if not gate_result.min_trades_pass:
            print(f"   · 거래 건수 부족: 24h봉({len(df)}개)은 신호 발생 빈도가 낮습니다.")
            print(f"     → 1시간봉으로 재실행: python main.py --backtest --interval 1h")
        if not gate_result.win_rate_pass:
            print(f"   · 승률 미달: 현재 시장이 RSI 전략에 불리한 구간일 수 있습니다.")
        if not gate_result.mdd_pass:
            print(f"   · MDD 초과: 손절 기준(-{config.STOP_LOSS_PCT}%)이 너무 넓거나 하락장입니다.")
        if not gate_result.profit_factor_pass:
            print(f"   · PF 미달: 익절(+{config.TAKE_PROFIT_PCT}%) 대비 손절(-{config.STOP_LOSS_PCT}%) 비율 재검토 필요.")

    print("=" * 60)
    return 0 if gate_result.passed else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="bithumb-trading-bot",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  python main.py                           멀티 코인 모드 (기본값)
  python main.py --single                  단일 코인 모드 (기존 호환)
  python main.py --paper                   멀티 코인 페이퍼 트레이딩
  python main.py --single --paper          단일 코인 페이퍼 트레이딩
  python main.py --backtest                백테스트 (24h봉, 빠른 확인)
  python main.py --backtest --interval 1h  백테스트 (1h봉, 신호 건수 충분)
        """,
    )
    parser.add_argument(
        "--single",
        action="store_true",
        help="단일 코인 모드 (기존 호환, config.TRADE_COIN 사용)",
    )
    parser.add_argument(
        "--backtest",
        action="store_true",
        help="백테스트 + 그리드서치만 실행하고 종료",
    )
    parser.add_argument(
        "--paper",
        action="store_true",
        help="페이퍼 트레이딩 모드 (실제 주문 없이 시뮬레이션)",
    )
    parser.add_argument(
        "--interval",
        default="24h",
        choices=["1m", "3m", "5m", "10m", "30m", "1h", "6h", "12h", "24h"],
        help="백테스트용 캔들 단위 (기본: 24h)",
    )
    args = parser.parse_args()

    if args.backtest:
        sys.exit(run_backtest_only(interval=args.interval))
    else:
        paper_mode = args.paper or config.PAPER_TRADING
        if args.single:
            main_single(paper=paper_mode)
        else:
            main_multi(paper=paper_mode)

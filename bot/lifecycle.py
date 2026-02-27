"""봇 라이프사이클 관리 — 시작(startup), 종료(cleanup), 백테스트를 담당한다."""
import logging
import signal
from typing import Optional

import config
from backtest.backtest_engine import BacktestEngine
from backtest.data_fetcher import DataFetcher
from bot.trading_bot import LiveMonitor, TradingBot
from exchange.bithumb_client import BithumbClient
from exchange.paper_client import PaperClient
from learning.adaptive_engine import AdaptiveEngine
from learning.learning_log import LearningLog
from logger.trade_logger import TradeLogger
from notifier.telegram_notifier import TelegramNotifier
from portfolio.portfolio_manager import PortfolioManager
from risk.risk_manager import RiskManager
from screener.coin_screener import CoinScreener
from strategy.rsi_strategy import RSIStrategy
from strategy.strategy_gate import StrategyGate

logger = logging.getLogger("bot.lifecycle")

# ── Shutdown 플래그 ──────────────────────────────────────────────────────────

_shutdown_requested = False


def is_shutdown_requested() -> bool:
    return _shutdown_requested


def handle_shutdown(signum, frame) -> None:
    """SIGINT/SIGTERM 수신 시 안전한 종료 플래그를 설정한다."""
    global _shutdown_requested
    sig_name = signal.Signals(signum).name
    logger.info(f"종료 신호 수신: {sig_name} — 안전한 종료 시작")
    _shutdown_requested = True


# ── 단일 코인 Startup ───────────────────────────────────────────────────────

def _create_client(paper: bool):
    """API 클라이언트를 생성한다. paper=True이면 PaperClient."""
    real_client = BithumbClient(config.BITHUMB_API_KEY, config.BITHUMB_SECRET_KEY)
    if paper:
        return PaperClient(real_client, initial_krw=config.PAPER_INITIAL_KRW)
    return real_client


def _run_gridsearch(client, coin: str):
    """과거 데이터 수집 → 그리드서치 → (df, gs) 반환. 실패 시 (None, None)."""
    logger.info(f"[Step 1] 과거 데이터 수집 ({coin} / {config.BACKTEST_DAYS}일)")
    fetcher = DataFetcher(client)
    df = fetcher.fetch(coin, days=config.BACKTEST_DAYS, interval="24h")
    if df is None or df.empty:
        logger.error("과거 데이터 수집 실패 — 봇 종료")
        return None, None
    logger.info(f"  수집 완료: {len(df)}개 캔들")

    logger.info("[Step 2] 그리드서치 파라미터 최적화")
    base_strategy = RSIStrategy(
        period=config.RSI_PERIOD,
        oversold=config.RSI_OVERSOLD,
        overbought=config.RSI_OVERBOUGHT,
    )
    engine = BacktestEngine(base_strategy)
    gs = engine.grid_search(df)
    logger.info(engine.top_results(gs, n=3))
    return df, gs


def _validate_gate(gs, trade_logger: TradeLogger) -> Optional[dict]:
    """StrategyGate 4조건 검증. 통과 시 best_params, 실패 시 None."""
    logger.info("[Step 3] StrategyGate 검증")
    gate = StrategyGate(
        min_win_rate=config.MIN_WIN_RATE,
        min_trades=config.MIN_BACKTEST_TRADES,
        max_mdd=config.MAX_DRAWDOWN_PCT,
        min_profit_factor=config.MIN_PROFIT_FACTOR,
    )
    best_params = gs.best_params
    best_result = gs.best_result
    best_result.best_params = best_params
    gate_result = gate.check(best_result)

    if not gate_result.passed:
        logger.error(f"StrategyGate 미통과 — {', '.join(gate_result.fail_reasons)}")
        trade_logger.log_event(
            "GATE_FAIL", config.TRADE_COIN,
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
    return best_params


def startup(paper: bool = False) -> Optional[TradingBot]:
    """
    단일 코인 봇 시작 전 검증 절차.

    Returns:
        TradingBot 인스턴스 (성공) | None (실패)
    """
    mode_label = "[PAPER] 페이퍼 트레이딩" if paper else "실전 거래"
    logger.info("=" * 60)
    logger.info(f"  bithumb-trading-bot 시작 ({mode_label})")
    logger.info("=" * 60)

    client = _create_client(paper)
    trade_logger = TradeLogger(config.DB_PATH)

    # Step 1-2: 데이터 수집 + 그리드서치
    df, gs = _run_gridsearch(client, config.TRADE_COIN)
    if gs is None:
        trade_logger.log_event("STARTUP_FAIL", config.TRADE_COIN, {"reason": "과거 데이터 없음"})
        return None

    # Step 3: 게이트 검증
    best_params = _validate_gate(gs, trade_logger)
    if best_params is None:
        return None

    # Step 4: 전략 배포
    logger.info("[Step 4] 전략 배포")
    live_strategy = RSIStrategy(
        period=best_params.get("period", config.RSI_PERIOD),
        oversold=best_params.get("oversold", config.RSI_OVERSOLD),
        overbought=best_params.get("overbought", config.RSI_OVERBOUGHT),
    )
    trade_logger.log_event(
        "STRATEGY_DEPLOYED", config.TRADE_COIN,
        {"params": best_params, "backtest_win_rate": gs.best_result.win_rate,
         "backtest_pf": gs.best_result.profit_factor,
         "backtest_mdd": gs.best_result.max_drawdown_pct},
    )
    logger.info(
        f"  전략 배포 완료: RSI(period={live_strategy.period}, "
        f"oversold={live_strategy.oversold}, overbought={live_strategy.overbought})"
    )

    # Step 5: 적응형 학습 + 봇 생성
    notifier = TelegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID)
    gate = StrategyGate(
        min_win_rate=config.MIN_WIN_RATE,
        min_trades=config.MIN_BACKTEST_TRADES,
        max_mdd=config.MAX_DRAWDOWN_PCT,
        min_profit_factor=config.MIN_PROFIT_FACTOR,
    )
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
    mode = "PAPER" if paper else "LIVE"
    notifier.notify_bot_start(mode, config.TRADE_COIN)
    return bot


# ── 멀티코인 Startup ────────────────────────────────────────────────────────

def startup_multi(paper: bool = False) -> Optional[PortfolioManager]:
    """
    멀티코인 모드 시작.

    Returns:
        PortfolioManager 인스턴스 (성공) | None (실패)
    """
    mode_label = "[PAPER] 페이퍼 트레이딩" if paper else "실전 거래"
    logger.info("=" * 60)
    logger.info(f"  bithumb-trading-bot 멀티코인 모드 시작 ({mode_label})")
    logger.info("=" * 60)

    client = _create_client(paper)
    trade_logger = TradeLogger(config.DB_PATH)
    notifier = TelegramNotifier(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID)

    screener = CoinScreener(
        min_volume_krw=config.SCREENER_MIN_VOLUME_KRW,
        min_range_pct=config.SCREENER_MIN_RANGE_PCT,
        top_volume_n=config.SCREENER_TOP_VOLUME_N,
    )

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


# ── Cleanup ──────────────────────────────────────────────────────────────────

def cleanup_single(bot: Optional[TradingBot], trade_logger: Optional[TradeLogger]) -> None:
    """단일 코인 봇 종료 시 열린 포지션 상태를 기록하고 리소스를 정리한다."""
    logger.info("클린업 시작...")
    if bot and bot._current_entry_id is not None:
        logger.warning(
            f"미청산 포지션 존재: entry_id={bot._current_entry_id} "
            f"price={bot._entry_price:,.0f}"
        )
        if trade_logger:
            trade_logger.log_event(
                "SHUTDOWN_WITH_POSITION", config.TRADE_COIN,
                {"entry_id": bot._current_entry_id, "entry_price": bot._entry_price,
                 "reason": "graceful shutdown"},
            )
    if trade_logger:
        trade_logger.log_event("BOT_SHUTDOWN", config.TRADE_COIN, {"reason": "graceful shutdown"})
    if bot and hasattr(bot, "notifier") and bot.notifier:
        bot.notifier.notify_bot_stop()
    logger.info("봇 종료 완료")


def cleanup_multi(
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


# ── 백테스트 전용 모드 ──────────────────────────────────────────────────────

def run_backtest_only(interval: str = "24h") -> int:
    """
    --backtest 모드: 백테스트 + 그리드서치 결과를 출력하고 종료.

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

    print("\n[2/3] 그리드서치 파라미터 최적화")
    base_strategy = RSIStrategy(config.RSI_PERIOD, config.RSI_OVERSOLD, config.RSI_OVERBOUGHT)
    engine = BacktestEngine(base_strategy)
    gs = engine.grid_search(df)
    print("\n" + engine.top_results(gs, n=5))

    print("\n[3/3] StrategyGate 4조건 검증")
    gate = StrategyGate(
        min_win_rate=config.MIN_WIN_RATE,
        min_trades=config.MIN_BACKTEST_TRADES,
        max_mdd=config.MAX_DRAWDOWN_PCT,
        min_profit_factor=config.MIN_PROFIT_FACTOR,
    )
    gate_result = gate.check(gs.best_result)
    _print_gate_result(gate_result, gs, df)

    print("=" * 60)
    return 0 if gate_result.passed else 1


def _print_gate_result(gate_result, gs, df) -> None:
    """게이트 검증 결과를 콘솔에 출력한다."""
    checks = [
        ("승률", gate_result.win_rate_pass,
         f"{gate_result.win_rate:.1f}%    (기준: ≥{config.MIN_WIN_RATE}%)"),
        ("샘플", gate_result.min_trades_pass,
         f"{gate_result.total_trades}건   (기준: ≥{config.MIN_BACKTEST_TRADES})"),
        ("MDD", gate_result.mdd_pass,
         f"{gate_result.max_drawdown_pct:.1f}%  (기준: ≤{config.MAX_DRAWDOWN_PCT}%)"),
        ("PF", gate_result.profit_factor_pass,
         f"{gate_result.profit_factor:.2f}   (기준: ≥{config.MIN_PROFIT_FACTOR})"),
    ]
    for name, ok, val in checks:
        mark = "✓" if ok else "✗"
        print(f"  {mark} {name}: {val}")

    if gate_result.passed:
        print(f"\n  ✓ PASS — 최적 파라미터: {gs.best_params}")
        print("  실전 배포 가능합니다. `python main.py` 로 봇을 시작하세요.")
    else:
        print(f"\n  ✗ FAIL — {', '.join(gate_result.fail_reasons)}")
        _print_fail_analysis(gate_result, df)


def _print_fail_analysis(gate_result, df) -> None:
    """게이트 실패 원인 분석을 출력한다."""
    print("\n  [원인 분석]")
    if not gate_result.min_trades_pass:
        print(f"   · 거래 건수 부족: 24h봉({len(df)}개)은 신호 발생 빈도가 낮습니다.")
        print("     → 1시간봉으로 재실행: python main.py --backtest --interval 1h")
    if not gate_result.win_rate_pass:
        print("   · 승률 미달: 현재 시장이 RSI 전략에 불리한 구간일 수 있습니다.")
    if not gate_result.mdd_pass:
        print(f"   · MDD 초과: 손절 기준(-{config.STOP_LOSS_PCT}%)이 너무 넓거나 하락장입니다.")
    if not gate_result.profit_factor_pass:
        print(
            f"   · PF 미달: 익절(+{config.TAKE_PROFIT_PCT}%) 대비 "
            f"손절(-{config.STOP_LOSS_PCT}%) 비율 재검토 필요."
        )

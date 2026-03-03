"""
bithumb-trading-bot 메인 실행 파일

사용법:
  python main.py                    # 멀티 코인 모드 (기본값)
  python main.py --single           # 단일 코인 모드 (기존 호환)
  python main.py --paper            # 멀티 코인 페이퍼 트레이딩
  python main.py --single --paper   # 단일 코인 페이퍼 트레이딩
  python main.py --backtest         # 백테스트 + 그리드서치만 실행
"""
import argparse
import atexit
import logging
import multiprocessing
import signal
import sys
import time

import schedule

import config
from bot.lifecycle import (
    cleanup_multi,
    cleanup_single,
    handle_shutdown,
    is_shutdown_requested,
    run_backtest_only,
    startup,
    startup_multi,
)
from bot.jobs import (
    make_adaptation_job,
    make_backtest_job,
    make_gridsearch_job,
    make_multi_adaptation_job,
    make_multi_performance_job,
    make_multi_report_job,
    make_multi_scan_job,
    make_multi_trading_job,
    make_performance_job,
    make_report_job,
    make_trading_job,
)
from scheduler.schedule_config import setup_multi_coin_schedule, setup_openclaw_schedule

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


# ── 메인 루프 ─────────────────────────────────────────────────────────────────

def main_single(paper: bool = False) -> None:
    """단일 코인 모드 메인 루프."""
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    bot = startup(paper=paper)
    if bot is None:
        logger.error("봇 초기화 실패 — 종료")
        sys.exit(1)

    atexit.register(cleanup_single, bot, bot.trade_logger)

    setup_openclaw_schedule(
        trading_job=make_trading_job(bot),
        performance_job=make_performance_job(bot),
        backtest_job=make_backtest_job(bot),
        gridsearch_job=make_gridsearch_job(bot),
        report_job=make_report_job(bot),
        adaptation_job=make_adaptation_job(bot),
    )
    logger.info("OpenClaw 스케줄러 기동 (6-job)")

    make_trading_job(bot)()  # 즉시 1회 실행

    while not is_shutdown_requested():
        schedule.run_pending()
        time.sleep(1)

    logger.info("메인 루프 종료 — 클린업 실행")
    cleanup_single(bot, bot.trade_logger)
    atexit.unregister(cleanup_single)


def main_multi(paper: bool = False) -> None:
    """멀티코인 모드 메인 루프."""
    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    portfolio = startup_multi(paper=paper)
    if portfolio is None:
        logger.error("멀티코인 봇 초기화 실패 — 종료")
        sys.exit(1)

    atexit.register(cleanup_multi, portfolio, portfolio.trade_logger)

    setup_multi_coin_schedule(
        trading_job=make_multi_trading_job(portfolio),
        scan_job=make_multi_scan_job(portfolio),
        performance_job=make_multi_performance_job(portfolio),
        adaptation_job=make_multi_adaptation_job(portfolio),
        report_job=make_multi_report_job(portfolio),
    )
    logger.info("멀티코인 스케줄러 기동 (5-job)")

    make_multi_trading_job(portfolio)()  # 즉시 1회 실행

    while not is_shutdown_requested():
        schedule.run_pending()
        time.sleep(1)

    logger.info("멀티코인 메인 루프 종료 — 클린업 실행")
    cleanup_multi(portfolio, portfolio.trade_logger)
    atexit.unregister(cleanup_multi)


# ── 엔트리포인트 ──────────────────────────────────────────────────────────────

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
        "--single", action="store_true",
        help="단일 코인 모드 (기존 호환, config.TRADE_COIN 사용)",
    )
    parser.add_argument(
        "--backtest", action="store_true",
        help="백테스트 + 그리드서치만 실행하고 종료",
    )
    parser.add_argument(
        "--paper", action="store_true",
        help="페이퍼 트레이딩 모드 (실제 주문 없이 시뮬레이션)",
    )
    parser.add_argument(
        "--interval",
        default="24h",
        choices=["1m", "3m", "5m", "10m", "30m", "1h", "6h", "12h", "24h"],
        help="백테스트용 캔들 단위 (기본: 24h)",
    )
    parser.add_argument(
        "--dashboard", action="store_true",
        help="웹 대시보드 서버를 함께 기동 (기본 포트: 8080)",
    )
    parser.add_argument(
        "--dashboard-only", action="store_true",
        help="봇 없이 대시보드 서버만 기동",
    )
    args = parser.parse_args()

    # ── 대시보드 전용 모드 ──
    if args.dashboard_only:
        from dashboard.server import run_dashboard
        logger.info(f"대시보드 전용 모드 (port={config.DASHBOARD_PORT})")
        run_dashboard(port=config.DASHBOARD_PORT)
        sys.exit(0)

    # ── 대시보드 백그라운드 기동 ──
    dashboard_proc = None
    if args.dashboard:
        from dashboard.server import run_dashboard
        dashboard_proc = multiprocessing.Process(
            target=run_dashboard,
            kwargs={"port": config.DASHBOARD_PORT},
            daemon=True,
        )
        dashboard_proc.start()
        logger.info(f"대시보드 서버 기동 (port={config.DASHBOARD_PORT}, pid={dashboard_proc.pid})")

    if args.backtest:
        sys.exit(run_backtest_only(interval=args.interval))
    else:
        paper_mode = args.paper or config.PAPER_TRADING
        if args.single:
            main_single(paper=paper_mode)
        else:
            main_multi(paper=paper_mode)

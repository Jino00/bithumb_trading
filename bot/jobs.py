"""스케줄 잡 팩토리 — 단일코인/멀티코인 모드의 주기적 작업을 정의한다."""
import logging
from typing import Callable

import config
from analyzer.analyzer import TradeAnalyzer
from backtest.backtest_engine import BacktestEngine
from backtest.data_fetcher import DataFetcher
from logger.trade_logger import TradeLogger
from strategy.strategy_gate import StrategyGate

logger = logging.getLogger("bot.jobs")


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _print_analysis(trade_logger: TradeLogger) -> None:
    """거래 분석 리포트를 로그로 출력한다."""
    try:
        trades = trade_logger.get_completed_trades()
        if trades:
            analyzer = TradeAnalyzer(trades)
            logger.info("\n" + analyzer.report())
    except Exception as e:
        logger.error(f"분석 리포트 출력 실패: {e}")


# ── 단일 코인 잡 팩토리 ──────────────────────────────────────────────────────

def make_trading_job(bot) -> Callable:
    """매 5분: 신호 감지 및 매매"""
    def job():
        if bot.is_active:
            bot.run_cycle()
        else:
            logger.warning("봇 비활성화 상태 — 사이클 건너뜀")
    return job


def make_performance_job(bot) -> Callable:
    """매 1시간: 실전 성과 집계 로그"""
    def job():
        logger.info(f"[Performance] {bot.live_monitor.status()}")
        logger.info(f"[Performance] Risk: {bot.risk_manager.status()}")
        _print_analysis(bot.trade_logger)
    return job


def make_backtest_job(bot) -> Callable:
    """매일 00:00: 1년 롤링 백테스트 재실행"""
    def job():
        logger.info("[Daily] 일일 롤링 백테스트 시작")
        try:
            fetcher = DataFetcher(bot.client)
            df = fetcher.fetch(config.TRADE_COIN, days=config.BACKTEST_DAYS, interval="24h")
            if df is None or df.empty:
                return
            engine = BacktestEngine(bot.strategy)
            result = engine.run(df)
            gate = _create_gate()
            gate_result = gate.check(result)
            if not gate_result.passed:
                _log_gate_fail(bot, gate_result)
            else:
                logger.info("[Daily] 롤링 백테스트 게이트 통과")
        except Exception as e:
            logger.error(f"[Daily] 백테스트 오류: {e}")
    return job


def make_gridsearch_job(bot) -> Callable:
    """매주 월요일 00:05: 파라미터 그리드서치"""
    def job():
        logger.info("[Weekly] 주간 그리드서치 시작")
        try:
            fetcher = DataFetcher(bot.client)
            df = fetcher.fetch(config.TRADE_COIN, days=config.BACKTEST_DAYS, interval="24h")
            if df is None or df.empty:
                return
            engine = BacktestEngine(bot.strategy)
            gs = engine.grid_search(df)
            logger.info(engine.top_results(gs, n=3))
            bot.trade_logger.log_event(
                "WEEKLY_GRIDSEARCH", config.TRADE_COIN,
                {"best_params": gs.best_params, "win_rate": gs.best_result.win_rate},
            )
            if bot.adaptive_engine:
                bot.adaptive_engine.receive_gridsearch_result(gs.best_params, gs.best_result)
        except Exception as e:
            logger.error(f"[Weekly] 그리드서치 오류: {e}")
    return job


def make_report_job(bot) -> Callable:
    """매일 09:00: 리포트 생성 및 알림"""
    def job():
        logger.info("[Report] 일일 리포트 생성")
        try:
            trades = bot.trade_logger.get_completed_trades()
            if not trades:
                return
            analyzer = TradeAnalyzer(trades)
            logger.info("\n" + analyzer.report())
            if bot.notifier:
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
    return job


def make_adaptation_job(bot) -> Callable:
    """매 6시간: 적응형 학습 사이클"""
    def job():
        if not bot.adaptive_engine:
            return
        logger.info("[Adaptive] 적응형 학습 사이클 시작")
        try:
            proposals = bot.adaptive_engine.run_adaptation_cycle()
            logger.info(f"[Adaptive] 사이클 완료: {len(proposals)}건 적용")
        except Exception as e:
            logger.error(f"[Adaptive] 학습 사이클 오류: {e}")
    return job


# ── 멀티코인 잡 팩토리 ──────────────────────────────────────────────────────

def make_multi_trading_job(portfolio) -> Callable:
    """매 5분: 모든 활성 코인 트레이딩 사이클"""
    def job():
        portfolio.run_all_cycles()
    return job


def make_multi_scan_job(portfolio) -> Callable:
    """매 30분: 스크리너 실행 + 코인 활성화/비활성화"""
    def job():
        try:
            scores = portfolio.screener.scan()
            deactivated = portfolio.check_and_deactivate_stale(scores)
            if deactivated:
                logger.info(f"[Scan] 비활성화: {', '.join(deactivated)}")
            activated = portfolio.scan_and_update()
            if activated:
                logger.info(f"[Scan] 신규 활성화: {', '.join(activated)}")
            logger.info(f"[Scan] 포트폴리오: {portfolio.status_text()}")
        except Exception as e:
            logger.error(f"[Scan] 스캔 오류: {e}")
    return job


def make_multi_performance_job(portfolio) -> Callable:
    """매 1시간: 포트폴리오 성과 집계"""
    def job():
        logger.info(f"[Performance]\n{portfolio.status_text()}")
        if portfolio.notifier:
            portfolio.notifier.notify_portfolio_status(portfolio.status_text())
    return job


def make_multi_adaptation_job(portfolio) -> Callable:
    """매 6시간: 모든 활성 코인 적응형 학습"""
    def job():
        portfolio.run_all_adaptations()
    return job


def make_multi_report_job(portfolio) -> Callable:
    """매일 09:00: 포트폴리오 리포트"""
    def job():
        logger.info("[Report] 포트폴리오 일일 리포트 생성")
        try:
            trades = portfolio.trade_logger.get_completed_trades()
            if not trades:
                return
            analyzer = TradeAnalyzer(trades)
            logger.info("\n" + analyzer.report())
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
    return job


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _create_gate() -> StrategyGate:
    return StrategyGate(
        min_win_rate=config.MIN_WIN_RATE,
        min_trades=config.MIN_BACKTEST_TRADES,
        max_mdd=config.MAX_DRAWDOWN_PCT,
        min_profit_factor=config.MIN_PROFIT_FACTOR,
    )


def _log_gate_fail(bot, gate_result) -> None:
    logger.warning(f"[Daily] 롤링 백테스트 게이트 미통과: {gate_result.fail_reasons}")
    bot.trade_logger.log_event(
        "DAILY_GATE_FAIL", config.TRADE_COIN,
        {"fail_reasons": gate_result.fail_reasons},
    )
    if bot.notifier:
        bot.notifier.send(
            f"<b>일일 백테스트 게이트 미통과</b>\n{', '.join(gate_result.fail_reasons)}"
        )

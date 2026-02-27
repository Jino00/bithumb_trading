"""
OpenClaw 스케줄 설정

스케줄 정의:
  - 매  5분: 신호 감지 및 매매 (trading_job)
  - 매  1시간: 실전 성과 집계 (performance_job)
  - 매일 00:00: 1년 롤링 백테스트 재실행 (backtest_job)
  - 매주 월요일: 파라미터 그리드서치 재실행 (gridsearch_job)
  - 매일 09:00: 리포트 생성 및 알림 (report_job)
  - 매 6시간: 적응형 학습 사이클 (adaptation_job)
"""
import logging
from typing import Callable, Optional

import schedule

logger = logging.getLogger(__name__)


def setup_openclaw_schedule(
    trading_job: Callable,
    performance_job: Optional[Callable] = None,
    backtest_job: Optional[Callable] = None,
    gridsearch_job: Optional[Callable] = None,
    report_job: Optional[Callable] = None,
    adaptation_job: Optional[Callable] = None,
) -> None:
    """
    OpenClaw 스펙에 따라 모든 주기적 작업을 등록한다.

    Args:
        trading_job:     매 5분 실행 — 신호 감지 및 매매
        performance_job: 매 1시간 실행 — 실전 성과 집계
        backtest_job:    매일 00:00 실행 — 1년 롤링 백테스트 재실행
        gridsearch_job:  매주 월요일 00:05 실행 — 파라미터 그리드서치
        report_job:      매일 09:00 실행 — 리포트 생성 및 알림
        adaptation_job:  매 6시간 실행 — 적응형 학습 사이클
    """
    schedule.clear()

    schedule.every(5).minutes.do(trading_job)
    logger.info("스케줄 등록: trading_job — 매 5분")

    if performance_job:
        schedule.every(1).hours.do(performance_job)
        logger.info("스케줄 등록: performance_job — 매 1시간")

    if backtest_job:
        schedule.every().day.at("00:00").do(backtest_job)
        logger.info("스케줄 등록: backtest_job — 매일 00:00")

    if gridsearch_job:
        schedule.every().monday.at("00:05").do(gridsearch_job)
        logger.info("스케줄 등록: gridsearch_job — 매주 월요일 00:05")

    if report_job:
        schedule.every().day.at("09:00").do(report_job)
        logger.info("스케줄 등록: report_job — 매일 09:00")

    if adaptation_job:
        schedule.every(6).hours.do(adaptation_job)
        logger.info("스케줄 등록: adaptation_job — 매 6시간")


def setup_multi_coin_schedule(
    trading_job: Callable,
    scan_job: Callable,
    performance_job: Optional[Callable] = None,
    adaptation_job: Optional[Callable] = None,
    report_job: Optional[Callable] = None,
) -> None:
    """
    멀티코인 모드 스케줄을 등록한다.

    Args:
        trading_job:     매 5분 — 모든 활성 코인 트레이딩 사이클
        scan_job:        매 30분 — 스크리너 실행 + 코인 활성화/비활성화
        performance_job: 매 1시간 — 포트폴리오 성과 집계
        adaptation_job:  매 6시간 — 모든 활성 코인 적응형 학습
        report_job:      매일 09:00 — 포트폴리오 리포트
    """
    schedule.clear()

    schedule.every(5).minutes.do(trading_job)
    logger.info("스케줄 등록: trading_job — 매 5분 (멀티코인)")

    schedule.every(30).minutes.do(scan_job)
    logger.info("스케줄 등록: scan_job — 매 30분")

    if performance_job:
        schedule.every(1).hours.do(performance_job)
        logger.info("스케줄 등록: performance_job — 매 1시간")

    if adaptation_job:
        schedule.every(6).hours.do(adaptation_job)
        logger.info("스케줄 등록: adaptation_job — 매 6시간")

    if report_job:
        schedule.every().day.at("09:00").do(report_job)
        logger.info("스케줄 등록: report_job — 매일 09:00")


def setup_schedule(job: Callable, interval_minutes: int = 60) -> None:
    """단순 주기 스케줄 (기존 호환용)"""
    schedule.clear()
    schedule.every(interval_minutes).minutes.do(job)
    logger.info(f"스케줄 등록: 매 {interval_minutes}분마다 실행")


def setup_fixed_times(job: Callable, times: list) -> None:
    """매일 특정 시각 실행 스케줄"""
    schedule.clear()
    for t in times:
        schedule.every().day.at(t).do(job)
        logger.info(f"스케줄 등록: 매일 {t}")

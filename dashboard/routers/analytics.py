# 성과 분석 API — 전략별/시간별/RSI존별/추세별 성과.
from fastapi import APIRouter

from dashboard.server import db_reader

router = APIRouter()


@router.get("/summary")
def get_summary():
    """전체 성과 요약 (승률, PF, 평균 수익 등)."""
    return db_reader.get_trade_summary()


@router.get("/by-strategy")
def get_by_strategy():
    """전략별 성과."""
    return db_reader.get_analytics_by_strategy()


@router.get("/by-hour")
def get_by_hour():
    """시간대별 승률 (0-23시)."""
    return db_reader.get_analytics_by_hour()


@router.get("/by-rsi-bucket")
def get_by_rsi_bucket():
    """RSI 진입 존별 성과 (5단위 버킷)."""
    return db_reader.get_analytics_by_rsi_bucket()


@router.get("/by-trend")
def get_by_trend():
    """추세별 성과 (UPTREND / DOWNTREND / SIDEWAYS)."""
    return db_reader.get_analytics_by_trend()


@router.get("/by-volatility")
def get_by_volatility():
    """변동성별 성과 (HIGH / MEDIUM / LOW)."""
    return db_reader.get_analytics_by_volatility()


@router.get("/exit-patterns")
def get_exit_patterns():
    """청산 사유별 분포."""
    return db_reader.get_exit_patterns()


@router.get("/pnl-distribution")
def get_pnl_distribution():
    """P&L 분포 히스토그램."""
    return db_reader.get_pnl_distribution()

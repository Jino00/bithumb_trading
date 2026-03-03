# 거래 이력 API — 완료 거래 조회, 에쿼티 커브.
from typing import Optional

from fastapi import APIRouter

from dashboard.server import db_reader

router = APIRouter()


@router.get("/completed")
def get_completed_trades(
    limit: int = 50,
    offset: int = 0,
    coin: Optional[str] = None,
    strategy: Optional[str] = None,
):
    """페이지네이션 + 필터 지원 완료 거래."""
    return db_reader.get_completed_trades(
        limit=limit, offset=offset, coin=coin, strategy=strategy,
    )


@router.get("/recent")
def get_recent_trades(limit: int = 20):
    """최근 N건 완료 거래 (빠른 조회)."""
    return db_reader.get_recent_trades(limit=limit)


@router.get("/equity-curve")
def get_equity_curve():
    """에쿼티 커브 데이터 (누적 수익률)."""
    return db_reader.get_equity_curve()


@router.get("/{trade_id}")
def get_trade_detail(trade_id: int):
    """단일 거래 상세 (indicators_json 포함)."""
    result = db_reader.get_trade_detail(trade_id)
    if result is None:
        return {"error": "Trade not found"}
    return result

# 시스템 API — 이벤트 로그, 시장 상태, 헬스체크.
from typing import Optional

from fastapi import APIRouter

from dashboard.schemas import HealthStatus
from dashboard.server import db_reader, state_reader

router = APIRouter()


@router.get("/events")
def get_events(
    limit: int = 50,
    event_type: Optional[str] = None,
    coin: Optional[str] = None,
):
    """시스템 이벤트 로그."""
    return db_reader.get_events(limit=limit, event_type=event_type, coin=coin)


@router.get("/regime")
def get_regime():
    """현재 시장 상태 (코인별)."""
    state = state_reader.read()
    return state.get("regime", {})


@router.get("/adaptive")
def get_adaptive():
    """적응형 학습 상태 (코인별)."""
    state = state_reader.read()
    return state.get("adaptive", {})


@router.get("/health", response_model=HealthStatus)
def get_health():
    """봇 프로세스 상태 + 마지막 상태 업데이트 시각."""
    state = state_reader.read()
    portfolio = state.get("portfolio", {})
    return HealthStatus(
        status="ok",
        bot_active=state.get("bot_active", False),
        last_state_update=state.get("timestamp"),
        mode=state.get("mode", "UNKNOWN"),
        active_coins=portfolio.get("total_slots", 0),
    )

# 포트폴리오 API — 봇 상태, 포지션, 설정 조회.
from fastapi import APIRouter

from dashboard.schemas import (
    CoinSlotStatus,
    ConfigSnapshot,
    PortfolioOverview,
)
from dashboard.server import state_reader

router = APIRouter()


@router.get("/overview", response_model=PortfolioOverview)
def get_overview():
    """KPI: 자산, MDD, 승률, 활성코인 수."""
    state = state_reader.read()
    portfolio = state.get("portfolio", {})
    slots_extra = state.get("slots_extra", {})
    slots = portfolio.get("slots", {})

    positions = []
    for coin, info in slots.items():
        extra = slots_extra.get(coin, {})
        positions.append(CoinSlotStatus(
            coin=coin,
            draining=info.get("draining", False),
            active=info.get("active", True),
            has_position=info.get("has_position", False),
            entry_id=extra.get("entry_id"),
            entry_price=extra.get("entry_price"),
            entry_time=extra.get("entry_time"),
            strategy=info.get("strategy", ""),
            live_win_rate=info.get("live_win_rate", 0.0),
            risk_dd=info.get("risk_dd", 0.0),
            activated_at=info.get("activated_at"),
        ))

    return PortfolioOverview(
        bot_active=state.get("bot_active", False),
        mode=state.get("mode", "UNKNOWN"),
        timestamp=state.get("timestamp"),
        active_coins=portfolio.get("active_coins", []),
        total_slots=portfolio.get("total_slots", 0),
        draining_count=portfolio.get("draining_count", 0),
        blacklist=portfolio.get("blacklist", []),
        portfolio_equity=portfolio.get("portfolio_equity", 1.0),
        portfolio_mdd_pct=portfolio.get("portfolio_mdd_pct", 0.0),
        total_trades=portfolio.get("total_trades", 0),
        positions=positions,
    )


@router.get("/positions", response_model=list[CoinSlotStatus])
def get_positions():
    """활성 포지션 목록 (실시간 P&L)."""
    state = state_reader.read()
    portfolio = state.get("portfolio", {})
    slots_extra = state.get("slots_extra", {})
    slots = portfolio.get("slots", {})

    result = []
    for coin, info in slots.items():
        extra = slots_extra.get(coin, {})
        result.append(CoinSlotStatus(
            coin=coin,
            draining=info.get("draining", False),
            active=info.get("active", True),
            has_position=info.get("has_position", False),
            entry_id=extra.get("entry_id"),
            entry_price=extra.get("entry_price"),
            entry_time=extra.get("entry_time"),
            strategy=info.get("strategy", ""),
            live_win_rate=info.get("live_win_rate", 0.0),
            risk_dd=info.get("risk_dd", 0.0),
            activated_at=info.get("activated_at"),
        ))
    return result


@router.get("/config", response_model=ConfigSnapshot)
def get_config():
    """봇 설정값 (읽기전용)."""
    state = state_reader.read()
    return ConfigSnapshot(values=state.get("config", {}))

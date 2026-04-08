# 포트폴리오 API — 봇 상태, 포지션, 설정 조회.
from fastapi import APIRouter

from dashboard.schemas import (
    CoinSlotStatus,
    ConfigSnapshot,
    PortfolioOverview,
)
from dashboard.server import state_reader

router = APIRouter()


def _build_position(coin: str, info: dict, extra: dict) -> CoinSlotStatus:
    """슬롯 정보 + 추가 정보를 합쳐 CoinSlotStatus를 생성한다."""
    return CoinSlotStatus(
        coin=coin,
        draining=info.get("draining", False),
        active=info.get("active", True),
        has_position=info.get("has_position", False),
        entry_id=extra.get("entry_id"),
        entry_price=extra.get("entry_price"),
        entry_time=extra.get("entry_time"),
        current_price=extra.get("current_price"),
        unrealized_pnl=extra.get("unrealized_pnl"),
        entry_reason=extra.get("entry_reason"),
        rsi_at_entry=extra.get("rsi_at_entry"),
        stop_loss_pct=extra.get("stop_loss_pct"),
        take_profit_pct=extra.get("take_profit_pct"),
        strategy=info.get("strategy", ""),
        live_win_rate=info.get("live_win_rate", 0.0),
        risk_dd=info.get("risk_dd", 0.0),
        activated_at=info.get("activated_at"),
    )


@router.get("/overview", response_model=PortfolioOverview)
def get_overview():
    """KPI: 자산, MDD, 승률, 활성코인 수."""
    state = state_reader.read()
    portfolio = state.get("portfolio", {})
    slots_extra = state.get("slots_extra", {})
    slots = portfolio.get("slots", {})

    positions = [
        _build_position(coin, info, slots_extra.get(coin, {}))
        for coin, info in slots.items()
    ]

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

    return [
        _build_position(coin, info, slots_extra.get(coin, {}))
        for coin, info in slots.items()
    ]


@router.get("/config", response_model=ConfigSnapshot)
def get_config():
    """봇 설정값 (읽기전용)."""
    state = state_reader.read()
    return ConfigSnapshot(values=state.get("config", {}))

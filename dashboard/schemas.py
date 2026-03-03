# Pydantic 응답 모델 — 대시보드 API 응답 스키마 정의.
from typing import Any, Optional

from pydantic import BaseModel


# ── 포트폴리오 ────────────────────────────────────────────────────

class CoinSlotStatus(BaseModel):
    coin: str
    draining: bool = False
    active: bool = True
    has_position: bool = False
    entry_id: Optional[int] = None
    entry_price: Optional[float] = None
    entry_time: Optional[str] = None
    strategy: str = ""
    live_win_rate: float = 0.0
    risk_dd: float = 0.0
    activated_at: Optional[str] = None


class PortfolioOverview(BaseModel):
    bot_active: bool = False
    mode: str = "UNKNOWN"
    timestamp: Optional[str] = None
    active_coins: list[str] = []
    total_slots: int = 0
    draining_count: int = 0
    blacklist: list[str] = []
    portfolio_equity: float = 1.0
    portfolio_mdd_pct: float = 0.0
    total_trades: int = 0
    positions: list[CoinSlotStatus] = []


class ConfigSnapshot(BaseModel):
    values: dict[str, Any] = {}


# ── 거래 ──────────────────────────────────────────────────────────

class CompletedTrade(BaseModel):
    entry_id: int
    entry_time: str
    strategy_name: str
    coin: str
    entry_price: float
    amount: Optional[float] = None
    total_krw: Optional[float] = None
    entry_reason: Optional[str] = None
    rsi_value: Optional[float] = None
    volume_ratio: Optional[float] = None
    trend: Optional[str] = None
    volatility: Optional[str] = None
    exit_time: Optional[str] = None
    exit_price: Optional[float] = None
    exit_reason: Optional[str] = None
    pnl_pct: Optional[float] = None
    hold_minutes: Optional[float] = None


class TradesPaginated(BaseModel):
    items: list[CompletedTrade] = []
    total: int = 0
    limit: int = 50
    offset: int = 0


class EquityCurvePoint(BaseModel):
    trade_number: int
    equity: float
    pnl_pct: float
    exit_time: str
    coin: str


# ── 분석 ──────────────────────────────────────────────────────────

class TradeSummary(BaseModel):
    total_trades: int = 0
    winning: Optional[int] = 0
    losing: Optional[int] = 0
    win_rate: float = 0.0
    avg_pnl: Optional[float] = 0.0
    avg_profit: Optional[float] = 0.0
    avg_loss: Optional[float] = 0.0
    profit_factor: float = 0.0
    gross_profit: Optional[float] = 0.0
    gross_loss: Optional[float] = 0.0
    best_trade: Optional[float] = 0.0
    worst_trade: Optional[float] = 0.0
    avg_hold_minutes: Optional[float] = 0.0


class AnalyticsBucket(BaseModel):
    label: Optional[str] = None
    hour: Optional[int] = None
    rsi_bucket: Optional[int] = None
    trend: Optional[str] = None
    volatility: Optional[str] = None
    strategy_name: Optional[str] = None
    total: int = 0
    wins: int = 0
    win_rate: float = 0.0
    avg_pnl: Optional[float] = 0.0
    profit_factor: Optional[float] = 0.0


class ExitPattern(BaseModel):
    exit_type: str
    total: int
    avg_pnl: Optional[float] = 0.0


class PnLBucket(BaseModel):
    bucket: int
    count: int


# ── 시스템 ────────────────────────────────────────────────────────

class SystemEvent(BaseModel):
    id: int
    timestamp: str
    event_type: str
    coin: Optional[str] = None
    detail: Optional[str] = None


class HealthStatus(BaseModel):
    status: str = "ok"
    bot_active: bool = False
    last_state_update: Optional[str] = None
    mode: str = "UNKNOWN"
    active_coins: int = 0


# ── WebSocket ─────────────────────────────────────────────────────

class LiveStateUpdate(BaseModel):
    timestamp: str
    bot_active: bool
    mode: str
    portfolio_equity: float
    portfolio_mdd_pct: float
    total_trades: int
    active_coins: list[str]
    positions: list[CoinSlotStatus]

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
    current_price: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    entry_reason: Optional[str] = None
    rsi_at_entry: Optional[float] = None
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
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


# ── 페이퍼 트레이딩 ────────────────────────────────────────────────

class PaperKPI(BaseModel):
    balance: float = 0
    total_value: float = 0
    initial_capital: float = 0
    total_return_pct: float = 0.0
    total_trades: int = 0
    win_rate: float = 0.0
    active_strategy_id: str = ""
    active_strategy_name: str = ""
    regime: str = "UNKNOWN"
    coin: str = "BTC"
    cycle_count: int = 0


class PaperEvalScore(BaseModel):
    strategy_id: str
    name: str
    score: float
    trades_count: int
    win_rate: float
    pf: float
    total_return: float
    is_active: bool = False


class PaperPositionInfo(BaseModel):
    coin: str
    entry_price: float
    quantity: float
    entry_time: str
    sl_pct: float
    tp_pct: float
    strategy: str
    invested_krw: float = 0


class PaperTriggerEvent(BaseModel):
    timestamp: str = ""
    trigger_type: str
    severity: str
    description: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None


class PaperTradeRecord(BaseModel):
    entry_time: str
    exit_time: str
    strategy: str
    entry_price: float
    exit_price: float
    quantity: float
    pnl_krw: float
    pnl_pct: float
    exit_reason: str
    invested_krw: float = 0
    coin: str = ""


class PaperEquityPoint(BaseModel):
    timestamp: str
    balance: float


class PaperCoinSlotInfo(BaseModel):
    """멀티코인 모드: 개별 코인 슬롯 정보."""
    coin: str
    allocated_krw: float = 0
    balance_krw: float = 0
    active_strategy_id: str = ""
    active_strategy_name: str = ""
    regime: str = "UNKNOWN"
    cycle_count: int = 0
    total_trades: int = 0
    win_rate: float = 0.0
    total_return_pct: float = 0.0
    position: Optional[PaperPositionInfo] = None
    draining: bool = False
    activated_at: Optional[str] = None


class PaperPortfolioKPI(BaseModel):
    """멀티코인 포트폴리오 수준 KPI."""
    total_value: float = 0
    initial_capital: float = 0
    unallocated_krw: float = 0
    total_return_pct: float = 0.0
    total_trades: int = 0
    win_rate: float = 0.0
    active_coins: list[str] = []
    max_positions: int = 5
    scan_count: int = 0
    blacklist: list[str] = []


class PaperOverview(BaseModel):
    updated_at: Optional[str] = None
    mode: str = "SINGLE"
    kpi: PaperKPI = PaperKPI()
    portfolio_kpi: Optional[PaperPortfolioKPI] = None
    position: Optional[PaperPositionInfo] = None
    positions: list[PaperCoinSlotInfo] = []
    eval_scores: list[PaperEvalScore] = []
    triggers: list[PaperTriggerEvent] = []
    trades: list[PaperTradeRecord] = []
    equity_curve: list[PaperEquityPoint] = []


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
    paper: Optional[PaperKPI] = None

// TypeScript 타입 정의 — 백엔드 Pydantic 스키마와 매칭.

export interface CoinSlotStatus {
  coin: string;
  draining: boolean;
  active: boolean;
  has_position: boolean;
  entry_id: number | null;
  entry_price: number | null;
  entry_time: string | null;
  strategy: string;
  live_win_rate: number;
  risk_dd: number;
  activated_at: string | null;
}

export interface PortfolioOverview {
  bot_active: boolean;
  mode: string;
  timestamp: string | null;
  active_coins: string[];
  total_slots: number;
  draining_count: number;
  blacklist: string[];
  portfolio_equity: number;
  portfolio_mdd_pct: number;
  total_trades: number;
  positions: CoinSlotStatus[];
}

export interface CompletedTrade {
  entry_id: number;
  entry_time: string;
  strategy_name: string;
  coin: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  exit_reason: string;
  pnl_pct: number;
  hold_minutes: number;
  entry_reason?: string;
  rsi_value?: number;
  volume_ratio?: number;
  trend?: string;
  volatility?: string;
}

export interface TradesPaginated {
  items: CompletedTrade[];
  total: number;
  limit: number;
  offset: number;
}

export interface EquityCurvePoint {
  trade_number: number;
  equity: number;
  pnl_pct: number;
  exit_time: string;
  coin: string;
}

export interface TradeSummary {
  total_trades: number;
  winning: number;
  losing: number;
  win_rate: number;
  avg_pnl: number;
  avg_profit: number;
  avg_loss: number;
  profit_factor: number;
  best_trade: number;
  worst_trade: number;
  avg_hold_minutes: number;
}

export interface AnalyticsBucket {
  strategy_name?: string;
  hour?: number;
  rsi_bucket?: number;
  trend?: string;
  volatility?: string;
  total: number;
  wins: number;
  win_rate: number;
  avg_pnl: number;
  profit_factor?: number;
}

export interface ExitPattern {
  exit_type: string;
  total: number;
  avg_pnl: number;
}

export interface PnLBucket {
  bucket: number;
  count: number;
}

export interface SystemEvent {
  id: number;
  timestamp: string;
  event_type: string;
  coin: string | null;
  detail: string | null;
}

export interface LiveStateUpdate {
  type: string;
  timestamp: string;
  bot_active: boolean;
  mode: string;
  portfolio_equity: number;
  portfolio_mdd_pct: number;
  total_trades: number;
  active_coins: string[];
  positions: CoinSlotStatus[];
}

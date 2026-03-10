// TypeScript 타입 정의 — 백엔드 Pydantic 스키마와 매칭.

export interface CoinSlotStatus {
  coin: string;
  draining: boolean;
  active: boolean;
  has_position: boolean;
  entry_id: number | null;
  entry_price: number | null;
  entry_time: string | null;
  current_price: number | null;
  unrealized_pnl: number | null;
  entry_reason: string | null;
  rsi_at_entry: number | null;
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
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

// ── 페이퍼 트레이딩 ────────────────────────────────────────

export interface PaperKPI {
  balance: number;
  total_value: number;
  initial_capital: number;
  total_return_pct: number;
  total_trades: number;
  win_rate: number;
  active_strategy_id: string;
  active_strategy_name: string;
  regime: string;
  coin: string;
  cycle_count: number;
}

export interface PaperEvalScore {
  strategy_id: string;
  name: string;
  score: number;
  trades_count: number;
  win_rate: number;
  pf: number;
  total_return: number;
  is_active: boolean;
}

export interface PaperPositionInfo {
  coin: string;
  entry_price: number;
  quantity: number;
  entry_time: string;
  sl_pct: number;
  tp_pct: number;
  strategy: string;
  invested_krw: number;
}

export interface PaperTriggerEvent {
  timestamp: string;
  trigger_type: string;
  severity: string;
  description: string;
  old_value: string | null;
  new_value: string | null;
}

export interface PaperTradeRecord {
  entry_time: string;
  exit_time: string;
  strategy: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl_krw: number;
  pnl_pct: number;
  exit_reason: string;
  invested_krw: number;
  coin?: string;
}

export interface PaperEquityPoint {
  timestamp: string;
  balance: number;
}

// ── 멀티코인 페이퍼 트레이딩 ─────────────────────────────

export interface PaperCoinSlotInfo {
  coin: string;
  allocated_krw: number;
  balance_krw: number;
  active_strategy_id: string;
  active_strategy_name: string;
  regime: string;
  cycle_count: number;
  total_trades: number;
  win_rate: number;
  total_return_pct: number;
  position: PaperPositionInfo | null;
  draining: boolean;
  activated_at: string | null;
}

export interface PaperPortfolioKPI {
  total_value: number;
  initial_capital: number;
  unallocated_krw: number;
  total_return_pct: number;
  total_trades: number;
  win_rate: number;
  active_coins: string[];
  max_positions: number;
  scan_count: number;
  blacklist: string[];
}

export interface PaperOverview {
  updated_at: string | null;
  mode: string;
  kpi: PaperKPI;
  portfolio_kpi: PaperPortfolioKPI | null;
  position: PaperPositionInfo | null;
  positions: PaperCoinSlotInfo[];
  eval_scores: PaperEvalScore[];
  triggers: PaperTriggerEvent[];
  trades: PaperTradeRecord[];
  equity_curve: PaperEquityPoint[];
}

// ── WebSocket ──────────────────────────────────────────────

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
  paper?: PaperKPI | null;
}

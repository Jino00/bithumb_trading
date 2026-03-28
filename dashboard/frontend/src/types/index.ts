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
  strategy_name: string;
  invested_krw: number;
  unrealized_pnl_pct: number;
  unrealized_krw: number;
  current_price: number;
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
  current_price: number;
  price_change_pct: number;
  active_strategy_id: string;
  active_strategy_name: string;
  regime: string;
  cycle_count: number;
  total_trades: number;
  win_rate: number;
  total_return_pct: number;
  unrealized_krw: number;
  position: PaperPositionInfo | null;
  draining: boolean;
  activated_at: string | null;
  allocation_weight: number;
  volatility_tier: string;
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

export interface InsightActionsInfo {
  blocked_combos: string[];
  blocked_hours: number[];
  strategy_scores: Record<string, number>;
  tier_scales: Record<string, number>;
  sl_widen: boolean;
  consecutive_losses: number;
  max_consecutive_losses: number;
  disabled_strategies: string[];
  active_filters: string[];
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
  insight_actions?: InsightActionsInfo;
}

// ── 3단계 파이프라인 스크리닝 ──────────────────────────────

export interface ScreeningSlotInfo {
  coin: string;
  strategy: string;
  interval: string;
  is_fixed: boolean;
  stay_hours: number;
  allocation_weight: number;
  total_return_pct: number;
  total_trades: number;
  win_rate: number;
  draining: boolean;
  has_position: boolean;
}

export interface BenchCoinInfo {
  symbol: string;
  interval: string;
  range_pct: number;
  volume_krw: number;
  latest_price: number;
  latest_volume_krw: number;
  wait_hours: number;
  is_eligible: boolean;
  monitoring_count: number;
}

export interface PipelineSummary {
  active_count: number;
  fixed_count: number;
  dynamic_count: number;
  bench_count: number;
  eligible_count: number;
  blacklist_count: number;
}

export interface ScreeningOverview {
  active_slots: ScreeningSlotInfo[];
  bench_coins: BenchCoinInfo[];
  blacklist: string[];
  scan_count: number;
  pipeline_summary: PipelineSummary;
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

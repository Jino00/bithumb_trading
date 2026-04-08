// Zustand 전역 상태 — WebSocket으로 수신한 실시간 봇 상태.
import { create } from 'zustand';
import type { CoinSlotStatus, LiveStateUpdate } from '../types';

interface BotStore {
  connected: boolean;
  botActive: boolean;
  mode: string;
  timestamp: string | null;
  portfolioEquity: number;
  portfolioMddPct: number;
  totalTrades: number;
  activeCoins: string[];
  positions: CoinSlotStatus[];
  setConnected: (v: boolean) => void;
  setLiveState: (state: LiveStateUpdate) => void;
}

export const useBotStore = create<BotStore>((set) => ({
  connected: false,
  botActive: false,
  mode: 'UNKNOWN',
  timestamp: null,
  portfolioEquity: 1.0,
  portfolioMddPct: 0.0,
  totalTrades: 0,
  activeCoins: [],
  positions: [],
  setConnected: (v) => set({ connected: v }),
  setLiveState: (s) =>
    set({
      botActive: s.bot_active,
      mode: s.mode,
      timestamp: s.timestamp,
      portfolioEquity: s.portfolio_equity,
      portfolioMddPct: s.portfolio_mdd_pct,
      totalTrades: s.total_trades,
      activeCoins: s.active_coins,
      positions: s.positions,
    }),
}));

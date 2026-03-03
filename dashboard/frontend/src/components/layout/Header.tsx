// 상단 헤더 — 봇 상태, P&L, 연결 표시.
import { Activity, Wifi, WifiOff } from 'lucide-react';
import { useBotStore } from '../../stores/botStore';

export default function Header() {
  const { connected, botActive, mode, portfolioEquity, portfolioMddPct, totalTrades } =
    useBotStore();

  const pnlPct = (portfolioEquity - 1) * 100;
  const pnlColor = pnlPct >= 0 ? 'text-profit' : 'text-loss';

  return (
    <header className="h-16 bg-bg-secondary border-b border-border flex items-center px-6 justify-between">
      {/* Left */}
      <div className="flex items-center gap-3">
        <Activity className="w-6 h-6 text-accent" />
        <span className="text-lg font-bold">Bithumb Bot</span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            botActive
              ? 'bg-profit/20 text-profit'
              : 'bg-loss/20 text-loss'
          }`}
        >
          {botActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
        <span className="text-xs text-text-secondary">{mode}</span>
      </div>

      {/* Center */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <div className="text-xs text-text-secondary">Total P&L</div>
          <div className={`text-lg font-bold ${pnlColor}`}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-secondary">MDD</div>
          <div className="text-lg font-bold text-loss">
            {portfolioMddPct.toFixed(1)}%
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-secondary">Trades</div>
          <div className="text-lg font-bold">{totalTrades}</div>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {connected ? (
          <Wifi className="w-4 h-4 text-profit" />
        ) : (
          <WifiOff className="w-4 h-4 text-loss" />
        )}
        <span className={`text-xs ${connected ? 'text-profit' : 'text-loss'}`}>
          {connected ? 'Live' : 'Disconnected'}
        </span>
      </div>
    </header>
  );
}

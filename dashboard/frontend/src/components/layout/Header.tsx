// 상단 헤더 — 봇 상태, P&L, 연결 표시 (Light theme).
import { Activity, Wifi, WifiOff, RefreshCw, Menu } from 'lucide-react';
import { useBotStore } from '../../stores/botStore';

interface HeaderProps {
  onMenuToggle?: () => void;
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const { connected, botActive, mode, portfolioEquity, portfolioMddPct, totalTrades } =
    useBotStore();

  const pnlPct = (portfolioEquity - 1) * 100;
  const pnlColor = pnlPct >= 0 ? 'text-profit' : 'text-loss';

  return (
    <header className="h-14 bg-bg-secondary border-b border-border flex items-center px-4 lg:px-6 justify-between shadow-sm">
      {/* Left */}
      <div className="flex items-center gap-2 lg:gap-3">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="p-2 rounded-lg hover:bg-bg-tertiary transition-colors text-text-secondary lg:hidden"
            aria-label="메뉴 열기"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <Activity className="w-5 h-5 text-accent hidden sm:block" />
        <span className="text-sm lg:text-base font-bold text-text-primary truncate">Bithumb Trading Bot</span>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
            botActive
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-600'
          }`}
        >
          {botActive ? 'ACTIVE' : 'INACTIVE'}
        </span>
        <span className="text-xs text-text-secondary bg-bg-tertiary px-2 py-0.5 rounded hidden sm:inline">{mode}</span>
      </div>

      {/* Center KPI pills — hidden on mobile */}
      <div className="hidden md:flex items-center gap-5">
        <div className="text-center">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider">P&L</div>
          <div className={`font-bold ${pnlColor} ${
            Math.abs(pnlPct) >= 50 ? 'text-lg' : Math.abs(pnlPct) >= 10 ? 'text-base' : 'text-sm'
          }`}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
          </div>
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="text-center">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider">MDD</div>
          <div className="text-sm font-bold text-loss">
            {portfolioMddPct.toFixed(1)}%
          </div>
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="text-center">
          <div className="text-[10px] text-text-secondary uppercase tracking-wider">Trades</div>
          <div className="text-sm font-bold">{totalTrades}</div>
        </div>
      </div>

      {/* Right — connection + refresh */}
      <div className="flex items-center gap-2">
        {connected ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-600">
            <Wifi className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Live</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-500">
            <WifiOff className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Disconnected</span>
          </div>
        )}
        <button
          className="p-2 rounded-lg hover:bg-bg-tertiary transition-colors text-text-secondary"
          aria-label="새로고침"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

// 4개 KPI 카드 그리드 — 메인 대시보드 상단.
import { TrendingUp, TrendingDown, Target, Coins } from 'lucide-react';
import { useBotStore } from '../../stores/botStore';
import { useTradeSummary } from '../../hooks/useApi';
import KPICard from './KPICard';

export default function KPIGrid() {
  const { portfolioEquity, portfolioMddPct, positions } = useBotStore();
  const { data: summary } = useTradeSummary();

  const pnlPct = (portfolioEquity - 1) * 100;
  const winRate = summary?.win_rate ?? 0;
  const activeCount = positions.filter((p) => !p.draining).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KPICard
        label="Portfolio P&L"
        value={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
        icon={pnlPct >= 0 ? TrendingUp : TrendingDown}
        color={pnlPct >= 0 ? 'profit' : 'loss'}
      />
      <KPICard
        label="Max Drawdown"
        value={`${portfolioMddPct.toFixed(1)}%`}
        icon={TrendingDown}
        color={portfolioMddPct > 15 ? 'loss' : 'default'}
      />
      <KPICard
        label="Win Rate"
        value={winRate > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
        icon={Target}
        color={winRate >= 70 ? 'profit' : winRate >= 50 ? 'default' : 'loss'}
      />
      <KPICard
        label="Active Positions"
        value={`${activeCount}`}
        icon={Coins}
        color="accent"
      />
    </div>
  );
}

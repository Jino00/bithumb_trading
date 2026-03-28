// 시장 상태 패널 (Light theme).
import { useBotStore } from '../../stores/botStore';

const regimeLabels: Record<string, { label: string; color: string; bg: string }> = {
  TRENDING_UP: { label: 'TRENDING UP', color: 'text-green-700', bg: 'bg-green-50' },
  TRENDING_DOWN: { label: 'TRENDING DOWN', color: 'text-red-600', bg: 'bg-red-50' },
  RANGE_BOUND: { label: 'RANGE BOUND', color: 'text-yellow-700', bg: 'bg-yellow-50' },
};

export default function MarketRegimePanel() {
  const { positions } = useBotStore();

  if (positions.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
        <h3 className="text-sm font-semibold mb-3">Market Regime</h3>
        <div className="text-text-secondary text-sm">No active coins</div>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold mb-3">Market Regime</h3>
      <div className="space-y-2">
        {positions.map((p) => {
          const strategyStr = p.strategy || '';
          const isRangeRegime = strategyStr.includes('Grid') || strategyStr.includes('횡보');
          const isTrendDown = strategyStr.includes('하락');
          const regimeKey = isTrendDown ? 'TRENDING_DOWN' : isRangeRegime ? 'RANGE_BOUND' : 'TRENDING_UP';
          const regime = regimeLabels[regimeKey] || regimeLabels.RANGE_BOUND;

          return (
            <div key={p.coin} className={`flex items-center justify-between ${regime.bg} rounded-lg px-4 py-2.5`}>
              <span className="font-medium text-text-primary">{p.coin}</span>
              <span className={`text-sm font-bold ${regime.color}`}>{regime.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

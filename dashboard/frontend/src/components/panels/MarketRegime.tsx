// 시장 상태 패널 — ADX + 추세/횡보 표시.
import { useBotStore } from '../../stores/botStore';

const regimeLabels: Record<string, { label: string; color: string }> = {
  TRENDING_UP: { label: 'TRENDING UP', color: 'text-profit' },
  TRENDING_DOWN: { label: 'TRENDING DOWN', color: 'text-loss' },
  RANGE_BOUND: { label: 'RANGE BOUND', color: 'text-yellow-400' },
};

export default function MarketRegimePanel() {
  const { positions } = useBotStore();

  if (positions.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3">Market Regime</h3>
        <div className="text-text-secondary text-sm">No active coins</div>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Market Regime</h3>
      <div className="space-y-3">
        {positions.map((p) => {
          const strategyStr = p.strategy || '';
          // RegimeAwareStrategy includes regime info in strategy string
          const isRangeRegime = strategyStr.includes('Grid') || strategyStr.includes('횡보');
          const isTrendDown = strategyStr.includes('하락');
          const regimeKey = isTrendDown ? 'TRENDING_DOWN' : isRangeRegime ? 'RANGE_BOUND' : 'TRENDING_UP';
          const regime = regimeLabels[regimeKey] || regimeLabels.RANGE_BOUND;

          return (
            <div key={p.coin} className="flex items-center justify-between bg-bg-tertiary/50 rounded-lg px-3 py-2">
              <span className="font-medium">{p.coin}</span>
              <span className={`text-sm font-bold ${regime.color}`}>{regime.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

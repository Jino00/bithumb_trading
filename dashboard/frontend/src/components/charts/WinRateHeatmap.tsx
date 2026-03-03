// 시간대별 승률 히트맵 (0-23시).
import { useAnalyticsByHour } from '../../hooks/useApi';

function getColor(winRate: number): string {
  if (winRate >= 70) return 'bg-profit/80';
  if (winRate >= 60) return 'bg-profit/50';
  if (winRate >= 50) return 'bg-profit/20';
  if (winRate >= 40) return 'bg-yellow-500/30';
  if (winRate > 0) return 'bg-loss/30';
  return 'bg-bg-tertiary';
}

export default function WinRateHeatmap() {
  const { data: hourly } = useAnalyticsByHour();

  const hourMap = new Map((hourly || []).map((h) => [h.hour, h]));

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Win Rate by Hour</h3>
      <div className="grid grid-cols-12 gap-1">
        {Array.from({ length: 24 }, (_, h) => {
          const data = hourMap.get(h);
          const wr = data?.win_rate ?? 0;
          const total = data?.total ?? 0;
          return (
            <div
              key={h}
              className={`rounded p-2 text-center ${getColor(wr)} transition-colors cursor-default`}
              title={`${h}시: ${wr.toFixed(0)}% (${total}건)`}
            >
              <div className="text-[10px] text-text-secondary">{h}</div>
              <div className="text-xs font-bold">{total > 0 ? `${wr.toFixed(0)}%` : '-'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

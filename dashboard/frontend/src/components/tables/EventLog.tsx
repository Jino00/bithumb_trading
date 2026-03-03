// 시스템 이벤트 로그 테이블.
import { useSystemEvents } from '../../hooks/useApi';

const typeColors: Record<string, string> = {
  ERROR: 'bg-loss/20 text-loss',
  MDD_EXCEEDED: 'bg-loss/20 text-loss',
  COIN_GATE_FAIL: 'bg-yellow-500/20 text-yellow-400',
  COIN_ACTIVATED: 'bg-profit/20 text-profit',
  COIN_DEACTIVATED: 'bg-text-secondary/20 text-text-secondary',
  COIN_DRAINING: 'bg-yellow-500/20 text-yellow-400',
  STRATEGY_DEACTIVATED: 'bg-loss/20 text-loss',
};

interface Props {
  limit?: number;
}

export default function EventLog({ limit = 10 }: Props) {
  const { data: events, isLoading } = useSystemEvents(limit);

  if (isLoading) {
    return <div className="text-text-secondary text-sm p-4">Loading events...</div>;
  }

  if (!events || events.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary">
        No events
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">System Events</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-xs border-b border-border">
              <th className="px-4 py-2 text-left">Time</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Coin</th>
              <th className="px-4 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-border/50 hover:bg-bg-tertiary/30">
                <td className="px-4 py-2 text-text-secondary text-xs whitespace-nowrap">
                  {new Date(e.timestamp).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColors[e.event_type] || 'bg-bg-tertiary text-text-secondary'}`}>
                    {e.event_type}
                  </span>
                </td>
                <td className="px-4 py-2 font-medium">{e.coin || '-'}</td>
                <td className="px-4 py-2 text-xs text-text-secondary max-w-[300px] truncate">
                  {e.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

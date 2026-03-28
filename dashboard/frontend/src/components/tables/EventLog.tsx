// 시스템 이벤트 로그 테이블 (Light theme).
import { useSystemEvents } from '../../hooks/useApi';

const typeColors: Record<string, string> = {
  ERROR: 'bg-red-50 text-red-600',
  MDD_EXCEEDED: 'bg-red-50 text-red-600',
  COIN_GATE_FAIL: 'bg-yellow-50 text-yellow-700',
  COIN_ACTIVATED: 'bg-green-50 text-green-600',
  COIN_DEACTIVATED: 'bg-gray-100 text-text-secondary',
  COIN_DRAINING: 'bg-yellow-50 text-yellow-700',
  STRATEGY_DEACTIVATED: 'bg-red-50 text-red-600',
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
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary shadow-sm">
        No events
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">System Events</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-xs border-b border-border bg-bg-tertiary">
              <th className="px-4 py-2.5 text-left font-medium">Time</th>
              <th className="px-4 py-2.5 text-left font-medium">Type</th>
              <th className="px-4 py-2.5 text-left font-medium">Coin</th>
              <th className="px-4 py-2.5 text-left font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-border/50 hover:bg-bg-tertiary/50 transition-colors">
                <td className="px-4 py-2.5 text-text-secondary text-xs whitespace-nowrap">
                  {new Date(e.timestamp).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[e.event_type] || 'bg-gray-100 text-text-secondary'}`}>
                    {e.event_type}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-medium">{e.coin || '-'}</td>
                <td className="px-4 py-2.5 text-xs text-text-secondary max-w-[300px] truncate">
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

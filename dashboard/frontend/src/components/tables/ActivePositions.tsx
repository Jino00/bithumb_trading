// 활성 포지션 테이블 — 실시간 WebSocket 데이터.
import { useBotStore } from '../../stores/botStore';

export default function ActivePositions() {
  const { positions } = useBotStore();

  if (positions.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary">
        No active positions
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Active Positions</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-xs border-b border-border">
              <th className="px-4 py-2 text-left">Coin</th>
              <th className="px-4 py-2 text-left">Strategy</th>
              <th className="px-4 py-2 text-right">Entry Price</th>
              <th className="px-4 py-2 text-right">Win Rate</th>
              <th className="px-4 py-2 text-right">Risk DD</th>
              <th className="px-4 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.coin} className="border-b border-border/50 hover:bg-bg-tertiary/30">
                <td className="px-4 py-3 font-medium">{p.coin}</td>
                <td className="px-4 py-3 text-text-secondary text-xs">{p.strategy}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {p.entry_price ? `₩${p.entry_price.toLocaleString()}` : '-'}
                </td>
                <td className={`px-4 py-3 text-right ${p.live_win_rate >= 70 ? 'text-profit' : p.live_win_rate >= 50 ? 'text-text-primary' : 'text-loss'}`}>
                  {p.live_win_rate.toFixed(1)}%
                </td>
                <td className={`px-4 py-3 text-right ${p.risk_dd > 10 ? 'text-loss' : 'text-text-secondary'}`}>
                  {p.risk_dd.toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-center">
                  {p.draining ? (
                    <span className="px-2 py-0.5 rounded bg-loss/20 text-loss text-xs">DRAIN</span>
                  ) : p.has_position ? (
                    <span className="px-2 py-0.5 rounded bg-accent/20 text-accent text-xs">IN POS</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-bg-tertiary text-text-secondary text-xs">IDLE</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

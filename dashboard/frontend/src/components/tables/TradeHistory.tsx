// 거래 이력 테이블 — 완료된 거래 목록.
import { useRecentTrades } from '../../hooks/useApi';

interface Props {
  limit?: number;
}

export default function TradeHistory({ limit = 20 }: Props) {
  const { data: trades, isLoading } = useRecentTrades(limit);

  if (isLoading) {
    return <div className="text-text-secondary text-sm p-4">Loading trades...</div>;
  }

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary">
        No completed trades yet
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Recent Trades</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-xs border-b border-border">
              <th className="px-4 py-2 text-left">#</th>
              <th className="px-4 py-2 text-left">Time</th>
              <th className="px-4 py-2 text-left">Coin</th>
              <th className="px-4 py-2 text-right">Entry</th>
              <th className="px-4 py-2 text-right">Exit</th>
              <th className="px-4 py-2 text-right">P&L</th>
              <th className="px-4 py-2 text-right">Hold</th>
              <th className="px-4 py-2 text-left">Exit Reason</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.entry_id} className="border-b border-border/50 hover:bg-bg-tertiary/30">
                <td className="px-4 py-2 text-text-secondary">{t.entry_id}</td>
                <td className="px-4 py-2 text-text-secondary text-xs">
                  {new Date(t.entry_time).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2 font-medium">{t.coin}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {t.entry_price?.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {t.exit_price?.toLocaleString()}
                </td>
                <td className={`px-4 py-2 text-right font-bold ${t.pnl_pct >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct?.toFixed(2)}%
                </td>
                <td className="px-4 py-2 text-right text-text-secondary">
                  {t.hold_minutes ? `${Math.round(t.hold_minutes)}m` : '-'}
                </td>
                <td className="px-4 py-2 text-xs text-text-secondary max-w-[200px] truncate">
                  {t.exit_reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

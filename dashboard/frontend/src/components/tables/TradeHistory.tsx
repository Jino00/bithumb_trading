// 거래 이력 테이블 — 완료된 거래 목록 (Light theme).
import { History } from 'lucide-react';
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
      <div className="bg-bg-secondary border border-border rounded-xl p-10 text-center shadow-sm">
        <History className="w-10 h-10 text-text-secondary/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-text-primary mb-1">아직 완료된 거래가 없습니다</p>
        <p className="text-xs text-text-secondary">페이퍼 트레이딩을 시작하면 거래 이력이 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Recent Trades</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-xs border-b border-border bg-bg-tertiary">
              <th className="px-4 py-2.5 text-left font-medium">#</th>
              <th className="px-4 py-2.5 text-left font-medium">Time</th>
              <th className="px-4 py-2.5 text-left font-medium">Coin</th>
              <th className="px-4 py-2.5 text-right font-medium">Entry</th>
              <th className="px-4 py-2.5 text-right font-medium">Exit</th>
              <th className="px-4 py-2.5 text-right font-medium">P&L</th>
              <th className="px-4 py-2.5 text-right font-medium">Hold</th>
              <th className="px-4 py-2.5 text-left font-medium">Exit Reason</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.entry_id} className="border-b border-border/50 hover:bg-bg-tertiary/50 transition-colors">
                <td className="px-4 py-2.5 text-text-secondary">{t.entry_id}</td>
                <td className="px-4 py-2.5 text-text-secondary text-xs">
                  {new Date(t.entry_time).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5 font-medium">{t.coin}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {t.entry_price?.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {t.exit_price?.toLocaleString()}
                </td>
                <td className={`px-4 py-2.5 text-right font-bold ${t.pnl_pct >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct?.toFixed(2)}%
                </td>
                <td className="px-4 py-2.5 text-right text-text-secondary">
                  {t.hold_minutes ? `${Math.round(t.hold_minutes)}m` : '-'}
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary max-w-[200px] truncate">
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

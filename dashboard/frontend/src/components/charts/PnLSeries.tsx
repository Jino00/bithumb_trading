// 거래별 P&L 바차트 (Light theme).
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { useRecentTrades } from '../../hooks/useApi';

export default function PnLSeries() {
  const { data: trades } = useRecentTrades(30);

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-48 flex items-center justify-center shadow-sm">
        No trade data
      </div>
    );
  }

  const chartData = [...trades].reverse().map((t) => ({
    id: t.entry_id,
    pnl: t.pnl_pct,
    coin: t.coin,
  }));

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold mb-3">Recent P&L</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData}>
          <XAxis dataKey="id" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} />
          <Tooltip
            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
            labelStyle={{ color: '#64748b' }}
            formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(2)}%`, 'P&L']}
            labelFormatter={(v) => `Trade #${v}`}
          />
          <ReferenceLine y={0} stroke="#e2e8f0" />
          <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.pnl >= 0 ? '#16a34a' : '#dc2626'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

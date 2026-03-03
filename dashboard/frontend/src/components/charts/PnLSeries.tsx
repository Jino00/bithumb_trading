// 거래별 P&L 바차트.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { useRecentTrades } from '../../hooks/useApi';

export default function PnLSeries() {
  const { data: trades } = useRecentTrades(30);

  if (!trades || trades.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-48 flex items-center justify-center">
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
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Recent P&L</h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData}>
          <XAxis dataKey="id" tick={{ fill: '#8899a6', fontSize: 10 }} axisLine={{ stroke: '#2d3748' }} />
          <YAxis tick={{ fill: '#8899a6', fontSize: 11 }} axisLine={{ stroke: '#2d3748' }} />
          <Tooltip
            contentStyle={{ background: '#1a2332', border: '1px solid #2d3748', borderRadius: 8 }}
            formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(2)}%`, 'P&L']}
            labelFormatter={(v) => `Trade #${v}`}
          />
          <ReferenceLine y={0} stroke="#2d3748" />
          <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.pnl >= 0 ? '#00c087' : '#ff4757'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

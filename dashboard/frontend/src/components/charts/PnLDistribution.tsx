// P&L 분포 히스토그램.
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { usePnlDistribution } from '../../hooks/useApi';

export default function PnLDistribution() {
  const { data: buckets } = usePnlDistribution();

  if (!buckets || buckets.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-48 flex items-center justify-center">
        No distribution data
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">P&L Distribution</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={buckets}>
          <XAxis
            dataKey="bucket"
            tick={{ fill: '#8899a6', fontSize: 10 }}
            axisLine={{ stroke: '#2d3748' }}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis tick={{ fill: '#8899a6', fontSize: 11 }} axisLine={{ stroke: '#2d3748' }} />
          <Tooltip
            contentStyle={{ background: '#1a2332', border: '1px solid #2d3748', borderRadius: 8 }}
            formatter={(value: number | undefined) => [value ?? 0, 'Count']}
            labelFormatter={(v) => `${v}%`}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {buckets.map((entry, i) => (
              <Cell key={i} fill={entry.bucket >= 0 ? '#00c087' : '#ff4757'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

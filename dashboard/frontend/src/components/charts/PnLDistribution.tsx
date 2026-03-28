// P&L 분포 히스토그램 (Light theme).
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { usePnlDistribution } from '../../hooks/useApi';

export default function PnLDistribution() {
  const { data: buckets } = usePnlDistribution();

  if (!buckets || buckets.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-48 flex items-center justify-center shadow-sm">
        No distribution data
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold mb-3">P&L Distribution</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={buckets}>
          <XAxis
            dataKey="bucket"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickFormatter={(v) => `${v}%`}
          />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#e2e8f0' }} />
          <Tooltip
            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
            formatter={(value: number | undefined) => [value ?? 0, 'Count']}
            labelFormatter={(v) => `${v}%`}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {buckets.map((entry, i) => (
              <Cell key={i} fill={entry.bucket >= 0 ? '#16a34a' : '#dc2626'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

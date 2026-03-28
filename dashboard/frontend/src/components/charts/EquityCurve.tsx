// 에쿼티 커브 — Recharts 영역 차트 (Light theme).
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useEquityCurve } from '../../hooks/useApi';

export default function EquityCurve() {
  const { data: curve, isLoading } = useEquityCurve();

  if (isLoading || !curve || curve.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-64 flex items-center justify-center shadow-sm">
        {isLoading ? 'Loading...' : 'No equity data'}
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold mb-3">Equity Curve</h3>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={curve}>
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="trade_number"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: '#e2e8f0' }}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
            labelStyle={{ color: '#64748b' }}
            formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(4)}`, 'Equity']}
            labelFormatter={(v) => `Trade #${v}`}
          />
          <ReferenceLine y={1} stroke="#e2e8f0" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#4f46e5"
            fill="url(#equityGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

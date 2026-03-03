// 에쿼티 커브 — Recharts 영역 차트.
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useEquityCurve } from '../../hooks/useApi';

export default function EquityCurve() {
  const { data: curve, isLoading } = useEquityCurve();

  if (isLoading || !curve || curve.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-64 flex items-center justify-center">
        {isLoading ? 'Loading...' : 'No equity data'}
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">Equity Curve</h3>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={curve}>
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00c087" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#00c087" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="trade_number"
            tick={{ fill: '#8899a6', fontSize: 11 }}
            axisLine={{ stroke: '#2d3748' }}
          />
          <YAxis
            tick={{ fill: '#8899a6', fontSize: 11 }}
            axisLine={{ stroke: '#2d3748' }}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={{ background: '#1a2332', border: '1px solid #2d3748', borderRadius: 8 }}
            labelStyle={{ color: '#8899a6' }}
            formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(4)}`, 'Equity']}
            labelFormatter={(v) => `Trade #${v}`}
          />
          <ReferenceLine y={1} stroke="#2d3748" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="equity"
            stroke="#00c087"
            fill="url(#equityGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

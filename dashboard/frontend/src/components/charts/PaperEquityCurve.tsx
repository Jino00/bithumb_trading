// 페이퍼 트레이딩 자본 곡선 — Recharts AreaChart (Light theme).
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { PaperEquityPoint } from '../../types';

interface Props {
  data: PaperEquityPoint[];
  initialCapital: number;
}

export default function PaperEquityCurve({ data, initialCapital }: Props) {
  if (data.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-64 flex items-center justify-center shadow-sm">
        자본 곡선 데이터 없음
      </div>
    );
  }

  const chartData = [
    { timestamp: '시작', balance: initialCapital },
    ...data,
  ];

  const lastBalance = data[data.length - 1].balance;
  const isProfit = lastBalance >= initialCapital;
  const lineColor = isProfit ? '#16a34a' : '#dc2626';

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold mb-3">자본 곡선</h3>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="paperEquityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.15} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="timestamp"
            tick={{ fill: '#94a3b8', fontSize: 10 }}
            axisLine={{ stroke: '#e2e8f0' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            axisLine={{ stroke: '#e2e8f0' }}
            domain={['auto', 'auto']}
            tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
          />
          <Tooltip
            contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
            labelStyle={{ color: '#64748b' }}
            formatter={(value: number | undefined) => [
              `${(value ?? 0).toLocaleString()}원`,
              '잔고',
            ]}
          />
          <ReferenceLine
            y={initialCapital}
            stroke="#e2e8f0"
            strokeDasharray="3 3"
            label={{ value: '시작', fill: '#94a3b8', fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke={lineColor}
            fill="url(#paperEquityGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

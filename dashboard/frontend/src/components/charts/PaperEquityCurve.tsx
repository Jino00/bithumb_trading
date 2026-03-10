// 페이퍼 트레이딩 자본 곡선 — Recharts AreaChart.
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
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary h-64 flex items-center justify-center">
        자본 곡선 데이터 없음
      </div>
    );
  }

  // 시작점 추가
  const chartData = [
    { timestamp: '시작', balance: initialCapital },
    ...data,
  ];

  const lastBalance = data[data.length - 1].balance;
  const isProfit = lastBalance >= initialCapital;

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">자본 곡선</h3>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="paperEquityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={isProfit ? '#00c087' : '#e74c3c'}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={isProfit ? '#00c087' : '#e74c3c'}
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="timestamp"
            tick={{ fill: '#8899a6', fontSize: 10 }}
            axisLine={{ stroke: '#2d3748' }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: '#8899a6', fontSize: 11 }}
            axisLine={{ stroke: '#2d3748' }}
            domain={['auto', 'auto']}
            tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
          />
          <Tooltip
            contentStyle={{
              background: '#1a2332',
              border: '1px solid #2d3748',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#8899a6' }}
            formatter={(value: number | undefined) => [
              `${(value ?? 0).toLocaleString()}원`,
              '잔고',
            ]}
          />
          <ReferenceLine
            y={initialCapital}
            stroke="#2d3748"
            strokeDasharray="3 3"
            label={{
              value: '시작',
              fill: '#8899a6',
              fontSize: 10,
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke={isProfit ? '#00c087' : '#e74c3c'}
            fill="url(#paperEquityGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

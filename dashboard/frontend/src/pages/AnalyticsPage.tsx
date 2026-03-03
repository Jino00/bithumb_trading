// 성과 분석 페이지 — 요약 + 차트 + 히트맵.
import { useTradeSummary, useAnalyticsByStrategy, useAnalyticsByTrend, useExitPatterns } from '../hooks/useApi';
import WinRateHeatmap from '../components/charts/WinRateHeatmap';
import PnLDistribution from '../components/charts/PnLDistribution';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const PIE_COLORS = ['#ff4757', '#00c087', '#00d2ff', '#8899a6'];

export default function AnalyticsPage() {
  const { data: summary } = useTradeSummary();
  const { data: strategies } = useAnalyticsByStrategy();
  const { data: trends } = useAnalyticsByTrend();
  const { data: exitPatterns } = useExitPatterns();

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Performance Analytics</h2>

      {/* Summary Stats */}
      {summary && summary.total_trades > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Total Trades" value={String(summary.total_trades)} />
          <StatCard label="Win Rate" value={`${summary.win_rate.toFixed(1)}%`} />
          <StatCard label="Profit Factor" value={summary.profit_factor.toFixed(2)} />
          <StatCard label="Avg P&L" value={`${(summary.avg_pnl ?? 0).toFixed(2)}%`} />
          <StatCard label="Best Trade" value={`+${(summary.best_trade ?? 0).toFixed(2)}%`} />
          <StatCard label="Worst Trade" value={`${(summary.worst_trade ?? 0).toFixed(2)}%`} />
        </div>
      )}

      {/* Heatmap + Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WinRateHeatmap />
        <PnLDistribution />
      </div>

      {/* Exit Patterns + Strategy Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Exit Patterns Pie */}
        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Exit Patterns</h3>
          {exitPatterns && exitPatterns.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={exitPatterns}
                  dataKey="total"
                  nameKey="exit_type"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label={({ name, value }) => `${name} (${value})`}
                  labelLine={false}
                >
                  {exitPatterns.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid #2d3748', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-text-secondary text-sm">No data</div>
          )}
        </div>

        {/* Strategy Performance Table */}
        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">By Strategy</h3>
          {strategies && strategies.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary text-xs">
                  <th className="text-left py-1">Strategy</th>
                  <th className="text-right py-1">Trades</th>
                  <th className="text-right py-1">Win Rate</th>
                  <th className="text-right py-1">PF</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((s) => (
                  <tr key={s.strategy_name} className="border-t border-border/30">
                    <td className="py-2">{s.strategy_name}</td>
                    <td className="py-2 text-right">{s.total}</td>
                    <td className={`py-2 text-right ${(s.win_rate ?? 0) >= 60 ? 'text-profit' : 'text-loss'}`}>
                      {s.win_rate?.toFixed(1)}%
                    </td>
                    <td className="py-2 text-right">{s.profit_factor?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-text-secondary text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Trend Performance */}
      {trends && trends.length > 0 && (
        <div className="bg-bg-secondary border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">By Trend</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {trends.map((t) => (
              <div key={t.trend} className="bg-bg-tertiary/50 rounded-lg p-3 text-center">
                <div className="text-xs text-text-secondary">{t.trend}</div>
                <div className="text-lg font-bold">{t.win_rate?.toFixed(1)}%</div>
                <div className="text-xs text-text-secondary">{t.total} trades</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-secondary border border-border rounded-lg p-3 text-center">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

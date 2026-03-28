// 성과 분석 페이지 (Light theme).
import { useTradeSummary, useAnalyticsByStrategy, useAnalyticsByTrend, useExitPatterns } from '../hooks/useApi';
import WinRateHeatmap from '../components/charts/WinRateHeatmap';
import PnLDistribution from '../components/charts/PnLDistribution';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const PIE_COLORS = ['#dc2626', '#16a34a', '#4f46e5', '#94a3b8'];

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
          <StatCard label="Win Rate" value={`${summary.win_rate.toFixed(1)}%`} positive={summary.win_rate >= 50} />
          <StatCard label="Profit Factor" value={summary.profit_factor.toFixed(2)} positive={summary.profit_factor >= 1.5} />
          <StatCard label="Avg P&L" value={`${(summary.avg_pnl ?? 0).toFixed(2)}%`} positive={(summary.avg_pnl ?? 0) >= 0} />
          <StatCard label="Best Trade" value={`+${(summary.best_trade ?? 0).toFixed(2)}%`} positive />
          <StatCard label="Worst Trade" value={`${(summary.worst_trade ?? 0).toFixed(2)}%`} positive={false} />
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
        <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
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
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-text-secondary text-sm">No data</div>
          )}
        </div>

        {/* Strategy Performance Table */}
        <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3">By Strategy</h3>
          {strategies && strategies.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary text-xs bg-bg-tertiary">
                  <th className="text-left py-2 px-2 font-medium">Strategy</th>
                  <th className="text-right py-2 px-2 font-medium">Trades</th>
                  <th className="text-right py-2 px-2 font-medium">Win Rate</th>
                  <th className="text-right py-2 px-2 font-medium">PF</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((s) => (
                  <tr key={s.strategy_name} className="border-t border-border/50">
                    <td className="py-2.5 px-2 font-medium">{s.strategy_name}</td>
                    <td className="py-2.5 px-2 text-right">{s.total}</td>
                    <td className={`py-2.5 px-2 text-right font-medium ${(s.win_rate ?? 0) >= 60 ? 'text-profit' : 'text-loss'}`}>
                      {s.win_rate?.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-2 text-right">{s.profit_factor?.toFixed(2)}</td>
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
        <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3">By Trend</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {trends.map((t) => (
              <div key={t.trend} className="bg-bg-tertiary rounded-lg p-3 text-center">
                <div className="text-xs text-text-secondary font-medium">{t.trend}</div>
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

function StatCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const borderColor = positive === true ? 'border-green-200' : positive === false ? 'border-red-200' : 'border-border';
  return (
    <div className={`bg-bg-secondary border ${borderColor} rounded-xl p-3 text-center shadow-sm`}>
      <div className="text-xs text-text-secondary font-medium">{label}</div>
      <div className={`text-lg font-bold ${positive === true ? 'text-profit' : positive === false ? 'text-loss' : ''}`}>{value}</div>
    </div>
  );
}

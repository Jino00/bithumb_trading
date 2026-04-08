// 바이낸스 Paper Trading 대시보드.
import { useQuery } from '@tanstack/react-query';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function SideBadge({ side }: { side: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
      side === 'LONG' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}>
      {side}
    </span>
  );
}

export default function BinancePaperPage() {
  const { data: overview, isLoading: _loadingOv } = useQuery<any>({
    queryKey: ['binance', 'overview'],
    queryFn: () => fetchJson('/api/binance/overview'),
    refetchInterval: 5000,
  });

  const { data: journal, isLoading: _loadingJ } = useQuery<any>({
    queryKey: ['binance', 'journal'],
    queryFn: () => fetchJson('/api/binance/journal'),
    refetchInterval: 5000,
  });

  const kpi = overview?.kpi || {};
  const position = overview?.position;
  const entries = journal?.entries || [];

  const totalPnl = entries.reduce((s: number, e: any) => s + (e.pnl_usdt || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
          Binance Paper Trading
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">TESTNET</span>
        </h2>
        <span className="text-xs text-gray-400">auto-refresh 5s</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-lg p-3 shadow-sm border">
          <p className="text-xs text-gray-500">Balance</p>
          <p className="text-lg font-bold">${kpi.balance_usdt?.toLocaleString(undefined, {maximumFractionDigits: 0}) || '0'}</p>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm border">
          <p className="text-xs text-gray-500">Return</p>
          <p className={`text-lg font-bold ${(kpi.total_return_pct || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {kpi.total_return_pct >= 0 ? '+' : ''}{kpi.total_return_pct?.toFixed(2) || '0.00'}%
          </p>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm border">
          <p className="text-xs text-gray-500">Trades</p>
          <p className="text-lg font-bold">{kpi.total_trades || 0}</p>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm border">
          <p className="text-xs text-gray-500">Win Rate</p>
          <p className={`text-lg font-bold ${(kpi.win_rate || 0) >= 50 ? 'text-green-600' : 'text-red-600'}`}>
            {kpi.win_rate?.toFixed(1) || '0.0'}%
          </p>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm border">
          <p className="text-xs text-gray-500">Leverage</p>
          <p className="text-lg font-bold">{kpi.leverage || 1}x</p>
        </div>
        <div className="bg-white rounded-lg p-3 shadow-sm border">
          <p className="text-xs text-gray-500">Net PnL</p>
          <p className={`text-lg font-bold ${totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            ${totalPnl.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Current Position */}
      {position && (
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <h3 className="text-sm font-bold mb-2">Active Position</h3>
          <div className="flex items-center gap-4">
            <span className="font-bold text-lg">{position.symbol}</span>
            <SideBadge side={position.side} />
            <span className="text-sm text-gray-500">Entry: ${position.entry_price?.toLocaleString()}</span>
            <span className="text-sm text-gray-500">Leverage: {position.leverage}x</span>
            <span className="text-sm text-gray-500">SL: {position.sl_pct}% | TP: {position.tp_pct}%</span>
          </div>
        </div>
      )}

      {/* Trade Journal */}
      <div className="bg-white rounded-lg shadow-sm border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Coin</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Side</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Entry</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Exit</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">PnL</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Reason</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Diagnosis</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {entries.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                No trades yet. Binance paper trading is running...
              </td></tr>
            )}
            {[...entries].reverse().map((e: any, i: number) => (
              <tr key={i} className={`hover:bg-gray-50 ${e.win ? '' : 'bg-red-50/30'}`}>
                <td className="px-3 py-2 text-xs text-gray-400">{e.journal_id}</td>
                <td className="px-3 py-2 font-medium">{e.coin}</td>
                <td className="px-3 py-2"><SideBadge side={e.side} /></td>
                <td className="px-3 py-2 text-xs text-gray-500">{e.entry_time}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{e.exit_time}</td>
                <td className={`px-3 py-2 text-right font-mono text-xs ${(e.pnl_pct || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {e.pnl_pct >= 0 ? '+' : ''}{e.pnl_pct?.toFixed(2)}%
                  <br />
                  <span className="text-gray-400">${e.pnl_usdt?.toFixed(2)}</span>
                </td>
                <td className="px-3 py-2 text-xs">{e.exit_reason}</td>
                <td className="px-3 py-2 text-xs text-gray-600 max-w-48 truncate">{e.diagnosis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

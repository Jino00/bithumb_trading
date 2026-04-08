// 활성 포지션 테이블 — 실시간 WebSocket 데이터 (Light theme).
import { useState, useEffect } from 'react';
import { useBotStore } from '../../stores/botStore';
import type { CoinSlotStatus } from '../../types';

function HoldTimer({ entryTime }: { entryTime: string | null }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!entryTime) {
      setElapsed('-');
      return;
    }

    function update() {
      const start = new Date(entryTime!).getTime();
      const diff = Date.now() - start;
      if (diff < 0) { setElapsed('-'); return; }

      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) setElapsed(`${days}d ${hours % 24}h`);
      else if (hours > 0) setElapsed(`${hours}h ${mins % 60}m`);
      else setElapsed(`${mins}m`);
    }

    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, [entryTime]);

  return <span className="font-mono text-xs">{elapsed}</span>;
}

function PnLBar({ pnl, sl, tp }: { pnl: number | null; sl: number | null; tp: number | null }) {
  if (pnl === null || sl === null || tp === null) return null;

  const range = sl + tp;
  const pctFromSl = ((pnl + sl) / range) * 100;
  const clampedPct = Math.max(0, Math.min(100, pctFromSl));

  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
          style={{
            width: `${clampedPct}%`,
            background: pnl >= 0
              ? `linear-gradient(90deg, #e2e8f0, #16a34a)`
              : `linear-gradient(90deg, #dc2626, #e2e8f0)`,
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-text-secondary mt-0.5">
        <span className="text-loss">SL -{sl}%</span>
        <span className="text-profit">TP +{tp}%</span>
      </div>
    </div>
  );
}

function PositionCard({ p }: { p: CoinSlotStatus }) {
  if (!p.has_position) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{p.coin}</span>
            <span className="text-xs text-text-secondary">{p.strategy}</span>
          </div>
          {p.draining ? (
            <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-medium">DRAIN</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-text-secondary text-xs">IDLE</span>
          )}
        </div>
        <div className="text-xs text-text-secondary">
          Win Rate: <span className={p.live_win_rate >= 70 ? 'text-profit font-medium' : p.live_win_rate >= 50 ? 'text-text-primary font-medium' : 'text-loss font-medium'}>{p.live_win_rate.toFixed(1)}%</span>
          <span className="mx-2">|</span>
          DD: <span className={p.risk_dd > 10 ? 'text-loss font-medium' : 'font-medium'}>{p.risk_dd.toFixed(1)}%</span>
        </div>
      </div>
    );
  }

  const pnlColor = (p.unrealized_pnl ?? 0) >= 0 ? 'text-profit' : 'text-loss';
  const borderColor = (p.unrealized_pnl ?? 0) >= 0 ? 'border-green-200' : 'border-red-200';
  const pnlBg = (p.unrealized_pnl ?? 0) >= 0 ? 'bg-green-50' : 'bg-red-50';

  return (
    <div className={`bg-bg-secondary border ${borderColor} rounded-xl p-4 shadow-sm`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-profit animate-pulse" />
          <span className="font-semibold text-base">{p.coin}</span>
          <span className="text-xs text-text-secondary">{p.strategy}</span>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-accent text-xs font-semibold">TRADING</span>
      </div>

      {/* P&L Hero */}
      <div className={`${pnlBg} rounded-lg px-3 py-2 mb-3`}>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-xs text-text-secondary block mb-0.5">Unrealized P&L</span>
            <span className={`text-2xl font-bold font-mono ${pnlColor}`}>
              {p.unrealized_pnl !== null ? `${p.unrealized_pnl >= 0 ? '+' : ''}${p.unrealized_pnl.toFixed(2)}%` : '-'}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-text-secondary block mb-0.5">Hold Time</span>
            <HoldTimer entryTime={p.entry_time} />
          </div>
        </div>
      </div>

      {/* Price Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <span className="text-[11px] text-text-secondary block">Entry</span>
          <span className="font-mono text-sm">
            {p.entry_price ? `₩${p.entry_price.toLocaleString()}` : '-'}
          </span>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-text-secondary block">Current</span>
          <span className={`font-mono text-sm ${pnlColor}`}>
            {p.current_price ? `₩${p.current_price.toLocaleString()}` : '-'}
          </span>
        </div>
      </div>

      {/* SL/TP Progress Bar */}
      <PnLBar pnl={p.unrealized_pnl} sl={p.stop_loss_pct} tp={p.take_profit_pct} />

      {/* Details Row */}
      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border">
        <div>
          <span className="text-[10px] text-text-secondary block">RSI Entry</span>
          <span className="text-xs font-mono">{p.rsi_at_entry?.toFixed(1) ?? '-'}</span>
        </div>
        <div>
          <span className="text-[10px] text-text-secondary block">Win Rate</span>
          <span className={`text-xs font-medium ${p.live_win_rate >= 70 ? 'text-profit' : p.live_win_rate >= 50 ? 'text-text-primary' : 'text-loss'}`}>
            {p.live_win_rate.toFixed(1)}%
          </span>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-text-secondary block">Risk DD</span>
          <span className={`text-xs font-medium ${p.risk_dd > 10 ? 'text-loss' : 'text-text-secondary'}`}>
            {p.risk_dd.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Entry Reason */}
      {p.entry_reason && (
        <div className="mt-2 pt-2 border-t border-border/50">
          <span className="text-[10px] text-text-secondary">
            {p.entry_reason}
          </span>
        </div>
      )}
    </div>
  );
}

export default function ActivePositions() {
  const { positions } = useBotStore();

  if (positions.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary shadow-sm">
        No active positions
      </div>
    );
  }

  const trading = positions.filter((p) => p.has_position);
  const idle = positions.filter((p) => !p.has_position);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          Active Positions
          {trading.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-accent text-xs font-mono font-semibold">
              {trading.length} trading
            </span>
          )}
        </h3>
      </div>

      {/* Trading positions — card layout */}
      {trading.length > 0 && (
        <div className={`grid gap-3 ${trading.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
          {trading.map((p) => (
            <PositionCard key={p.coin} p={p} />
          ))}
        </div>
      )}

      {/* Idle/Drain positions — compact table */}
      {idle.length > 0 && (
        <div className="bg-bg-secondary border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-secondary text-xs border-b border-border bg-bg-tertiary">
                  <th className="px-4 py-2.5 text-left font-medium">Coin</th>
                  <th className="px-4 py-2.5 text-left font-medium">Strategy</th>
                  <th className="px-4 py-2.5 text-right font-medium">Win Rate</th>
                  <th className="px-4 py-2.5 text-right font-medium">Risk DD</th>
                  <th className="px-4 py-2.5 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {idle.map((p) => (
                  <tr key={p.coin} className="border-b border-border/50 hover:bg-bg-tertiary/50 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{p.coin}</td>
                    <td className="px-4 py-2.5 text-text-secondary text-xs">{p.strategy}</td>
                    <td className={`px-4 py-2.5 text-right font-medium ${p.live_win_rate >= 70 ? 'text-profit' : p.live_win_rate >= 50 ? 'text-text-primary' : 'text-loss'}`}>
                      {p.live_win_rate.toFixed(1)}%
                    </td>
                    <td className={`px-4 py-2.5 text-right ${p.risk_dd > 10 ? 'text-loss font-medium' : 'text-text-secondary'}`}>
                      {p.risk_dd.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {p.draining ? (
                        <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs font-medium">DRAIN</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-text-secondary text-xs">IDLE</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

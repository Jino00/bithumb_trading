// 멀티코인 페이퍼 트레이딩 — 코인별 실시간 상태 카드 (Light theme).
import type { PaperCoinSlotInfo } from '../../types';

interface Props {
  slot: PaperCoinSlotInfo;
}

const regimeColors: Record<string, string> = {
  BULL: 'text-green-600',
  TRENDING_UP: 'text-green-600',
  SIDEWAYS: 'text-yellow-600',
  BEAR: 'text-red-600',
  TRENDING_DOWN: 'text-red-600',
};

const tierBadge: Record<string, { bg: string; text: string }> = {
  EXTREME: { bg: 'bg-red-100', text: 'text-red-700' },
  HOT: { bg: 'bg-orange-100', text: 'text-orange-700' },
  NORMAL: { bg: 'bg-gray-100', text: 'text-gray-600' },
};

function fmtKrw(v: number): string {
  if (Math.abs(v) >= 1_0000_0000) return `${(v / 1_0000_0000).toFixed(1)}억`;
  if (Math.abs(v) >= 1_0000) return `${(v / 10000).toFixed(1)}만`;
  return v.toLocaleString();
}

function fmtPrice(v: number): string {
  if (v >= 1_000_000) return `${(v / 10000).toFixed(0)}만`;
  if (v >= 1000) return v.toLocaleString();
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(4);
}

export default function PaperCoinCard({ slot }: Props) {
  const retColor = slot.total_return_pct >= 0 ? 'text-profit' : 'text-loss';
  const hasPosition = slot.position !== null;
  const priceUp = (slot.price_change_pct ?? 0) >= 0;
  const tier = slot.volatility_tier || 'NORMAL';
  const badge = tierBadge[tier] || tierBadge.NORMAL;

  return (
    <div
      className={`bg-bg-secondary border rounded-xl p-4 shadow-sm transition-all ${
        slot.draining
          ? 'border-yellow-300 opacity-70'
          : hasPosition
            ? 'border-green-200 shadow-green-50'
            : 'border-border'
      }`}
    >
      {/* 헤더: 코인 + 레짐 + 배지 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{slot.coin}</span>
          <span className={`text-xs font-medium ${regimeColors[slot.regime] || 'text-text-secondary'}`}>
            {slot.regime}
          </span>
          {tier !== 'NORMAL' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${badge.bg} ${badge.text}`}>
              {tier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {slot.draining && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700 font-medium">
              DRAIN
            </span>
          )}
          {hasPosition && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 font-medium animate-pulse">
              HOLD
            </span>
          )}
        </div>
      </div>

      {/* 현재가 + 가격 변동 (실시간) */}
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xl font-bold tabular-nums">
          {slot.current_price > 0 ? `${fmtPrice(slot.current_price)}원` : '-'}
        </span>
        <span className={`text-sm font-semibold tabular-nums ${priceUp ? 'text-profit' : 'text-loss'}`}>
          {priceUp ? '▲' : '▼'} {Math.abs(slot.price_change_pct ?? 0).toFixed(2)}%
        </span>
      </div>

      {/* 전략 */}
      <div className="text-xs text-text-secondary mb-2">
        {slot.active_strategy_name || 'N/A'}
      </div>

      {/* KPI 행: 투자금 / 수익률 / 거래 / 승률 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <div className="text-xs text-text-secondary">
            투자금
            {slot.allocation_weight !== 1.0 && (
              <span className={`ml-1 px-1 py-0.5 rounded text-[10px] font-medium ${
                slot.allocation_weight >= 1.0
                  ? 'bg-green-50 text-green-600'
                  : 'bg-yellow-50 text-yellow-700'
              }`}>
                x{slot.allocation_weight.toFixed(2)}
              </span>
            )}
          </div>
          <div className="text-sm font-medium tabular-nums">
            {fmtKrw(slot.balance_krw)}원
          </div>
        </div>
        <div>
          <div className="text-xs text-text-secondary">총 수익률</div>
          <div className={`text-sm font-medium tabular-nums ${retColor}`}>
            {slot.total_return_pct >= 0 ? '+' : ''}
            {slot.total_return_pct.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-text-secondary">거래</div>
          <div className="text-sm tabular-nums">{slot.total_trades}건</div>
        </div>
        <div>
          <div className="text-xs text-text-secondary">승률</div>
          <div className={`text-sm font-medium tabular-nums ${
            slot.total_trades > 0 ? (slot.win_rate >= 50 ? 'text-profit' : 'text-loss') : 'text-text-secondary'
          }`}>
            {slot.total_trades > 0 ? `${slot.win_rate.toFixed(1)}%` : '-'}
          </div>
        </div>
      </div>

      {/* 포지션 상세 바 (보유 중일 때만) */}
      {hasPosition && slot.position && (() => {
        const pnl = slot.position.unrealized_pnl_pct ?? 0;
        const pnlKrw = slot.position.unrealized_krw ?? 0;
        const stratName = slot.position.strategy_name || slot.position.strategy || '';
        const isProfit = pnl >= 0;
        return (
          <div className={`rounded-lg p-2.5 text-xs space-y-1.5 ${
            isProfit ? 'bg-green-50' : 'bg-red-50'
          }`}>
            {/* 진입가 vs 현재가 */}
            <div className="flex justify-between items-center">
              <span className="text-text-secondary">
                진입 {slot.position.entry_price.toLocaleString()}원
              </span>
              <div className="text-right">
                <span className={`text-sm font-bold ${isProfit ? 'text-profit' : 'text-loss'}`}>
                  {isProfit ? '+' : ''}{pnl.toFixed(2)}%
                </span>
                <span className={`ml-1.5 text-[11px] ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                  ({isProfit ? '+' : ''}{fmtKrw(pnlKrw)}원)
                </span>
              </div>
            </div>
            {/* SL — 전략 — TP */}
            <div className="flex justify-between text-text-secondary">
              <span className="text-red-500">SL -{slot.position.sl_pct.toFixed(1)}%</span>
              <span className="font-medium">{stratName}</span>
              <span className="text-green-600">TP +{slot.position.tp_pct.toFixed(1)}%</span>
            </div>
            {/* SL~TP 프로그레스 바 */}
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isProfit ? 'bg-profit' : 'bg-loss'}`}
                style={{
                  width: `${Math.min(
                    Math.max(((pnl + slot.position.sl_pct) /
                      (slot.position.sl_pct + slot.position.tp_pct)) * 100, 2),
                    100
                  )}%`,
                }}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

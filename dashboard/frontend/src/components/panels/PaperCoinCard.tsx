// 멀티코인 페이퍼 트레이딩 — 코인별 상태 카드.
import type { PaperCoinSlotInfo } from '../../types';

interface Props {
  slot: PaperCoinSlotInfo;
}

const regimeColors: Record<string, string> = {
  BULL: 'text-profit',
  TRENDING_UP: 'text-profit',
  SIDEWAYS: 'text-yellow-400',
  BEAR: 'text-loss',
  TRENDING_DOWN: 'text-loss',
};

export default function PaperCoinCard({ slot }: Props) {
  const retColor = slot.total_return_pct >= 0 ? 'text-profit' : 'text-loss';
  const hasPosition = slot.position !== null;

  return (
    <div
      className={`bg-bg-secondary border rounded-xl p-4 ${
        slot.draining
          ? 'border-yellow-500/50 opacity-70'
          : hasPosition
            ? 'border-profit/30'
            : 'border-border'
      }`}
    >
      {/* 헤더: 코인 + 전략 + 배지 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{slot.coin}</span>
          <span className={`text-xs ${regimeColors[slot.regime] || 'text-text-secondary'}`}>
            {slot.regime}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {slot.draining && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium">
              DRAIN
            </span>
          )}
          {hasPosition && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-profit/15 text-profit font-medium">
              HOLD
            </span>
          )}
        </div>
      </div>

      {/* 전략 */}
      <div className="text-xs text-text-secondary mb-2">
        {slot.active_strategy_name || 'N/A'}
      </div>

      {/* KPI 행 */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <div className="text-xs text-text-secondary">자본</div>
          <div className="text-sm font-medium">
            {slot.balance_krw.toLocaleString()}원
          </div>
        </div>
        <div>
          <div className="text-xs text-text-secondary">수익률</div>
          <div className={`text-sm font-medium ${retColor}`}>
            {slot.total_return_pct >= 0 ? '+' : ''}
            {slot.total_return_pct.toFixed(2)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-text-secondary">거래</div>
          <div className="text-sm">{slot.total_trades}건</div>
        </div>
        <div>
          <div className="text-xs text-text-secondary">승률</div>
          <div className={`text-sm ${slot.win_rate >= 50 ? 'text-profit' : 'text-loss'}`}>
            {slot.win_rate.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 포지션 바 */}
      {hasPosition && slot.position && (
        <div className="bg-bg-tertiary/50 rounded-lg p-2 text-xs">
          <div className="flex justify-between mb-1">
            <span>진입: {slot.position.entry_price.toLocaleString()}원</span>
            <span className="text-text-secondary">
              SL {slot.position.sl_pct.toFixed(1)}% / TP {slot.position.tp_pct.toFixed(1)}%
            </span>
          </div>
          {/* SL/TP 프로그레스바 */}
          <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
            <div
              className="h-full bg-profit rounded-full"
              style={{
                width: `${Math.min(
                  (slot.position.sl_pct / (slot.position.sl_pct + slot.position.tp_pct)) * 100,
                  100
                )}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// 현재 페이퍼 포지션 카드 — 진입가, SL/TP 프로그레스바, 미실현 손익.
import type { PaperPositionInfo } from '../../types';

interface Props {
  position: PaperPositionInfo | null;
  currentPrice?: number;
}

export default function PaperPositionCard({ position, currentPrice }: Props) {
  if (!position) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center">
        <div className="text-text-secondary text-sm">포지션 없음</div>
        <div className="text-xs text-text-secondary mt-1">신호 대기 중...</div>
      </div>
    );
  }

  const estimatedPrice = currentPrice || position.entry_price;
  const pnlPct = ((estimatedPrice - position.entry_price) / position.entry_price) * 100;
  const pnlKrw = position.invested_krw * (pnlPct / 100);

  // SL/TP 진행률 계산
  const totalRange = position.sl_pct + position.tp_pct;
  const progress = totalRange > 0
    ? ((pnlPct + position.sl_pct) / totalRange) * 100
    : 50;
  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">현재 포지션</h3>

      <div className="space-y-3">
        {/* 전략 + 코인 */}
        <div className="flex items-center justify-between">
          <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded">
            {position.strategy}
          </span>
          <span className="text-sm font-medium">{position.coin}</span>
        </div>

        {/* 진입가 + 투입금 */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-text-secondary">진입가</div>
            <div className="font-medium">{position.entry_price.toLocaleString()}원</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">투입금</div>
            <div className="font-medium">{position.invested_krw.toLocaleString()}원</div>
          </div>
        </div>

        {/* 미실현 손익 */}
        <div className="text-center">
          <div className="text-xs text-text-secondary">미실현 손익</div>
          <div
            className={`text-lg font-bold ${
              pnlPct >= 0 ? 'text-profit' : 'text-loss'
            }`}
          >
            {pnlKrw >= 0 ? '+' : ''}{pnlKrw.toLocaleString(undefined, { maximumFractionDigits: 0 })}원
            ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
          </div>
        </div>

        {/* SL / TP 프로그레스바 */}
        <div>
          <div className="flex justify-between text-xs text-text-secondary mb-1">
            <span>SL -{position.sl_pct.toFixed(1)}%</span>
            <span>TP +{position.tp_pct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden relative">
            <div
              className="absolute h-full bg-gradient-to-r from-loss via-text-secondary to-profit rounded-full transition-all"
              style={{ width: `${clampedProgress}%` }}
            />
          </div>
        </div>

        {/* 진입 시간 */}
        <div className="text-xs text-text-secondary text-center">
          진입: {position.entry_time}
        </div>
      </div>
    </div>
  );
}

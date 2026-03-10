// 페이퍼 거래 이력 테이블 — 시간, 방향, 가격, 손익, 사유, 전략.
import type { PaperTradeRecord } from '../../types';

interface Props {
  trades: PaperTradeRecord[];
}

export default function PaperTradeHistory({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary">
        거래 이력 없음
      </div>
    );
  }

  // 최신순 정렬
  const sorted = [...trades].reverse();

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">거래 이력 ({trades.length}건)</h3>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-secondary">
            <tr className="text-text-secondary text-xs border-b border-border">
              <th className="text-left py-2 px-2">시간</th>
              <th className="text-left py-2 px-2">전략</th>
              <th className="text-right py-2 px-2">진입가</th>
              <th className="text-right py-2 px-2">청산가</th>
              <th className="text-right py-2 px-2">손익</th>
              <th className="text-left py-2 px-2">사유</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, idx) => (
              <tr key={idx} className="border-b border-border/50">
                <td className="py-1.5 px-2 text-xs text-text-secondary whitespace-nowrap">
                  {t.exit_time}
                </td>
                <td className="py-1.5 px-2 text-xs">{t.strategy}</td>
                <td className="py-1.5 px-2 text-right text-xs">
                  {t.entry_price.toLocaleString()}
                </td>
                <td className="py-1.5 px-2 text-right text-xs">
                  {t.exit_price.toLocaleString()}
                </td>
                <td
                  className={`py-1.5 px-2 text-right text-xs font-medium ${
                    t.pnl_pct >= 0 ? 'text-profit' : 'text-loss'
                  }`}
                >
                  {t.pnl_krw >= 0 ? '+' : ''}{t.pnl_krw.toLocaleString()}원
                  <span className="ml-1 opacity-70">
                    ({t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%)
                  </span>
                </td>
                <td className="py-1.5 px-2 text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      t.exit_reason === 'TP'
                        ? 'bg-profit/10 text-profit'
                        : t.exit_reason === 'SL'
                          ? 'bg-loss/10 text-loss'
                          : 'bg-bg-tertiary text-text-secondary'
                    }`}
                  >
                    {t.exit_reason}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

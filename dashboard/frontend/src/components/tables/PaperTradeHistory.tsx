// 페이퍼 거래 이력 테이블 (Light theme).
import type { PaperTradeRecord } from '../../types';

interface Props {
  trades: PaperTradeRecord[];
  multiCoin?: boolean;
}

export default function PaperTradeHistory({ trades, multiCoin = false }: Props) {
  if (trades.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary shadow-sm">
        거래 이력 없음
      </div>
    );
  }

  const sorted = [...trades].reverse();

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm">
      <h3 className="text-sm font-semibold mb-3">거래 이력 ({trades.length}건)</h3>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-bg-secondary">
            <tr className="text-text-secondary text-xs border-b border-border bg-bg-tertiary">
              <th className="text-left py-2.5 px-2 font-medium">시간</th>
              {multiCoin && <th className="text-left py-2.5 px-2 font-medium">코인</th>}
              <th className="text-left py-2.5 px-2 font-medium">전략</th>
              <th className="text-right py-2.5 px-2 font-medium">진입가</th>
              <th className="text-right py-2.5 px-2 font-medium">청산가</th>
              <th className="text-right py-2.5 px-2 font-medium">손익</th>
              <th className="text-left py-2.5 px-2 font-medium">사유</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, idx) => (
              <tr key={idx} className="border-b border-border/50 hover:bg-bg-tertiary/50 transition-colors">
                <td className="py-2 px-2 text-xs text-text-secondary whitespace-nowrap">
                  {t.exit_time}
                </td>
                {multiCoin && (
                  <td className="py-2 px-2 text-xs font-medium">
                    {t.coin || '—'}
                  </td>
                )}
                <td className="py-2 px-2 text-xs">{t.strategy}</td>
                <td className="py-2 px-2 text-right text-xs font-mono">
                  {t.entry_price.toLocaleString()}
                </td>
                <td className="py-2 px-2 text-right text-xs font-mono">
                  {t.exit_price.toLocaleString()}
                </td>
                <td
                  className={`py-2 px-2 text-right text-xs font-medium ${
                    t.pnl_pct >= 0 ? 'text-profit' : 'text-loss'
                  }`}
                >
                  {t.pnl_krw >= 0 ? '+' : ''}{t.pnl_krw.toLocaleString()}원
                  <span className="ml-1 opacity-70">
                    ({t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%)
                  </span>
                </td>
                <td className="py-2 px-2 text-xs">
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                      t.exit_reason === 'TP'
                        ? 'bg-green-50 text-green-600'
                        : t.exit_reason === 'SL'
                          ? 'bg-red-50 text-red-600'
                          : 'bg-gray-100 text-text-secondary'
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

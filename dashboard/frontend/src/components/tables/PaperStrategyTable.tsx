// 6전략 평가 테이블 — 순위, 전략명, 거래수, 승률, PF, 수익률, 점수.
import type { PaperEvalScore } from '../../types';

interface Props {
  scores: PaperEvalScore[];
}

export default function PaperStrategyTable({ scores }: Props) {
  if (scores.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary">
        전략 평가 데이터 없음
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">전략 평가 (6전략)</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-xs border-b border-border">
              <th className="text-left py-2 px-2">#</th>
              <th className="text-left py-2 px-2">전략</th>
              <th className="text-right py-2 px-2">거래</th>
              <th className="text-right py-2 px-2">승률</th>
              <th className="text-right py-2 px-2">PF</th>
              <th className="text-right py-2 px-2">수익률</th>
              <th className="text-right py-2 px-2">점수</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s, idx) => (
              <tr
                key={s.strategy_id}
                className={`border-b border-border/50 ${
                  s.is_active ? 'bg-accent/5' : ''
                }`}
              >
                <td className="py-2 px-2 text-text-secondary">{idx + 1}</td>
                <td className="py-2 px-2">
                  <span className="font-medium">{s.name}</span>
                  {s.is_active && (
                    <span className="ml-2 text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">
                      ACTIVE
                    </span>
                  )}
                </td>
                <td className="py-2 px-2 text-right">{s.trades_count}</td>
                <td className="py-2 px-2 text-right">{s.win_rate.toFixed(1)}%</td>
                <td className="py-2 px-2 text-right">{s.pf.toFixed(2)}</td>
                <td
                  className={`py-2 px-2 text-right font-medium ${
                    s.total_return >= 0 ? 'text-profit' : 'text-loss'
                  }`}
                >
                  {s.total_return >= 0 ? '+' : ''}{s.total_return.toFixed(2)}%
                </td>
                <td className="py-2 px-2 text-right font-bold">{s.score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

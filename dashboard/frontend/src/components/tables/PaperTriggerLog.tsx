// 모니터 트리거 이벤트 로그 — 시간, 타입, 심각도 배지, 설명.
import type { PaperTriggerEvent } from '../../types';

interface Props {
  triggers: PaperTriggerEvent[];
}

const severityStyles: Record<string, string> = {
  HIGH: 'bg-loss/15 text-loss',
  MEDIUM: 'bg-yellow-500/15 text-yellow-400',
  LOW: 'bg-bg-tertiary text-text-secondary',
};

export default function PaperTriggerLog({ triggers }: Props) {
  if (triggers.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border rounded-xl p-6 text-center text-text-secondary">
        트리거 이력 없음
      </div>
    );
  }

  // 최신순
  const sorted = [...triggers].reverse();

  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4">
      <h3 className="text-sm font-semibold mb-3">트리거 이벤트 ({triggers.length}건)</h3>
      <div className="overflow-y-auto max-h-64 space-y-2">
        {sorted.map((t, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 p-2 rounded-lg bg-bg-tertiary/30"
          >
            <span
              className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                severityStyles[t.severity] || severityStyles.LOW
              }`}
            >
              {t.severity}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{t.trigger_type}</span>
                {t.old_value && t.new_value && (
                  <span className="text-xs text-text-secondary">
                    {t.old_value} → {t.new_value}
                  </span>
                )}
              </div>
              <div className="text-xs text-text-secondary truncate">
                {t.description}
              </div>
            </div>
            <span className="text-xs text-text-secondary shrink-0">
              {t.timestamp}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

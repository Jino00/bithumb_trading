// 단일 KPI 메트릭 카드.
import type { LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  value: string;
  icon: LucideIcon;
  color?: 'default' | 'profit' | 'loss' | 'accent';
}

const colorMap = {
  default: 'text-text-primary',
  profit: 'text-profit',
  loss: 'text-loss',
  accent: 'text-accent',
};

export default function KPICard({ label, value, icon: Icon, color = 'default' }: Props) {
  return (
    <div className="bg-bg-secondary border border-border rounded-xl p-4 flex items-center gap-4">
      <div className="p-2 rounded-lg bg-bg-tertiary">
        <Icon className={`w-5 h-5 ${colorMap[color]}`} />
      </div>
      <div>
        <div className="text-xs text-text-secondary">{label}</div>
        <div className={`text-xl font-bold ${colorMap[color]}`}>{value}</div>
      </div>
    </div>
  );
}

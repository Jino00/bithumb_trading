// 단일 KPI 메트릭 카드 — Meta Ads 스타일 색상 배경.
import type { LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  value: string;
  icon: LucideIcon;
  color?: 'default' | 'profit' | 'loss' | 'accent';
  sub?: string;
}

const bgMap = {
  default: 'bg-kpi-blue',
  profit: 'bg-kpi-green',
  loss: 'bg-kpi-red',
  accent: 'bg-kpi-purple',
};

const iconBgMap = {
  default: 'bg-blue-100 text-blue-600',
  profit: 'bg-green-100 text-green-600',
  loss: 'bg-red-100 text-red-600',
  accent: 'bg-purple-100 text-purple-600',
};

const valueColorMap = {
  default: 'text-text-primary',
  profit: 'text-profit',
  loss: 'text-loss',
  accent: 'text-accent',
};

export default function KPICard({ label, value, icon: Icon, color = 'default', sub }: Props) {
  return (
    <div className={`${bgMap[color]} rounded-xl p-4 flex items-center gap-4 border border-border/50 shadow-sm`}>
      <div className={`p-2.5 rounded-xl ${iconBgMap[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-text-secondary font-medium">{label}</div>
        <div className={`text-xl font-bold ${valueColorMap[color]} truncate`}>{value}</div>
        {sub && <div className="text-[11px] text-text-secondary mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

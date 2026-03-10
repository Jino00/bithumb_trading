// 사이드바 — 네비게이션 + 활성 코인 목록.
import { LayoutDashboard, History, BarChart3, FlaskConical } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useBotStore } from '../../stores/botStore';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/paper', icon: FlaskConical, label: 'Paper Trading' },
  { to: '/trades', icon: History, label: 'Trades' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

export default function Sidebar() {
  const { activeCoins, positions } = useBotStore();

  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col">
      {/* Navigation */}
      <nav className="p-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Active Coins */}
      <div className="mt-4 px-4">
        <div className="text-xs text-text-secondary uppercase tracking-wider mb-2">
          Active Coins
        </div>
        {activeCoins.length === 0 ? (
          <div className="text-xs text-text-secondary py-2">No active coins</div>
        ) : (
          <div className="space-y-1">
            {activeCoins.map((coin) => {
              const pos = positions.find((p) => p.coin === coin);
              return (
                <div
                  key={coin}
                  className="flex items-center justify-between px-3 py-1.5 rounded bg-bg-tertiary/50 text-sm"
                >
                  <span className="font-medium">{coin}</span>
                  <div className="flex items-center gap-1">
                    {pos?.has_position && (
                      <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    )}
                    {pos?.draining && (
                      <span className="text-xs text-loss">DRAIN</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto p-4 text-xs text-text-secondary">
        Bithumb Trading Bot v1.0
      </div>
    </aside>
  );
}

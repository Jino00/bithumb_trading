// 사이드바 — 네비게이션 + 활성 코인 목록 (Light theme).
import { LayoutDashboard, History, BarChart3, FlaskConical, Search, BookOpen, Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useBotStore } from '../../stores/botStore';
import { useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/screening', icon: Search, label: 'Screening' },
  {
    label: 'Paper Trading',
    icon: FlaskConical,
    children: [
      { to: '/paper', label: 'Bithumb' },
      { to: '/paper/binance', label: 'Binance' },
    ],
  },
  { to: '/journal', icon: BookOpen, label: 'Trade Journal' },
  { to: '/insights', icon: Brain, label: 'Insights' },
  { to: '/trades', icon: History, label: 'Trades' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

export default function Sidebar({ onNavClick }: { onNavClick?: () => void }) {
  const { activeCoins, positions } = useBotStore();
  const location = useLocation();
  const [paperOpen, setPaperOpen] = useState(
    location.pathname.startsWith('/paper')
  );

  return (
    <aside className="w-56 bg-bg-secondary border-r border-border flex flex-col">
      {/* Navigation */}
      <nav className="p-3 space-y-0.5">
        {navItems.map((item) => {
          // 하위 메뉴가 있는 경우 (Paper Trading)
          if ('children' in item && item.children) {
            const isChildActive = item.children.some(
              (c) => location.pathname === c.to
            );
            return (
              <div key={item.label}>
                <button
                  onClick={() => setPaperOpen(!paperOpen)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isChildActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  <item.icon className="w-[18px] h-[18px]" />
                  {item.label}
                  {paperOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 ml-auto" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 ml-auto" />
                  )}
                </button>
                {paperOpen && (
                  <div className="ml-7 mt-0.5 space-y-0.5">
                    {item.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                            isActive
                              ? 'bg-accent/10 text-accent'
                              : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                          }`
                        }
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          child.label === 'Bithumb' ? 'bg-orange-400' : 'bg-yellow-400'
                        }`} />
                        {child.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          // 일반 메뉴
          return (
            <NavLink
              key={item.to}
              to={item.to!}
              onClick={onNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
                }`
              }
            >
              <item.icon className="w-[18px] h-[18px]" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Active Coins */}
      <div className="mt-4 px-4">
        <div className="text-[10px] text-text-secondary uppercase tracking-widest font-semibold mb-2">
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
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-bg-tertiary text-sm"
                >
                  <span className="font-medium text-text-primary">{coin}</span>
                  <div className="flex items-center gap-1.5">
                    {pos?.has_position && (
                      <span className="w-2 h-2 rounded-full bg-profit animate-pulse" />
                    )}
                    {pos?.draining && (
                      <span className="text-[10px] font-semibold text-loss bg-red-50 px-1.5 py-0.5 rounded">DRAIN</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto p-4 text-[11px] text-text-secondary">
        Bithumb Trading Bot v1.0
      </div>
    </aside>
  );
}

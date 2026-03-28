// 레이아웃 — Header + Sidebar + Main 영역.
import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import { useWebSocket } from '../../hooks/useWebSocket';

export default function DashboardLayout() {
  useWebSocket();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="h-screen flex flex-col">
      <Header onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* Sidebar: hidden on mobile, visible on lg+ */}
        <div className={`
          fixed inset-y-0 left-0 z-40 w-56 transform transition-transform duration-200
          lg:relative lg:translate-x-0 lg:z-auto
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <Sidebar onNavClick={() => setSidebarOpen(false)} />
        </div>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-bg-primary">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

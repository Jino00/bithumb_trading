// 레이아웃 — Header + Sidebar + Main 영역.
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import { useWebSocket } from '../../hooks/useWebSocket';

export default function DashboardLayout() {
  useWebSocket();

  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6 bg-bg-primary">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

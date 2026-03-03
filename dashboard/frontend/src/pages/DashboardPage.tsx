// 메인 대시보드 페이지 — KPI + 포지션 + P&L + 이벤트.
import KPIGrid from '../components/cards/KPIGrid';
import ActivePositions from '../components/tables/ActivePositions';
import PnLSeries from '../components/charts/PnLSeries';
import MarketRegimePanel from '../components/panels/MarketRegime';
import EventLog from '../components/tables/EventLog';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <KPIGrid />

      <ActivePositions />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MarketRegimePanel />
        <PnLSeries />
      </div>

      <EventLog limit={10} />
    </div>
  );
}

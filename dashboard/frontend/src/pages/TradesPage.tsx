// 거래 이력 페이지 — 테이블 + 에쿼티 커브.
import TradeHistory from '../components/tables/TradeHistory';
import EquityCurve from '../components/charts/EquityCurve';

export default function TradesPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Trade History</h2>
      <TradeHistory limit={50} />
      <EquityCurve />
    </div>
  );
}

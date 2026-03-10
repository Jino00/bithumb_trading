// 페이퍼 트레이딩 대시보드 페이지 — KPI + 전략 테이블 + 포지션 + 거래 + 차트 + 트리거.
import {
  Wallet,
  TrendingUp,
  BarChart3,
  Award,
  Activity,
  RefreshCw,
} from 'lucide-react';
import KPICard from '../components/cards/KPICard';
import PaperStrategyTable from '../components/tables/PaperStrategyTable';
import PaperPositionCard from '../components/panels/PaperPositionCard';
import PaperTradeHistory from '../components/tables/PaperTradeHistory';
import PaperEquityCurve from '../components/charts/PaperEquityCurve';
import PaperTriggerLog from '../components/tables/PaperTriggerLog';
import { usePaperOverview } from '../hooks/useApi';

export default function PaperTradingPage() {
  const { data, isLoading, error } = usePaperOverview();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        로딩 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-loss">
        API 오류: {(error as Error).message}
      </div>
    );
  }

  if (!data || !data.updated_at) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-secondary gap-2">
        <Activity className="w-8 h-8 opacity-40" />
        <div>페이퍼 트레이딩 데이터 없음</div>
        <div className="text-xs">paper_trader.py를 실행하세요</div>
      </div>
    );
  }

  const kpi = data.kpi;
  const pnlColor = kpi.total_return_pct >= 0 ? 'profit' : 'loss';

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Paper Trading</h1>
          <p className="text-sm text-text-secondary">
            {kpi.coin} · {kpi.active_strategy_name || 'N/A'} · {kpi.regime}
          </p>
        </div>
        <div className="text-xs text-text-secondary">
          업데이트: {data.updated_at} · 사이클: {kpi.cycle_count}
        </div>
      </div>

      {/* KPI 카드 행 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="잔고"
          value={`${kpi.total_value.toLocaleString()}원`}
          icon={Wallet}
          color="default"
        />
        <KPICard
          label="수익률"
          value={`${kpi.total_return_pct >= 0 ? '+' : ''}${kpi.total_return_pct.toFixed(2)}%`}
          icon={TrendingUp}
          color={pnlColor as 'profit' | 'loss'}
        />
        <KPICard
          label="거래수"
          value={`${kpi.total_trades}건`}
          icon={BarChart3}
          color="default"
        />
        <KPICard
          label="승률"
          value={`${kpi.win_rate.toFixed(1)}%`}
          icon={Award}
          color={kpi.win_rate >= 50 ? 'profit' : 'loss'}
        />
      </div>

      {/* 전략 테이블 + 포지션 카드 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PaperStrategyTable scores={data.eval_scores} />
        </div>
        <div>
          <PaperPositionCard position={data.position} />
        </div>
      </div>

      {/* 자본 곡선 */}
      <PaperEquityCurve
        data={data.equity_curve}
        initialCapital={kpi.initial_capital}
      />

      {/* 거래 이력 + 트리거 로그 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PaperTradeHistory trades={data.trades} />
        <PaperTriggerLog triggers={data.triggers} />
      </div>
    </div>
  );
}

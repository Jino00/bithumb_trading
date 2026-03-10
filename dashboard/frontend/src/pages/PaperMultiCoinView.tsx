// 멀티코인 페이퍼 포트폴리오 뷰 — 코인 카드 그리드 + 포트폴리오 KPI.
import {
  Wallet,
  TrendingUp,
  BarChart3,
  Coins,
  Search,
  ShieldOff,
} from 'lucide-react';
import KPICard from '../components/cards/KPICard';
import PaperCoinCard from '../components/panels/PaperCoinCard';
import PaperEquityCurve from '../components/charts/PaperEquityCurve';
import PaperTradeHistory from '../components/tables/PaperTradeHistory';
import PaperTriggerLog from '../components/tables/PaperTriggerLog';
import type { PaperOverview } from '../types';

interface Props {
  data: PaperOverview;
}

export default function PaperMultiCoinView({ data }: Props) {
  const pk = data.portfolio_kpi!;
  const pnlColor = pk.total_return_pct >= 0 ? 'profit' : 'loss';

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Portfolio Paper Trading</h1>
          <p className="text-sm text-text-secondary">
            {pk.active_coins.length}/{pk.max_positions} 코인 활성 ·
            스캔 {pk.scan_count}회 ·
            블랙리스트 {pk.blacklist.length}개
          </p>
        </div>
        <div className="text-xs text-text-secondary">
          업데이트: {data.updated_at} · 사이클: {data.kpi.cycle_count}
        </div>
      </div>

      {/* 포트폴리오 KPI 카드 행 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          label="총 자산"
          value={`${pk.total_value.toLocaleString()}원`}
          icon={Wallet}
          color="default"
        />
        <KPICard
          label="수익률"
          value={`${pk.total_return_pct >= 0 ? '+' : ''}${pk.total_return_pct.toFixed(2)}%`}
          icon={TrendingUp}
          color={pnlColor as 'profit' | 'loss'}
        />
        <KPICard
          label="거래수"
          value={`${pk.total_trades}건`}
          icon={BarChart3}
          color="default"
        />
        <KPICard
          label="승률"
          value={`${pk.win_rate.toFixed(1)}%`}
          icon={Coins}
          color={pk.win_rate >= 50 ? 'profit' : 'loss'}
        />
        <KPICard
          label="미배분"
          value={`${pk.unallocated_krw.toLocaleString()}원`}
          icon={Search}
          color="default"
        />
      </div>

      {/* 코인 카드 그리드 */}
      <div>
        <h2 className="text-sm font-semibold mb-3">
          활성 코인 ({data.positions.length}개)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {data.positions.map((slot) => (
            <PaperCoinCard key={slot.coin} slot={slot} />
          ))}
          {/* 빈 슬롯 표시 */}
          {Array.from({
            length: Math.max(0, pk.max_positions - data.positions.length),
          }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="bg-bg-secondary border border-border/50 border-dashed rounded-xl p-4 flex items-center justify-center text-text-secondary text-sm"
            >
              <Search className="w-4 h-4 mr-1.5 opacity-40" />
              스캔 대기
            </div>
          ))}
        </div>
      </div>

      {/* 블랙리스트 (있으면 표시) */}
      {pk.blacklist.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <ShieldOff className="w-3.5 h-3.5" />
          <span>블랙리스트: {pk.blacklist.join(', ')}</span>
        </div>
      )}

      {/* 자본 곡선 */}
      <PaperEquityCurve
        data={data.equity_curve}
        initialCapital={pk.initial_capital}
      />

      {/* 거래 이력 + 트리거 로그 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PaperTradeHistory trades={data.trades} multiCoin />
        <PaperTriggerLog triggers={data.triggers} />
      </div>
    </div>
  );
}

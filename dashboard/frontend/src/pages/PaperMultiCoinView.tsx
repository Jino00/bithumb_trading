// 멀티코인 페이퍼 포트폴리오 뷰 (Light theme).
import {
  Wallet,
  TrendingUp,
  BarChart3,
  Coins,
  Search,
  ShieldOff,
  Brain,
  Shield,
  Clock,
  AlertTriangle,
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

/** 큰 숫자를 축약 (1억+ → "1.0억원", 1만+ → "999만원") */
function fmtKrw(v: number): string {
  if (Math.abs(v) >= 1_0000_0000) return `${(v / 1_0000_0000).toFixed(1)}억원`;
  if (Math.abs(v) >= 1_0000) return `${Math.round(v / 10000)}만원`;
  return `${v.toLocaleString()}원`;
}

export default function PaperMultiCoinView({ data }: Props) {
  const pk = data.portfolio_kpi!;
  const pnlColor = pk.total_return_pct >= 0 ? 'profit' : 'loss';

  // ★ 미실현 수익 합계
  const totalUnrealized = data.positions.reduce(
    (sum, s) => sum + (s.unrealized_krw ?? 0), 0
  );
  const holdCount = data.positions.filter(s => s.position !== null).length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Portfolio Paper Trading</h1>
          <p className="text-sm text-text-secondary">
            {pk.active_coins.length}/{pk.max_positions} 코인 활성 ·
            {holdCount > 0 && <span className="text-green-600 font-medium"> {holdCount}개 보유 · </span>}
            스캔 {pk.scan_count}회 ·
            블랙리스트 {pk.blacklist.length}개
          </p>
        </div>
        <div className="text-xs text-text-secondary bg-bg-tertiary px-3 py-1.5 rounded-lg animate-pulse">
          LIVE · 사이클: {data.kpi.cycle_count}
        </div>
      </div>

      {/* 포트폴리오 KPI 카드 행 */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KPICard
          label="총 자산"
          value={fmtKrw(pk.total_value)}
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
          label="미실현 손익"
          value={`${totalUnrealized >= 0 ? '+' : ''}${fmtKrw(totalUnrealized)}원`}
          icon={TrendingUp}
          color={totalUnrealized >= 0 ? 'profit' : 'loss'}
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
          value={fmtKrw(pk.unallocated_krw)}
          icon={Search}
          color="accent"
        />
      </div>

      {/* ── 학습 인사이트 패널 ── */}
      {data.insight_actions && (
        <div className="bg-bg-secondary border border-border rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-bold">학습 인사이트</h2>
            <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
              NotebookLM 기반
            </span>
          </div>

          {/* 활성 필터 배지 */}
          <div className="flex flex-wrap gap-1.5">
            {data.insight_actions.active_filters.map((f, i) => (
              <span key={i} className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                {f}
              </span>
            ))}
            {data.insight_actions.disabled_strategies.map((s) => (
              <span key={s} className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">
                {s} 비활성
              </span>
            ))}
          </div>

          {/* 3열 그리드: 전략 점수 + 차단 + 상태 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 전략 점수 바 */}
            <div>
              <h3 className="text-[11px] font-semibold text-text-secondary mb-2 flex items-center gap-1">
                <BarChart3 className="w-3 h-3" /> 전략 승률
              </h3>
              <div className="space-y-1">
                {Object.entries(data.insight_actions.strategy_scores)
                  .sort(([,a], [,b]) => b - a)
                  .map(([strat, score]) => {
                    const disabled = data.insight_actions!.disabled_strategies
                      .some(d => strat.includes(d.replace('_Retest', '')));
                    return (
                      <div key={strat} className="flex items-center gap-2 text-[11px]">
                        <span className={`w-16 truncate ${disabled ? 'line-through text-text-secondary' : ''}`}>
                          {strat}
                        </span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${score >= 50 ? 'bg-green-500' : score >= 30 ? 'bg-yellow-500' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(score, 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono">
                          {score.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* 차단 현황 */}
            <div>
              <h3 className="text-[11px] font-semibold text-text-secondary mb-2 flex items-center gap-1">
                <Shield className="w-3 h-3" /> 차단 현황
              </h3>
              <div className="space-y-1.5 text-[11px]">
                {data.insight_actions.blocked_combos.length > 0 && (
                  <div className="bg-red-50 px-2 py-1 rounded">
                    <span className="text-red-600 font-medium">전략x레짐: </span>
                    {data.insight_actions.blocked_combos.join(', ')}
                  </div>
                )}
                {data.insight_actions.blocked_hours.length > 0 && (
                  <div className={`px-2 py-1 rounded ${
                    data.insight_actions.blocked_hours.includes(new Date().getHours())
                      ? 'bg-orange-100 animate-pulse' : 'bg-orange-50'
                  }`}>
                    <Clock className="w-3 h-3 inline mr-1 text-orange-500" />
                    <span className="text-orange-700 font-medium">차단 시간: </span>
                    {data.insight_actions.blocked_hours.map(h => `${h}시`).join(', ')}
                    {data.insight_actions.blocked_hours.includes(new Date().getHours()) && (
                      <span className="ml-1 text-orange-600 font-bold"> (현재 차단 중)</span>
                    )}
                  </div>
                )}
                {Object.entries(data.insight_actions.tier_scales).map(([tier, scale]) => (
                  <div key={tier} className="bg-yellow-50 px-2 py-1 rounded">
                    <span className="text-yellow-700 font-medium">{tier} 티어: </span>
                    포지션 {(scale * 100).toFixed(0)}%로 축소
                  </div>
                ))}
              </div>
            </div>

            {/* 학습 상태 */}
            <div>
              <h3 className="text-[11px] font-semibold text-text-secondary mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> 학습 상태
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary">연속 손실</span>
                  <span className={`font-mono font-bold ${
                    data.insight_actions.consecutive_losses >= 4 ? 'text-red-600' : ''
                  }`}>
                    {data.insight_actions.consecutive_losses} / 5
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      data.insight_actions.consecutive_losses >= 4 ? 'bg-red-500' :
                      data.insight_actions.consecutive_losses >= 2 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${(data.insight_actions.consecutive_losses / 5) * 100}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary">최대 연패</span>
                  <span className="font-mono">{data.insight_actions.max_consecutive_losses}회</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-text-secondary">SL 자동 확대</span>
                  <span className={`font-medium ${data.insight_actions.sl_widen ? 'text-orange-600' : 'text-green-600'}`}>
                    {data.insight_actions.sl_widen ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
              className="bg-bg-secondary border border-border border-dashed rounded-xl p-4 flex items-center justify-center text-text-secondary text-sm shadow-sm"
            >
              <Search className="w-4 h-4 mr-1.5 opacity-40" />
              스캔 대기
            </div>
          ))}
        </div>
      </div>

      {/* 블랙리스트 */}
      {pk.blacklist.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-text-secondary bg-red-50 px-3 py-2 rounded-lg">
          <ShieldOff className="w-3.5 h-3.5 text-red-400" />
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

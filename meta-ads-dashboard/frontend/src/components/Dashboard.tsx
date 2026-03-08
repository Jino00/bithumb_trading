// 메인 대시보드 — KPI 요약 카드 + 차트 + 기간 필터
// ⚠️ 재무 계산은 백엔드 API(biz-metrics.js)가 담당. 프론트에서 재계산 금지 (SSOT 원칙).
import { useState, useEffect, useCallback } from "react";
import { DollarSign, MousePointerClick, Target, Eye, Loader2, Building2, ChevronDown, TrendingUp, ShoppingCart, Wallet } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Campaign, DatePeriod, MetaBusiness, MetaAdAccount, fetchProfitability, ProfitabilityData } from "../lib/api";
import { formatCurrency, formatNumber } from "../lib/utils";

const DATE_RANGE_OPTIONS: { value: DatePeriod; label: string }[] = [
  { value: "1d", label: "1일" },
  { value: "7d", label: "7일" },
  { value: "15d", label: "15일" },
  { value: "30d", label: "30일" },
];

interface Props {
  campaigns: Campaign[];
  dateRange: DatePeriod;
  onDateRangeChange: (period: DatePeriod) => void;
  loading: boolean;
  activeOnly: boolean;
  onActiveOnlyChange: (value: boolean) => void;
  businesses: MetaBusiness[];
  selectedBusinessId: string;
  onBusinessChange: (businessId: string) => void;
  adAccounts: MetaAdAccount[];
  selectedAccountId: string;
  onAccountChange: (accountId: string) => void;
}

function KpiCard({ icon: Icon, label, value, subtext, color }: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  subtext: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-400">{subtext}</p>
        </div>
      </div>
    </div>
  );
}

const COLORS = ["#10B981", "#F59E0B", "#EF4444", "#6366F1", "#8B5CF6"];

export default function DashboardSummary({ campaigns, dateRange, onDateRangeChange, loading, activeOnly, onActiveOnlyChange, businesses, selectedBusinessId, onBusinessChange, adAccounts, selectedAccountId, onAccountChange }: Props) {
  // 수익성 데이터는 백엔드 API에서 가져옴 (프론트 재계산 금지 — SSOT)
  const [profitData, setProfitData] = useState<ProfitabilityData | null>(null);

  const loadProfitability = useCallback(async () => {
    try {
      const data = await fetchProfitability(dateRange);
      setProfitData(data);
    } catch {
      setProfitData(null);
    }
  }, [dateRange]);

  useEffect(() => {
    loadProfitability();
  }, [loadProfitability]);

  const totalSpend = campaigns.reduce((sum, c) => sum + c.total_spend, 0);
  const totalRevenue = campaigns.reduce((sum, c) => sum + (c.revenue || 0), 0);
  const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const totalPurchases = campaigns.reduce((sum, c) => sum + (c.purchase_count || 0), 0);
  const overallRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const avgCpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;

  // 수익성은 서버 응답 그대로 사용
  const profit = profitData?.summary;

  const barData = campaigns.map((c) => ({
    name: c.name.length > 15 ? c.name.substring(0, 15) + "..." : c.name,
    CTR: c.ctr,
    ROAS: c.roas,
    CPC: c.cpc,
  }));

  const pieData = campaigns.map((c) => ({
    name: c.name.length > 20 ? c.name.substring(0, 20) + "..." : c.name,
    value: c.total_spend,
  }));

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="space-y-3">
        {/* Business & Account Selectors */}
        {(businesses.length > 0 || adAccounts.length > 0) && (
          <div className="flex items-center gap-4 flex-wrap">
            {businesses.length > 0 && (
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-gray-400" />
                <div className="relative">
                  <select
                    value={selectedBusinessId}
                    onChange={(e) => onBusinessChange(e.target.value)}
                    className="pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">전체 비즈니스</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
            )}
            {adAccounts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">광고계정:</span>
                <div className="relative">
                  <select
                    value={selectedAccountId}
                    onChange={(e) => onAccountChange(e.target.value)}
                    className="pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">기본 계정</option>
                    {adAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Date Range & Active Filter */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">기간:</span>
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              {DATE_RANGE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => onDateRangeChange(value)}
                  disabled={loading}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    dateRange === value
                      ? "bg-blue-600 text-white font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {loading && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => onActiveOnlyChange(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">Active만 보기</span>
          </label>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={DollarSign}
          label="총 광고비"
          value={formatCurrency(totalSpend)}
          subtext={`${campaigns.length}개 캠페인`}
          color="bg-blue-500"
        />
        <KpiCard
          icon={TrendingUp}
          label="총 매출"
          value={formatCurrency(totalRevenue)}
          subtext={totalRevenue >= totalSpend ? `+${formatCurrency(totalRevenue - totalSpend)} 흑자` : `${formatCurrency(totalRevenue - totalSpend)} 적자`}
          color={totalRevenue >= totalSpend ? "bg-green-500" : "bg-red-500"}
        />
        <KpiCard
          icon={Target}
          label="전체 ROAS"
          value={`${overallRoas.toFixed(2)}x`}
          subtext={overallRoas >= 2 ? "양호" : overallRoas >= 1 ? "손익분기" : "적자"}
          color={overallRoas >= 2 ? "bg-green-500" : overallRoas >= 1 ? "bg-yellow-500" : "bg-red-500"}
        />
        <KpiCard
          icon={Wallet}
          label="순이익 (원가 반영)"
          value={profit ? formatCurrency(profit.total_net_profit) : "-"}
          subtext={
            profit
              ? profit.is_profitable
                ? `ROI ${profit.overall_true_roi}% | ${profit.profitable_campaigns}/${profit.total_campaigns} 흑자`
                : `원가+광고비 > 매출 | 적자`
              : "로딩 중"
          }
          color={profit ? (profit.is_profitable ? "bg-emerald-600" : "bg-red-600") : "bg-gray-400"}
        />
        <KpiCard
          icon={MousePointerClick}
          label="클릭 / CTR"
          value={formatNumber(totalClicks)}
          subtext={`${totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0}% CTR`}
          color="bg-indigo-500"
        />
        <KpiCard
          icon={ShoppingCart}
          label="구매 / CPA"
          value={`${totalPurchases}건`}
          subtext={totalPurchases > 0 ? `CPA ${formatCurrency(avgCpa)}` : "구매 없음"}
          color="bg-purple-500"
        />
        <KpiCard
          icon={Eye}
          label="노출수"
          value={formatNumber(totalImpressions)}
          subtext="Total impressions"
          color="bg-gray-500"
        />
        {profit && profit.total_cogs > 0 && (
          <KpiCard
            icon={DollarSign}
            label="원가 합계 (COGS)"
            value={formatCurrency(profit.total_cogs)}
            subtext={`매출 대비 ${profit.total_revenue > 0 ? ((profit.total_cogs / profit.total_revenue) * 100).toFixed(0) : 0}%`}
            color="bg-orange-500"
          />
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Campaign Performance Comparison</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="CTR" fill="#10B981" name="CTR %" />
              <Bar dataKey="ROAS" fill="#6366F1" name="ROAS x" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Spend Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                outerRadius={90}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {pieData.map((_entry, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

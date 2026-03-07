// ROAS/CTR/CPA 일별 추이 차트 — 캠페인별 성과 트렌드 시각화
import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend,
} from "recharts";
import { Loader2, TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import {
  Campaign,
  CampaignTrend,
  CampaignSnapshot,
  fetchCampaignTrend,
  ImprovementEntry,
  fetchImprovementHistory,
} from "../lib/api";
import { formatCurrency } from "../lib/utils";

interface Props {
  campaigns: Campaign[];
}

type MetricKey = "roas" | "ctr" | "cpc" | "cpa" | "spend" | "revenue";

const METRIC_CONFIG: Record<MetricKey, { label: string; color: string; suffix: string; format: (v: number) => string }> = {
  roas: { label: "ROAS", color: "#6366F1", suffix: "x", format: (v) => `${v.toFixed(2)}x` },
  ctr: { label: "CTR", color: "#10B981", suffix: "%", format: (v) => `${v.toFixed(2)}%` },
  cpc: { label: "CPC", color: "#F59E0B", suffix: "", format: (v) => formatCurrency(v) },
  cpa: { label: "CPA", color: "#EF4444", suffix: "", format: (v) => formatCurrency(v) },
  spend: { label: "Spend", color: "#8B5CF6", suffix: "", format: (v) => formatCurrency(v) },
  revenue: { label: "Revenue", color: "#06B6D4", suffix: "", format: (v) => formatCurrency(v) },
};

function TrendBadge({ trend, change }: { trend: string; change: number | null }) {
  if (!change) {
    return <span className="text-xs text-gray-400">-</span>;
  }

  const isPositive = change > 0;
  const icon = trend === "improving"
    ? <TrendingUp className="w-3 h-3" />
    : trend === "declining"
      ? <TrendingDown className="w-3 h-3" />
      : <Minus className="w-3 h-3" />;

  const color = trend === "improving"
    ? "text-green-600 bg-green-50"
    : trend === "declining"
      ? "text-red-600 bg-red-50"
      : "text-gray-600 bg-gray-50";

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {icon}
      {isPositive ? "+" : ""}{change.toFixed(1)}%
    </span>
  );
}

function CampaignTrendCard({ campaign }: { campaign: Campaign }) {
  const [trendData, setTrendData] = useState<CampaignTrend | null>(null);
  const [improvements, setImprovements] = useState<ImprovementEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [metric, setMetric] = useState<MetricKey>("roas");

  const loadTrend = async () => {
    if (trendData) return; // 이미 로드됨
    setLoading(true);
    try {
      const [trend, impHistory] = await Promise.all([
        fetchCampaignTrend(campaign.id),
        fetchImprovementHistory(campaign.id).catch(() => ({ improvements: [] })),
      ]);
      setTrendData(trend);
      setImprovements(impHistory.improvements || []);
    } catch {
      // 트렌드 데이터 없을 수 있음
    } finally {
      setLoading(false);
    }
  };

  const handleExpand = () => {
    if (!expanded) loadTrend();
    setExpanded(!expanded);
  };

  const config = METRIC_CONFIG[metric];
  const snapshots = trendData?.snapshots || [];

  // 차트 데이터 가공
  const chartData = snapshots.map((s: CampaignSnapshot) => ({
    date: s.snapshot_date.substring(5), // MM-DD
    fullDate: s.snapshot_date,
    value: s[metric] || 0,
  }));

  // 개선 조치 시점 표시를 위한 날짜 매핑
  const improvementDates = improvements.map((imp) => imp.created_at.substring(0, 10));

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={handleExpand}
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[250px]">
            {campaign.name}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-sm font-bold text-gray-700">{campaign.roas.toFixed(2)}x</span>
            <span className="text-[10px] text-gray-400 ml-1">ROAS</span>
          </div>
          {loading && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 bg-gray-50 space-y-3">
          {/* 변화 요약 */}
          {trendData && (
            <div className="flex items-center gap-4 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">추세:</span>
                <TrendBadge
                  trend={trendData.trend}
                  change={trendData.change_7d?.[metric === "roas" ? "roas" : metric === "ctr" ? "ctr" : metric === "cpc" ? "cpc" : metric === "cpa" ? "cpa" : metric === "spend" ? "spend" : "revenue"] ?? null}
                />
                <span className="text-[10px] text-gray-400">(7일)</span>
              </div>
              {trendData.change_30d && (
                <div className="flex items-center gap-1.5">
                  <TrendBadge
                    trend={trendData.trend}
                    change={trendData.change_30d?.[metric === "roas" ? "roas" : metric === "ctr" ? "ctr" : metric === "cpc" ? "cpc" : metric === "cpa" ? "cpa" : metric === "spend" ? "spend" : "revenue"] ?? null}
                  />
                  <span className="text-[10px] text-gray-400">(30일)</span>
                </div>
              )}
            </div>
          )}

          {/* 메트릭 선택 탭 */}
          <div className="flex gap-1 flex-wrap">
            {(Object.keys(METRIC_CONFIG) as MetricKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setMetric(key)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  metric === key
                    ? "bg-indigo-600 text-white font-medium"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-100"
                }`}
              >
                {METRIC_CONFIG[key].label}
              </button>
            ))}
          </div>

          {/* 라인 차트 */}
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ left: 5, right: 15, top: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(value: number) => [config.format(value), config.label]}
                  labelFormatter={(label: string) => `날짜: ${label}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={config.color}
                  strokeWidth={2}
                  dot={{ fill: config.color, r: 3 }}
                  activeDot={{ r: 5 }}
                  name={config.label}
                />
                {/* ROAS 1.0x 기준선 */}
                {metric === "roas" && (
                  <ReferenceLine y={1} stroke="#EF4444" strokeDasharray="5 5" label={{ value: "1x", fontSize: 10, fill: "#EF4444" }} />
                )}
                {/* 개선 조치 시점 마커 */}
                {improvementDates.map((date, idx) => {
                  const found = chartData.find((d) => d.fullDate === date);
                  if (!found) return null;
                  return (
                    <ReferenceLine
                      key={idx}
                      x={found.date}
                      stroke="#F59E0B"
                      strokeDasharray="3 3"
                      label={{ value: "Action", fontSize: 9, fill: "#F59E0B" }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          ) : chartData.length === 1 ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              스냅샷 1건 — 추세 차트에는 최소 2일 이상의 데이터가 필요합니다
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm">
              스냅샷 데이터가 없습니다. 매일 07:00에 자동 기록됩니다.
            </div>
          )}

          {/* 개선 조치 이력 */}
          {improvements.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1.5">개선 조치 이력</h4>
              <div className="space-y-1">
                {improvements.slice(0, 5).map((imp) => (
                  <div key={imp.id} className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-16">{imp.created_at.substring(5, 10)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      imp.result_verdict === "improved" ? "bg-green-100 text-green-700" :
                      imp.result_verdict === "worsened" ? "bg-red-100 text-red-700" :
                      imp.result_verdict === "unchanged" ? "bg-gray-100 text-gray-700" :
                      "bg-yellow-100 text-yellow-700"
                    }`}>
                      {imp.result_verdict || "측정중"}
                    </span>
                    <span className="text-gray-600 truncate">{imp.action_description}</span>
                    {imp.before_roas != null && imp.after_roas != null && (
                      <span className="text-gray-400">
                        ROAS {imp.before_roas.toFixed(2)}x &rarr; {imp.after_roas.toFixed(2)}x
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RoasTrendChart({ campaigns }: Props) {
  const activeCampaigns = campaigns.filter((c) => c.status === "active" && c.total_spend > 0);

  if (activeCampaigns.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-lg font-bold text-gray-900 mb-3">ROAS Trends</h2>
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">Active 캠페인이 없습니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">Performance Trends</h2>
        <span className="text-xs text-gray-400">매일 07:00 자동 기록 (campaign_snapshots)</span>
      </div>
      <div className="space-y-2">
        {activeCampaigns.map((c) => (
          <CampaignTrendCard key={c.id} campaign={c} />
        ))}
      </div>
    </div>
  );
}

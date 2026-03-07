// 캠페인 퍼널 시각화 — Click → Landing → View → Cart → Checkout → Purchase
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { CampaignJudgment, FunnelRates } from "../lib/api";
import { formatNumber, formatCurrency } from "../lib/utils";

interface Props {
  judgments: CampaignJudgment[];
}

interface FunnelStage {
  name: string;
  shortName: string;
  count: number;
  rate: number;
  isBottleneck: boolean;
}

const STAGE_COLORS = {
  normal: "#6366F1",
  bottleneck: "#EF4444",
  good: "#10B981",
};

function buildFunnelStages(
  funnel: CampaignJudgment["funnel"],
  rates: FunnelRates
): FunnelStage[] {
  const stages: FunnelStage[] = [
    { name: "Clicks", shortName: "Click", count: funnel.clicks, rate: 100, isBottleneck: false },
    { name: "Landing Page Views", shortName: "Landing", count: funnel.landing_page_views, rate: rates.click_to_landing, isBottleneck: false },
    { name: "Content Views", shortName: "View", count: funnel.content_views, rate: rates.landing_to_view, isBottleneck: false },
    { name: "Add to Cart", shortName: "Cart", count: funnel.add_to_cart, rate: rates.view_to_cart, isBottleneck: false },
    { name: "Initiate Checkout", shortName: "Checkout", count: funnel.initiate_checkout, rate: rates.cart_to_checkout, isBottleneck: false },
    { name: "Purchases", shortName: "Purchase", count: funnel.purchases, rate: rates.checkout_to_purchase, isBottleneck: false },
  ];

  // 병목 탐지: 각 스테이지 전환율에서 가장 급격한 하락 지점
  let minRate = Infinity;
  let minIdx = -1;
  for (let i = 1; i < stages.length; i++) {
    if (stages[i].rate > 0 && stages[i].rate < minRate && stages[i].count > 0) {
      minRate = stages[i].rate;
      minIdx = i;
    }
  }
  if (minIdx >= 0 && minRate < 50) {
    stages[minIdx].isBottleneck = true;
  }

  return stages;
}

function SingleFunnelChart({ judgment }: { judgment: CampaignJudgment }) {
  const [expanded, setExpanded] = useState(false);

  const hasFunnelData = judgment.funnel.clicks > 0;
  if (!hasFunnelData) return null;

  // 퍼널 전환율 계산
  const rates = judgment.funnel_diagnosis?.[0]?.funnel_rates;
  if (!rates) return null;

  const stages = buildFunnelStages(judgment.funnel, rates);
  const totalConversionRate = rates.click_to_purchase;

  // 바 차트 데이터 — 절대값 기준
  const barData = stages.map((s) => ({
    name: s.shortName,
    value: s.count,
    fill: s.isBottleneck ? STAGE_COLORS.bottleneck : STAGE_COLORS.normal,
  }));

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800 truncate max-w-[200px]">
            {judgment.campaign_name}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            totalConversionRate >= 2 ? "bg-green-100 text-green-800" :
            totalConversionRate >= 0.5 ? "bg-yellow-100 text-yellow-800" :
            "bg-red-100 text-red-800"
          }`}>
            Click→Purchase {totalConversionRate.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {judgment.funnel.purchases}건 구매 / {judgment.funnel.clicks}건 클릭
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 bg-gray-50 space-y-4">
          {/* 퍼널 바 차트 */}
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={65} />
              <Tooltip
                formatter={(value: number) => formatNumber(value)}
                labelStyle={{ fontWeight: "bold" }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {barData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* 스테이지별 전환율 표 */}
          <div className="grid grid-cols-5 gap-1 text-center">
            {stages.slice(1).map((stage, idx) => (
              <div
                key={idx}
                className={`p-2 rounded-lg ${
                  stage.isBottleneck ? "bg-red-50 border border-red-200" :
                  stage.rate >= 50 ? "bg-green-50 border border-green-200" :
                  "bg-white border border-gray-200"
                }`}
              >
                <div className="text-[10px] text-gray-500 mb-0.5">
                  {stages[idx].shortName} &rarr; {stage.shortName}
                </div>
                <div className={`text-sm font-bold ${
                  stage.isBottleneck ? "text-red-600" :
                  stage.rate >= 50 ? "text-green-600" :
                  "text-gray-700"
                }`}>
                  {stage.rate > 0 ? `${stage.rate.toFixed(1)}%` : "-"}
                </div>
                {stage.isBottleneck && (
                  <div className="flex items-center justify-center gap-0.5 mt-0.5">
                    <AlertTriangle className="w-3 h-3 text-red-500" />
                    <span className="text-[9px] text-red-600 font-medium">BOTTLENECK</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 퍼널 진단 메시지 */}
          {judgment.funnel_diagnosis && judgment.funnel_diagnosis.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase text-gray-500">퍼널 진단</h4>
              {judgment.funnel_diagnosis.map((diag, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 p-2 rounded text-xs ${
                    diag.severity === "critical" ? "bg-red-50 text-red-800" :
                    diag.severity === "warning" ? "bg-yellow-50 text-yellow-800" :
                    diag.severity === "good" ? "bg-green-50 text-green-800" :
                    "bg-blue-50 text-blue-800"
                  }`}
                >
                  <span className="font-semibold whitespace-nowrap">[{diag.stage}]</span>
                  <span>{diag.diagnosis}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 전체 퍼널 요약 (모든 캠페인 합산) ───
function OverallFunnelSummary({ judgments }: { judgments: CampaignJudgment[] }) {
  const totals = judgments.reduce(
    (acc, j) => {
      acc.clicks += j.funnel.clicks;
      acc.landing += j.funnel.landing_page_views;
      acc.views += j.funnel.content_views;
      acc.cart += j.funnel.add_to_cart;
      acc.checkout += j.funnel.initiate_checkout;
      acc.purchase += j.funnel.purchases;
      acc.spend += j.metrics.spend;
      acc.revenue += j.metrics.revenue;
      return acc;
    },
    { clicks: 0, landing: 0, views: 0, cart: 0, checkout: 0, purchase: 0, spend: 0, revenue: 0 }
  );

  if (totals.clicks === 0) return null;

  const stages = [
    { label: "Click", value: totals.clicks, pct: 100 },
    { label: "Landing", value: totals.landing, pct: totals.clicks > 0 ? (totals.landing / totals.clicks) * 100 : 0 },
    { label: "View", value: totals.views, pct: totals.landing > 0 ? (totals.views / totals.landing) * 100 : 0 },
    { label: "Cart", value: totals.cart, pct: totals.views > 0 ? (totals.cart / totals.views) * 100 : 0 },
    { label: "Checkout", value: totals.checkout, pct: totals.cart > 0 ? (totals.checkout / totals.cart) * 100 : 0 },
    { label: "Purchase", value: totals.purchase, pct: totals.checkout > 0 ? (totals.purchase / totals.checkout) * 100 : 0 },
  ];

  const overallConversion = totals.clicks > 0 ? (totals.purchase / totals.clicks) * 100 : 0;

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-gray-900">
          전체 퍼널 요약 ({judgments.length}개 캠페인)
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500">
            광고비 {formatCurrency(totals.spend)} &rarr; 매출 {formatCurrency(totals.revenue)}
          </span>
          <span className={`font-bold ${overallConversion >= 1 ? "text-green-600" : "text-red-600"}`}>
            전체 전환율 {overallConversion.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* 시각적 퍼널 바 */}
      <div className="flex items-end gap-1 h-20">
        {stages.map((s, idx) => {
          const maxCount = stages[0].value;
          const height = maxCount > 0 ? Math.max((s.value / maxCount) * 100, 5) : 5;
          return (
            <div key={idx} className="flex-1 flex flex-col items-center">
              <div className="text-[10px] text-gray-500 font-medium mb-1">
                {formatNumber(s.value)}
              </div>
              <div
                className="w-full rounded-t transition-all duration-300"
                style={{
                  height: `${height}%`,
                  backgroundColor: idx === 0 ? "#6366F1" : `rgba(99, 102, 241, ${1 - idx * 0.15})`,
                  minHeight: "4px",
                }}
              />
              <div className="text-[10px] text-gray-600 mt-1 font-medium">{s.label}</div>
              {idx > 0 && (
                <div className={`text-[9px] font-bold ${s.pct >= 50 ? "text-green-600" : s.pct >= 20 ? "text-yellow-600" : "text-red-600"}`}>
                  {s.pct.toFixed(0)}%
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FunnelChart({ judgments }: Props) {
  const activeJudgments = judgments.filter((j) => j.metrics.spend > 0 && j.funnel.clicks > 0);

  if (activeJudgments.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Conversion Funnel</h2>
        <div className="text-center py-8 text-gray-400">
          <p className="text-sm">먼저 "자동 판단 실행"을 클릭하면 퍼널 데이터가 표시됩니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Conversion Funnel</h2>
      <OverallFunnelSummary judgments={activeJudgments} />
      <div className="space-y-2">
        {activeJudgments.map((j, idx) => (
          <SingleFunnelChart key={idx} judgment={j} />
        ))}
      </div>
    </div>
  );
}

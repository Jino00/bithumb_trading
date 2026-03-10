// 캠페인 포스트모템 분석 UI — 일시정지 캠페인의 전 factor 시간별 리뷰 + 학습 교훈
import { useState } from "react";
import {
  FileSearch,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  BookOpen,
  BarChart3,
} from "lucide-react";
import {
  generatePostMortemReport,
  CampaignPostMortem,
  PostMortemSummary,
  PostMortemLesson,
  PostMortemReport,
  FactorDetail,
} from "../lib/api";

const ROOT_CAUSE_LABELS: Record<string, string> = {
  roas_low: "ROAS 저조",
  zero_purchases: "구매 0건",
  frequency_fatigue: "소재 피로",
  roas_low_cpc_high: "ROAS↓ CPC↑",
  cpc_high: "CPC 과다",
  unknown: "기타",
};

const VERDICT_COLORS: Record<string, string> = {
  good: "bg-green-100 text-green-800",
  moderate: "bg-yellow-100 text-yellow-800",
  warning: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
  unknown: "bg-gray-100 text-gray-600",
};

const TREND_ICONS: Record<string, typeof TrendingUp> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export default function PostMortem() {
  const [report, setReport] = useState<PostMortemReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await generatePostMortemReport();
      setReport(data);
      // 첫 번째 카드 자동 펼치기
      if (data.postMortems.length > 0) {
        setExpandedCards(new Set([data.postMortems[0].campaign.meta_campaign_id]));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "포스트모템 생성 실패");
    } finally {
      setLoading(false);
    }
  };

  const toggleCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileSearch className="w-6 h-6 text-indigo-600" />
            Campaign Post-Mortem
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            일시정지 캠페인의 모든 factor를 시간별로 분석하고 학습 자산화
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
          {loading ? "분석 중..." : "포스트모템 생성"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {report && (
        <>
          {/* 요약 헤더 */}
          {report.summary && <SummaryHeader summary={report.summary} />}

          {/* 개별 캠페인 카드 */}
          <div className="space-y-4">
            {report.postMortems.map(pm => (
              <CampaignCard
                key={pm.campaign.meta_campaign_id}
                pm={pm}
                expanded={expandedCards.has(pm.campaign.meta_campaign_id)}
                onToggle={() => toggleCard(pm.campaign.meta_campaign_id)}
              />
            ))}
          </div>

          {/* 학습 교훈 */}
          {report.lessons.length > 0 && <LessonsSection lessons={report.lessons} />}
        </>
      )}

      {!report && !loading && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <FileSearch className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">포스트모템 생성 버튼을 클릭하면 일시정지된 캠페인을 분석합니다</p>
        </div>
      )}
    </div>
  );
}

// ─── 요약 헤더 ───
function SummaryHeader({ summary }: { summary: PostMortemSummary }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">크로스캠페인 요약</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatCard label="분석 캠페인" value={`${summary.campaign_count}개`} />
        <StatCard label="7일 총 소진" value={`₩${formatNumber(summary.total_spend_7d)}`} />
        <StatCard label="7일 총 매출" value={`₩${formatNumber(summary.total_revenue_7d)}`} />
        <StatCard
          label="전체 ROAS"
          value={`${summary.overall_roas_7d}x`}
          color={summary.overall_roas_7d >= 1.5 ? "text-green-600" : "text-red-600"}
        />
      </div>

      {/* 근본원인 분포 */}
      <div className="flex flex-wrap gap-2 mb-3">
        {Object.entries(summary.root_cause_distribution).map(([rc, count]) => (
          <span key={rc} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">
            {ROOT_CAUSE_LABELS[rc] || rc}: {count}개
          </span>
        ))}
      </div>

      {/* 공통 약점 */}
      {summary.common_weaknesses.length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-xs font-semibold text-gray-500 mb-2">공통 약점</p>
          <div className="space-y-1">
            {summary.common_weaknesses.map((cw, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                <AlertTriangle className="w-3 h-3 text-orange-500 shrink-0" />
                {cw.weakness} ({cw.campaign_count}개 캠페인)
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 캠페인 카드 ───
function CampaignCard({ pm, expanded, onToggle }: {
  pm: CampaignPostMortem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rcLabel = ROOT_CAUSE_LABELS[pm.campaign.root_cause] || pm.campaign.root_cause;

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      {/* 카드 헤더 */}
      <button onClick={onToggle} className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{pm.campaign.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500">{pm.campaign.pause_date?.split("T")[0]}</span>
              <span className="px-2 py-0.5 bg-red-50 text-red-700 text-xs font-medium rounded-full">{rcLabel}</span>
              {pm.campaign.score > 0 && (
                <span className="text-xs text-gray-400">점수: {pm.campaign.score}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* 미니 메트릭 */}
          <div className="hidden md:flex items-center gap-4 text-xs text-gray-500">
            <span>ROAS <strong className={pm.factor_analysis.roas?.avg >= 1.5 ? "text-green-600" : "text-red-600"}>{pm.factor_analysis.roas?.avg || 0}x</strong></span>
            <span>CTR <strong>{pm.factor_analysis.ctr?.avg || 0}%</strong></span>
            <span>CPC <strong>₩{formatNumber(pm.factor_analysis.cpc?.avg || 0)}</strong></span>
          </div>
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </div>
      </button>

      {/* 펼침 영역 */}
      {expanded && (
        <div className="border-t px-4 pb-4 space-y-5">
          {/* Factor 분석 그리드 */}
          <div className="pt-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Factor 분석 (7일)</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(["roas", "ctr", "cpc", "frequency"] as const).map(metric => {
                const data = pm.factor_analysis[metric] as FactorDetail | undefined;
                if (!data) return null;
                return <FactorCard key={metric} metric={metric} data={data} />;
              })}
            </div>
          </div>

          {/* 스파크라인 — 일별 추이 */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">일별 추이</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(["roas", "ctr", "cpc", "frequency"] as const).map(metric => {
                const data = pm.factor_analysis[metric] as FactorDetail | undefined;
                if (!data?.daily_values?.length) return null;
                return <SparklineRow key={metric} metric={metric} values={data.daily_values} />;
              })}
            </div>
          </div>

          {/* 퍼널 분석 */}
          {pm.funnel_analysis && <FunnelBreakdown funnel={pm.funnel_analysis} />}

          {/* 평가 (강점/약점/놓친 신호) */}
          <AssessmentSection assessment={pm.assessment} />

          {/* 리커버리 플랜 */}
          <RecoveryPlanSection plan={pm.recovery_plan} />
        </div>
      )}
    </div>
  );
}

// ─── Factor 카드 ───
function FactorCard({ metric, data }: { metric: string; data: FactorDetail }) {
  const TrendIcon = TREND_ICONS[data.trend] || Minus;
  const verdictClass = VERDICT_COLORS[data.verdict] || VERDICT_COLORS.unknown;
  const labels: Record<string, string> = { roas: "ROAS", ctr: "CTR (%)", cpc: "CPC (₩)", frequency: "Frequency" };

  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500">{labels[metric] || metric}</span>
        <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${verdictClass}`}>
          {data.verdict}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold text-gray-900">
          {metric === "cpc" ? `₩${formatNumber(data.current)}` : data.current}
        </span>
        <TrendIcon className={`w-3.5 h-3.5 ${data.trend === "up" ? "text-green-500" : data.trend === "down" ? "text-red-500" : "text-gray-400"}`} />
      </div>
      <div className="text-[10px] text-gray-400 mt-1">
        avg {metric === "cpc" ? `₩${formatNumber(data.avg)}` : data.avg} | min {metric === "cpc" ? `₩${formatNumber(data.min)}` : data.min} ~ max {metric === "cpc" ? `₩${formatNumber(data.max)}` : data.max}
      </div>
    </div>
  );
}

// ─── 스파크라인 행 (텍스트 기반 미니 차트) ───
function SparklineRow({ metric, values }: { metric: string; values: Array<{ date: string; value: number }> }) {
  const labels: Record<string, string> = { roas: "ROAS", ctr: "CTR", cpc: "CPC", frequency: "Freq" };
  const maxVal = Math.max(...values.map(v => v.value), 0.01);

  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <span className="text-xs font-medium text-gray-500 mb-2 block">{labels[metric] || metric}</span>
      <div className="flex items-end gap-1 h-10">
        {values.map((v, i) => {
          const height = Math.max((v.value / maxVal) * 100, 4);
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className="w-full bg-indigo-400 rounded-sm min-h-[2px]"
                style={{ height: `${height}%` }}
                title={`${v.date}: ${metric === "cpc" ? `₩${formatNumber(v.value)}` : v.value}`}
              />
              <span className="text-[8px] text-gray-400">{v.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 퍼널 분석 ───
function FunnelBreakdown({ funnel }: { funnel: CampaignPostMortem["funnel_analysis"] }) {
  if (!funnel) return null;
  const stageLabels: Record<string, string> = {
    impressions: "노출",
    clicks: "클릭",
    landing_page_views: "랜딩",
    content_views: "콘텐츠 뷰",
    add_to_cart: "장바구니",
    initiate_checkout: "결제시작",
    purchases: "구매",
  };

  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">퍼널 분석</h4>
      <div className="bg-gray-50 rounded-lg p-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {funnel.stages.map((s, i) => (
            <div key={s.name} className="flex items-center shrink-0">
              <div className={`text-center px-2 py-1 rounded ${s.name === funnel.bottleneck ? "bg-red-100 ring-1 ring-red-300" : ""}`}>
                <div className="text-[10px] text-gray-500">{stageLabels[s.name] || s.name}</div>
                <div className="text-sm font-bold text-gray-900">{formatNumber(s.count)}</div>
                {s.conversion_rate != null && (
                  <div className={`text-[10px] font-medium ${s.conversion_rate < 1 ? "text-red-500" : "text-green-600"}`}>
                    {s.conversion_rate}%
                  </div>
                )}
              </div>
              {i < funnel.stages.length - 1 && <span className="text-gray-300 mx-0.5">→</span>}
            </div>
          ))}
        </div>
        {funnel.bottleneck && (
          <div className="mt-2 flex items-center gap-1 text-xs text-red-600">
            <AlertTriangle className="w-3 h-3" />
            병목: {stageLabels[funnel.bottleneck] || funnel.bottleneck} 단계
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 평가 섹션 ───
function AssessmentSection({ assessment }: { assessment: CampaignPostMortem["assessment"] }) {
  if (!assessment) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <AssessmentList title="강점" items={assessment.strengths} icon={<CheckCircle className="w-3 h-3 text-green-500" />} />
      <AssessmentList title="약점" items={assessment.weaknesses} icon={<XCircle className="w-3 h-3 text-red-500" />} />
      <AssessmentList title="놓친 신호" items={assessment.missed_signals} icon={<AlertTriangle className="w-3 h-3 text-yellow-500" />} />
    </div>
  );
}

function AssessmentList({ title, items, icon }: { title: string; items: string[]; icon: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <h5 className="text-xs font-semibold text-gray-600 mb-2">{title}</h5>
      {items.length === 0 ? (
        <p className="text-[10px] text-gray-400">없음</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-gray-700">
              <span className="mt-0.5 shrink-0">{icon}</span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── 리커버리 플랜 ───
function RecoveryPlanSection({ plan }: { plan: CampaignPostMortem["recovery_plan"] }) {
  if (!plan) return null;
  const statusLabels: Record<string, string> = {
    cooling: "쿨링 대기",
    attempt_1: "1차 시도",
    attempt_2: "2차 시도",
    resolved: "해결됨",
    failed: "실패",
  };

  return (
    <div className="bg-indigo-50 rounded-lg p-3">
      <h5 className="text-xs font-semibold text-indigo-700 mb-2">리커버리 플랜</h5>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div>
          <span className="text-gray-500">상태</span>
          <p className="font-medium text-gray-900">{statusLabels[plan.status] || plan.status}</p>
        </div>
        <div>
          <span className="text-gray-500">쿨링</span>
          <p className="font-medium text-gray-900">{plan.cooling_days > 0 ? `${plan.cooling_days}일` : "수동"}</p>
        </div>
        <div>
          <span className="text-gray-500">재개 예정</span>
          <p className="font-medium text-gray-900">{plan.resume_date || "-"}</p>
        </div>
        <div>
          <span className="text-gray-500">시도</span>
          <p className="font-medium text-gray-900">{plan.attempt_count}/{plan.max_attempts}</p>
        </div>
      </div>
      {plan.strategies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {plan.strategies.map((s, i) => (
            <span key={i} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] rounded-full">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 학습 교훈 섹션 ───
function LessonsSection({ lessons }: { lessons: PostMortemLesson[] }) {
  const confidenceColors: Record<string, string> = {
    high: "bg-green-100 text-green-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4 text-indigo-500" />
        학습 교훈 ({lessons.length}건)
      </h3>
      <div className="space-y-2">
        {lessons.map((l, i) => (
          <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
            <span className={`shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded ${confidenceColors[l.confidence] || confidenceColors.low}`}>
              {l.confidence}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-gray-700">{l.description}</p>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                <span>{ROOT_CAUSE_LABELS[l.root_cause] || l.root_cause}</span>
                <span>·</span>
                <span>{l.lesson_type}</span>
                <span>·</span>
                <span>{l.campaign_count}개 캠페인</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 공통 헬퍼 ───

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <p className={`text-lg font-bold ${color || "text-gray-900"}`}>{value}</p>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(n % 1 === 0 ? 0 : 2);
}

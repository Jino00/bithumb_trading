// AI 추천 패널 — 규칙 기반 자동 판단 + Claude AI 분석
import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle, XCircle, Lightbulb, Copy, Zap, TrendingUp, TrendingDown } from "lucide-react";
import { AnalysisResult, CampaignJudgment, JudgeSummary } from "../lib/api";
import { getVerdictColor, formatCurrency } from "../lib/utils";

interface Props {
  results: AnalysisResult[];
  loading: boolean;
  onAnalyzeAll: () => void;
  judgments?: CampaignJudgment[];
  judgeSummary?: JudgeSummary | null;
  judgingLoading?: boolean;
  onJudgeAll?: () => void;
}

function FixTypeBadge({ fixType }: { fixType: string | null }) {
  if (!fixType) return null;
  const colors: Record<string, string> = {
    COPY_ONLY: "bg-blue-100 text-blue-800",
    CREATIVE_REFRESH: "bg-purple-100 text-purple-800",
    FULL_OVERHAUL: "bg-orange-100 text-orange-800",
    PAUSE: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[fixType] || "bg-gray-100 text-gray-800"}`}>
      {fixType.replace("_", " ")}
    </span>
  );
}

function VerdictEmoji({ verdict }: { verdict: string }) {
  const map: Record<string, string> = { SCALE: "🟢", MAINTAIN: "🟡", MODIFY: "🟠", PAUSE: "🔴" };
  return <span className="text-lg">{map[verdict] || "⚪"}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    excellent: "bg-green-100 text-green-800",
    good: "bg-blue-100 text-blue-800",
    warning: "bg-yellow-100 text-yellow-800",
    urgent: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[severity] || "bg-gray-100 text-gray-800"}`}>
      {severity}
    </span>
  );
}

// ─── 자동 판단 결과 카드 ───
function JudgmentCard({ judgment }: { judgment: CampaignJudgment }) {
  const [expanded, setExpanded] = useState(false);
  const m = judgment.metrics;

  return (
    <div className={`border rounded-lg overflow-hidden ${getVerdictColor(judgment.verdict)}`}>
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:opacity-90"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <VerdictEmoji verdict={judgment.verdict} />
          <div>
            <h3 className="font-semibold text-sm">{judgment.campaign_name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getVerdictColor(judgment.verdict)}`}>
                {judgment.verdict}
              </span>
              <SeverityBadge severity={judgment.severity} />
              <span className="text-xs text-gray-500">점수: {judgment.score}/100</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="text-right">
            <div className="font-bold">{m.roas.toFixed(2)}x</div>
            <div className="text-xs text-gray-500">ROAS</div>
          </div>
          <div className="text-right">
            <div className="font-medium">{formatCurrency(m.revenue)}</div>
            <div className="text-xs text-gray-500">매출</div>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 bg-white bg-opacity-50">
          {/* KPI 요약 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-gray-50 p-2 rounded text-center">
              <div className="text-xs text-gray-500">광고비</div>
              <div className="text-sm font-medium">{formatCurrency(m.spend)}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded text-center">
              <div className="text-xs text-gray-500">매출</div>
              <div className="text-sm font-medium">{formatCurrency(m.revenue)}</div>
            </div>
            <div className="bg-gray-50 p-2 rounded text-center">
              <div className="text-xs text-gray-500">구매</div>
              <div className="text-sm font-medium">{m.purchases}건</div>
            </div>
            <div className="bg-gray-50 p-2 rounded text-center">
              <div className="text-xs text-gray-500">CPA</div>
              <div className="text-sm font-medium">{m.cpa > 0 ? formatCurrency(m.cpa) : "-"}</div>
            </div>
          </div>

          {/* 판단 근거 */}
          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">판단 근거</h4>
            <ul className="space-y-1">
              {judgment.reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-gray-400 mt-0.5">•</span>
                  {reason}
                </li>
              ))}
            </ul>
          </div>

          {/* 개선 제안 */}
          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">개선 제안</h4>
            <ul className="space-y-1">
              {judgment.recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <Lightbulb className="w-3 h-3 mt-1 flex-shrink-0 text-yellow-500" />
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 전체 요약 카드 ───
function JudgeSummaryCard({ summary }: { summary: JudgeSummary }) {
  const vd = summary.verdict_distribution;
  return (
    <div className="bg-gradient-to-r from-gray-50 to-blue-50 border border-blue-100 rounded-lg p-4 mb-4">
      <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
        {summary.is_profitable ? <TrendingUp className="w-4 h-4 text-green-600" /> : <TrendingDown className="w-4 h-4 text-red-600" />}
        전체 캠페인 성과 요약
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-500">전체 ROAS</div>
          <div className={`text-lg font-bold ${summary.overall_roas >= 1 ? "text-green-600" : "text-red-600"}`}>
            {summary.overall_roas}x
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">손익</div>
          <div className={`text-lg font-bold ${summary.is_profitable ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(summary.profit_loss)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">총 구매</div>
          <div className="text-lg font-bold text-gray-900">{summary.total_purchases}건</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">평균 CPA</div>
          <div className="text-lg font-bold text-gray-900">{summary.avg_cpa > 0 ? formatCurrency(summary.avg_cpa) : "-"}</div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1">🟢 SCALE <b>{vd.SCALE}</b></span>
        <span className="flex items-center gap-1">🟡 MAINTAIN <b>{vd.MAINTAIN}</b></span>
        <span className="flex items-center gap-1">🟠 MODIFY <b>{vd.MODIFY}</b></span>
        <span className="flex items-center gap-1">🔴 PAUSE <b>{vd.PAUSE}</b></span>
      </div>
    </div>
  );
}

// ─── Claude AI 분석 결과 카드 (기존) ───
function RecommendationCard({ result }: { result: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const verdictIcon =
    result.verdict === "MAINTAIN" || result.verdict === "SCALE" ? <CheckCircle className="w-5 h-5 text-green-600" /> :
    result.verdict === "PAUSE" ? <XCircle className="w-5 h-5 text-red-600" /> :
    <AlertTriangle className="w-5 h-5 text-yellow-600" />;

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${getVerdictColor(result.verdict)}`}>
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:opacity-90"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {verdictIcon}
          <div>
            <h3 className="font-semibold text-sm">{result.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getVerdictColor(result.verdict)}`}>
                {result.verdict}
              </span>
              <FixTypeBadge fixType={result.fix_type} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs opacity-75">{result.estimated_improvement}</span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 bg-white bg-opacity-50">
          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">Analysis</h4>
            <p className="text-sm text-gray-700">{result.reasoning}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">Action Items</h4>
            <ul className="space-y-1">
              {result.action_items.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <Lightbulb className="w-3 h-3 mt-1 flex-shrink-0 text-yellow-500" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {result.copy_alternatives && result.copy_alternatives.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-gray-500 mb-1">Alternative Copy Suggestions</h4>
              <div className="space-y-2">
                {result.copy_alternatives.map((alt, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-blue-50 rounded border border-blue-100">
                    <span className="text-xs font-bold text-blue-600 mt-0.5">#{i + 1}</span>
                    <p className="text-sm text-gray-700 flex-1">{alt}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleCopy(alt, i); }}
                      className="p-1 text-gray-400 hover:text-blue-600 flex-shrink-0"
                      title="Copy to clipboard"
                    >
                      {copiedIdx === i ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
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

export default function AIRecommendations({ results, loading, onAnalyzeAll, judgments, judgeSummary, judgingLoading, onJudgeAll }: Props) {
  const [activeTab, setActiveTab] = useState<"judge" | "ai">("judge");

  // 지출 > 0인 판단만 표시 (비활성 캠페인 제외)
  const activeJudgments = (judgments || []).filter(j => j.metrics.spend > 0);

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">캠페인 판단 & 추천</h2>
        <div className="flex items-center gap-2">
          {/* 탭 토글 */}
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 mr-2">
            <button
              onClick={() => setActiveTab("judge")}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === "judge" ? "bg-orange-500 text-white font-medium" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Zap className="w-3 h-3 inline mr-1" />자동 판단
            </button>
            <button
              onClick={() => setActiveTab("ai")}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === "ai" ? "bg-blue-600 text-white font-medium" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              AI 분석
            </button>
          </div>

          {activeTab === "judge" && onJudgeAll && (
            <button
              onClick={onJudgeAll}
              disabled={judgingLoading}
              className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {judgingLoading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  판단 중...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  자동 판단 실행
                </span>
              )}
            </button>
          )}

          {activeTab === "ai" && (
            <button
              onClick={onAnalyzeAll}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Analyzing...
                </span>
              ) : (
                "AI 분석 실행"
              )}
            </button>
          )}
        </div>
      </div>

      {/* 자동 판단 탭 */}
      {activeTab === "judge" && (
        <>
          {judgeSummary && <JudgeSummaryCard summary={judgeSummary} />}
          {activeJudgments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Zap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">"자동 판단 실행"을 클릭하면 ROAS 기반으로 캠페인을 즉시 평가합니다</p>
              <p className="text-xs text-gray-400 mt-1">AI 비용 없이 규칙 기반으로 즉시 실행됩니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeJudgments.map((j, idx) => (
                <JudgmentCard key={idx} judgment={j} />
              ))}
            </div>
          )}
        </>
      )}

      {/* AI 분석 탭 (기존) */}
      {activeTab === "ai" && (
        <>
          {results.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Lightbulb className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">"AI 분석 실행"을 클릭하면 Claude AI가 심층 분석합니다</p>
              <p className="text-xs text-gray-400 mt-1">API 비용이 발생합니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {results.map((r) => (
                <RecommendationCard key={r.id} result={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

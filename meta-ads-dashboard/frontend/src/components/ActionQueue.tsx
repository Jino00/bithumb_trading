// 일일 리뷰 액션 큐 — 승인/거부/실행 UI + 진단 상세 + 학습 현황
import { useState, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Zap,
  ChevronDown,
  ChevronUp,
  Target,
  Paintbrush,
  Brain,
  Search,
  Lightbulb,
  BarChart3,
  DollarSign,
} from "lucide-react";
import {
  ActionQueueItem,
  FunnelDiagnosis,
  EarlySignalData,
  EarlySignalItem,
  ReviewRun,
  LearningStatus,
  ImprovementResult,
  fetchPendingActions,
  fetchAllActions,
  fetchReviewRuns,
  approveAction,
  rejectAction,
  approveAllActions,
  executeAction,
  completeManualAction,
  executeAllActions,
  triggerDailyReview,
  fetchLearningStatus,
  fetchImprovementResult,
} from "../lib/api";

const ACTION_ICONS: Record<string, typeof Pause> = {
  pause: Pause,
  resume: Play,
  budget_increase: TrendingUp,
  budget_decrease: TrendingDown,
  targeting_broaden: Target,
  creative_refresh: Paintbrush,
  early_warning: AlertTriangle,
  early_kill: XCircle,
};

const ACTION_LABELS: Record<string, string> = {
  pause: "일시정지",
  resume: "재개",
  budget_increase: "예산 증액",
  budget_decrease: "예산 감축",
  targeting_broaden: "Broad 타겟 전환",
  creative_refresh: "소재 교체 필요",
  early_warning: "🔮 조기 경고",
  early_kill: "💀 조기 중단 권장",
};

const ACTION_COLORS: Record<string, string> = {
  pause: "text-red-600 bg-red-50",
  resume: "text-green-600 bg-green-50",
  budget_increase: "text-blue-600 bg-blue-50",
  budget_decrease: "text-orange-600 bg-orange-50",
  targeting_broaden: "text-purple-600 bg-purple-50",
  creative_refresh: "text-pink-600 bg-pink-50",
  early_warning: "text-amber-600 bg-amber-50",
  early_kill: "text-red-700 bg-red-50",
};

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  pending: { label: "승인 대기", color: "bg-yellow-100 text-yellow-800" },
  approved: { label: "승인됨", color: "bg-blue-100 text-blue-800" },
  rejected: { label: "거부됨", color: "bg-gray-100 text-gray-500" },
  executed: { label: "실행 완료", color: "bg-green-100 text-green-800" },
  failed: { label: "실행 실패", color: "bg-red-100 text-red-800" },
  manual_pending: { label: "수동 조치 대기", color: "bg-orange-100 text-orange-800" },
};

const VERDICT_COLORS: Record<string, string> = {
  SCALE: "text-green-700 bg-green-50",
  MAINTAIN: "text-blue-700 bg-blue-50",
  MODIFY: "text-yellow-700 bg-yellow-50",
  PAUSE: "text-red-700 bg-red-50",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-red-600",
  warning: "text-yellow-600",
  info: "text-blue-600",
  good: "text-green-600",
};

const SEVERITY_ICONS: Record<string, string> = {
  critical: "X",
  warning: "!",
  info: "i",
  good: "O",
};

export default function ActionQueue() {
  const [pendingActions, setPendingActions] = useState<ActionQueueItem[]>([]);
  const [recentActions, setRecentActions] = useState<ActionQueueItem[]>([]);
  const [runs, setRuns] = useState<ReviewRun[]>([]);
  const [learningStatus, setLearningStatus] = useState<LearningStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningReview, setRunningReview] = useState(false);
  const [executingAll, setExecutingAll] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showLearning, setShowLearning] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, recent, reviewRuns, learning] = await Promise.all([
        fetchPendingActions(),
        fetchAllActions(undefined, 50),
        fetchReviewRuns(10),
        fetchLearningStatus().catch(() => null),
      ]);
      setPendingActions(pending);
      setRecentActions(recent.filter((a) => a.status !== "pending"));
      setRuns(reviewRuns);
      setLearningStatus(learning);
    } catch (err) {
      console.error("Failed to load actions:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = async (id: number) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await approveAction(id);
      await executeAction(id);
      await loadData();
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleReject = async (id: number) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await rejectAction(id);
      await loadData();
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleApproveAll = async () => {
    setExecutingAll(true);
    try {
      await approveAllActions();
      await executeAllActions();
      await loadData();
    } catch (err) {
      console.error("Failed to approve all:", err);
    } finally {
      setExecutingAll(false);
    }
  };

  const handleExecute = async (id: number) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await executeAction(id);
      await loadData();
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleExecuteAll = async () => {
    setExecutingAll(true);
    try {
      await executeAllActions();
      await loadData();
    } finally {
      setExecutingAll(false);
    }
  };

  const handleCompleteManual = async (id: number) => {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await completeManualAction(id);
      await loadData();
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleRunReview = async () => {
    setRunningReview(true);
    try {
      await triggerDailyReview();
      await loadData();
    } finally {
      setRunningReview(false);
    }
  };

  const approvedCount = recentActions.filter((a) => a.status === "approved").length;
  const manualPendingActions = recentActions.filter((a) => a.status === "manual_pending");

  const formatCurrency = (value: string | number) => {
    const num = typeof value === "string" ? Number(value) : value;
    return `₩${num.toLocaleString()}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">로딩 중...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">일일 리뷰 & 액션</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            매일 09:00 자동 리뷰 · 진단 + 개선 방향 · 승인 후 Meta API 실행
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <RefreshCw className="w-4 h-4" /> 새로고침
          </button>
          <button
            onClick={handleRunReview}
            disabled={runningReview}
            className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {runningReview ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {runningReview ? "리뷰 중..." : "수동 리뷰 실행"}
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="승인 대기" value={pendingActions.length} color="yellow" />
        <SummaryCard label="승인됨 (미실행)" value={approvedCount} color="blue" />
        <SummaryCard label="최근 리뷰" value={runs.length > 0 ? runs[0].run_date : "-"} color="gray" />
        <SummaryCard
          label="총 리뷰 횟수"
          value={runs.length}
          color="green"
        />
      </div>

      {/* Pending 액션 */}
      {pendingActions.length > 0 && (
        <div className="bg-white rounded-xl border border-yellow-200 shadow-sm">
          <div className="flex items-center justify-between px-5 py-3 border-b border-yellow-100">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-600" />
              <h3 className="font-semibold text-gray-900">승인 대기 ({pendingActions.length}건)</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleApproveAll}
                disabled={executingAll}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {executingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {executingAll ? "실행 중..." : "전체 승인 & 실행"}
              </button>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {pendingActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                loading={actionLoading[action.id]}
                onApprove={handleApprove}
                onReject={handleReject}
                formatCurrency={formatCurrency}
              />
            ))}
          </div>
        </div>
      )}

      {/* 승인됨 (실행 대기) */}
      {approvedCount > 0 && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm">
          <div className="flex items-center justify-between px-5 py-3 border-b border-blue-100">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-blue-600" />
              <h3 className="font-semibold text-gray-900">승인됨 — 실행 대기 ({approvedCount}건)</h3>
            </div>
            <button
              onClick={handleExecuteAll}
              disabled={executingAll}
              className="flex items-center gap-1 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {executingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {executingAll ? "실행 중..." : "전체 실행"}
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {recentActions
              .filter((a) => a.status === "approved")
              .map((action) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  loading={actionLoading[action.id]}
                  onExecute={handleExecute}
                  formatCurrency={formatCurrency}
                />
              ))}
          </div>
        </div>
      )}

      {/* 수동 조치 대기 (creative_refresh 등) */}
      {manualPendingActions.length > 0 && (
        <div className="bg-white rounded-xl border border-orange-200 shadow-sm">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-orange-100">
            <Paintbrush className="w-5 h-5 text-orange-600" />
            <h3 className="font-semibold text-gray-900">수동 조치 대기 ({manualPendingActions.length}건)</h3>
            <span className="text-xs text-orange-600">소재 교체 후 &ldquo;수동 완료&rdquo; 버튼을 눌러주세요</span>
          </div>
          <div className="divide-y divide-gray-100">
            {manualPendingActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                loading={actionLoading[action.id]}
                onCompleteManual={handleCompleteManual}
                onExecute={handleExecute}
                formatCurrency={formatCurrency}
              />
            ))}
          </div>
        </div>
      )}

      {/* 변경 필요 없음 */}
      {pendingActions.length === 0 && approvedCount === 0 && manualPendingActions.length === 0 && (
        <div className="bg-white rounded-xl border border-green-200 shadow-sm p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <h3 className="font-semibold text-gray-900">변경 필요 없음</h3>
          <p className="text-sm text-gray-500 mt-1">모든 캠페인이 정상 운영 중입니다.</p>
        </div>
      )}

      {/* 학습 현황 */}
      {learningStatus && (
        <div className="bg-white rounded-xl border shadow-sm">
          <button
            onClick={() => setShowLearning(!showLearning)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50"
          >
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              <h3 className="font-semibold text-gray-900">학습 현황</h3>
              {learningStatus.maturity && (
                <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded">
                  {learningStatus.maturity.stage}
                </span>
              )}
              {learningStatus.pending_measurements > 0 && (
                <span className="text-xs px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded">
                  측정 대기 {learningStatus.pending_measurements}건
                </span>
              )}
            </div>
            {showLearning ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>
          {showLearning && (
            <div className="border-t px-5 py-4">
              {learningStatus.effectiveness.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b">
                        <th className="pb-2">액션 타입</th>
                        <th className="pb-2">진단 단계</th>
                        <th className="pb-2 text-center">실행</th>
                        <th className="pb-2 text-center">개선</th>
                        <th className="pb-2 text-center">성공률</th>
                        <th className="pb-2 text-right">ROAS 변화</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {learningStatus.effectiveness.map((e, i) => (
                        <tr key={i}>
                          <td className="py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[e.action_type] || "bg-gray-50 text-gray-600"}`}>
                              {ACTION_LABELS[e.action_type] || e.action_type}
                            </span>
                          </td>
                          <td className="py-2 text-gray-600">{e.diagnosis_stage}</td>
                          <td className="py-2 text-center text-gray-900">{e.times_applied}</td>
                          <td className="py-2 text-center text-green-600">{e.times_improved}</td>
                          <td className="py-2 text-center">
                            <span className={`font-medium ${e.success_rate >= 60 ? "text-green-600" : e.success_rate >= 40 ? "text-yellow-600" : "text-red-600"}`}>
                              {Math.round(e.success_rate)}%
                            </span>
                          </td>
                          <td className={`py-2 text-right font-medium ${e.avg_roas_change > 0 ? "text-green-600" : e.avg_roas_change < 0 ? "text-red-600" : "text-gray-500"}`}>
                            {e.avg_roas_change > 0 ? "+" : ""}{e.avg_roas_change.toFixed(2)}x
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">아직 학습 데이터가 없습니다. 액션을 실행하면 7일 후 자동으로 결과가 측정됩니다.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 실행 기록 */}
      <div className="bg-white rounded-xl border shadow-sm">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50"
        >
          <h3 className="font-semibold text-gray-900">실행 기록</h3>
          {showHistory ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>
        {showHistory && (
          <div className="border-t">
            {/* 리뷰 실행 기록 */}
            {runs.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {runs.map((run) => (
                  <div key={run.id} className="px-5 py-3 flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium text-gray-900">{run.run_date}</span>
                      <span className="text-gray-500 ml-2">
                        {run.total_campaigns}개 캠페인 리뷰
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-yellow-600">{run.actions_generated}건 생성</span>
                      <span className="text-blue-600">{run.actions_approved}건 승인</span>
                      <span className="text-green-600">{run.actions_executed}건 실행</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-gray-500">아직 리뷰 기록이 없습니다.</p>
            )}

            {/* 최근 처리된 액션들 */}
            {recentActions.filter((a) => a.status !== "approved").length > 0 && (
              <>
                <div className="px-5 py-2 bg-gray-50 border-t">
                  <span className="text-xs font-medium text-gray-500">최근 처리된 액션</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {recentActions
                    .filter((a) => a.status !== "approved")
                    .slice(0, 20)
                    .map((action) => (
                      <ActionCard
                        key={action.id}
                        action={action}
                        formatCurrency={formatCurrency}
                        compact
                      />
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    yellow: "bg-yellow-50 border-yellow-200",
    blue: "bg-blue-50 border-blue-200",
    green: "bg-green-50 border-green-200",
    gray: "bg-gray-50 border-gray-200",
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[color] || colors.gray}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
    </div>
  );
}

function ActionCard({
  action,
  loading,
  onApprove,
  onReject,
  onExecute,
  onCompleteManual,
  formatCurrency,
  compact,
}: {
  action: ActionQueueItem;
  loading?: boolean;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  onExecute?: (id: number) => void;
  onCompleteManual?: (id: number) => void;
  formatCurrency: (v: string | number) => string;
  compact?: boolean;
}) {
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const [improvement, setImprovement] = useState<ImprovementResult | null>(null);

  const Icon = ACTION_ICONS[action.action_type] || AlertTriangle;
  const label = ACTION_LABELS[action.action_type] || action.action_type;
  const colorClass = ACTION_COLORS[action.action_type] || "text-gray-600 bg-gray-50";
  const badge = STATUS_BADGES[action.status] || STATUS_BADGES.pending;
  const verdictColor = VERDICT_COLORS[action.verdict] || "";

  const hasDiagnosis = !!(
    action.recommendations_json ||
    action.funnel_diagnosis_json ||
    action.smart_recommendations_json ||
    action.benchmark_comparison_json ||
    action.profitability_json
  );

  const isManualRequired = action.action_type === "creative_refresh";
  const isEarlySignal = action.action_type === "early_warning" || action.action_type === "early_kill";
  const earlySignalData: EarlySignalData | null = isEarlySignal ? safeJsonParse<EarlySignalData | null>(action.early_signal_json, null) : null;

  // 실행 완료된 액션의 개선 결과 로드
  useEffect(() => {
    if ((action.status === "executed" || action.status === "manual_pending") && action.improvement_log_id && !compact) {
      fetchImprovementResult(action.id)
        .then(setImprovement)
        .catch(() => null);
    }
  }, [action.id, action.status, action.improvement_log_id, compact]);

  if (compact) {
    return (
      <div className="px-5 py-2 flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
            <Icon className="w-3 h-3" /> {label}
          </span>
          <span className="text-gray-700">{action.campaign_name}</span>
          {action.action_type === "early_warning" && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 font-medium">참고용</span>
          )}
          {earlySignalData && (
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
              earlySignalData.grade === "Promising" ? "bg-green-100 text-green-700" :
              earlySignalData.grade === "Watch" ? "bg-yellow-100 text-yellow-700" :
              earlySignalData.grade === "At Risk" ? "bg-red-100 text-red-700" :
              "bg-red-200 text-red-800"
            }`}>
              {earlySignalData.emoji} Score {earlySignalData.score}
            </span>
          )}
          {/* 개선 결과 배지 (compact) */}
          {action.status === "executed" && improvement && (
            <ImprovementBadge result={improvement} />
          )}
        </div>
        <span className={`px-2 py-0.5 rounded text-xs ${badge.color}`}>{badge.label}</span>
      </div>
    );
  }

  const isBudget = action.action_type === "budget_increase" || action.action_type === "budget_decrease";

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-lg flex-shrink-0 ${colorClass}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{label}</span>
              <span className="text-gray-400">|</span>
              <span className="text-gray-700">{action.campaign_name}</span>
              {isManualRequired && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700 font-medium">
                  수동 조치 필요
                </span>
              )}
              {action.action_type === "early_warning" && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 font-medium">
                  참고용
                </span>
              )}
              {earlySignalData && (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                  earlySignalData.grade === "Promising" ? "bg-green-100 text-green-700" :
                  earlySignalData.grade === "Watch" ? "bg-yellow-100 text-yellow-700" :
                  earlySignalData.grade === "At Risk" ? "bg-red-100 text-red-700" :
                  "bg-red-200 text-red-800"
                }`}>
                  {earlySignalData.emoji} Day {earlySignalData.dayCount} | Score {earlySignalData.score}
                </span>
              )}
              {/* 개선 결과 배지 */}
              {improvement && <ImprovementBadge result={improvement} />}
            </div>
            <p className="text-sm text-gray-500 mt-1">{action.reason}</p>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
              <span>📅 {action.created_at ? new Date(action.created_at + "Z").toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" }) : "날짜 없음"}</span>
              <span>·</span>
              <span>분석 기간: 최근 7일</span>
              {action.trend_direction === "improving" && (
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">📈 개선 중</span>
              )}
              {action.trend_direction === "declining" && (
                <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">📉 하락 중</span>
              )}
              {action.executed_at && (
                <>
                  <span>·</span>
                  <span>실행: {new Date(action.executed_at + "Z").toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
              {isBudget ? (
                <>
                  <span className="text-gray-500">현재: {formatCurrency(action.current_value)}/일</span>
                  <span className="text-gray-400">&rarr;</span>
                  <span className="font-medium text-gray-900">제안: {formatCurrency(action.proposed_value)}/일</span>
                </>
              ) : (
                <>
                  <span className="text-gray-500">현재: {action.current_value}</span>
                  <span className="text-gray-400">&rarr;</span>
                  <span className="font-medium text-gray-900">제안: {action.proposed_value}</span>
                </>
              )}
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${verdictColor}`}>
                {action.verdict} ({action.score}점)
              </span>
            </div>

            {/* 진단 상세 보기 토글 */}
            {hasDiagnosis && (
              <button
                onClick={() => setShowDiagnosis(!showDiagnosis)}
                className="flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-800"
              >
                <Search className="w-3 h-3" />
                {showDiagnosis ? "진단 상세 접기" : "진단 상세 보기"}
                {showDiagnosis ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}

            {/* Early Signal 바 차트 */}
            {earlySignalData && (
              <EarlySignalBadge data={earlySignalData} />
            )}

            {/* 진단 상세 패널 */}
            {showDiagnosis && hasDiagnosis && (
              <DiagnosisPanel action={action} formatCurrency={formatCurrency} />
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {action.status === "pending" && action.action_type === "early_warning" && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-600">참고 전용</span>
          )}
          {action.status === "pending" && action.action_type !== "early_warning" && onApprove && onReject && (
            <>
              <button
                onClick={() => onApprove(action.id)}
                disabled={loading}
                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Play className="w-4 h-4" /> 승인 & 실행
              </button>
              <button
                onClick={() => onReject(action.id)}
                disabled={loading}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" /> 거부
              </button>
            </>
          )}
          {action.status === "approved" && onExecute && (
            <button
              onClick={() => onExecute(action.id)}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Play className="w-4 h-4" /> {isManualRequired ? "학습 추적 시작" : "실행"}
            </button>
          )}
          {action.status === "manual_pending" && onExecute && (
            <button
              onClick={() => onCompleteManual?.(action.id)}
              disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" /> 수동 완료
            </button>
          )}
          {(action.status === "executed" || action.status === "rejected" || action.status === "failed") && (
            <span className={`px-2 py-1 rounded text-xs font-medium ${badge.color}`}>{badge.label}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 진단 상세 패널 — 퍼널 진단 + 개선 추천 + 벤치마크 + 수익성 */
function DiagnosisPanel({ action, formatCurrency }: { action: ActionQueueItem; formatCurrency: (v: string | number) => string }) {
  const funnel: FunnelDiagnosis[] = safeJsonParse(action.funnel_diagnosis_json, []);
  const recommendations: string[] = safeJsonParse(action.recommendations_json, []);
  const smartRecs = safeJsonParse(action.smart_recommendations_json, []);
  const benchmark = safeJsonParse<Record<string, { value?: number; avg?: number; percentile?: number }> | null>(action.benchmark_comparison_json, null);
  const profitability = safeJsonParse<{ net_profit?: number; net_margin?: number; break_even_roas?: number } | null>(action.profitability_json, null);

  return (
    <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3 text-xs">
      {/* 퍼널 진단 */}
      {funnel.length > 0 && funnel[0]?.stage !== "퍼널 전체" && (
        <div>
          <div className="flex items-center gap-1 font-semibold text-gray-700 mb-1.5">
            <Search className="w-3.5 h-3.5" /> 퍼널 진단
          </div>
          <div className="space-y-1">
            {funnel.map((d, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`font-bold ${SEVERITY_COLORS[d.severity] || "text-gray-500"}`}>
                  {d.severity === "critical" ? "X" : d.severity === "warning" ? "!" : d.severity === "good" ? "O" : "i"}
                </span>
                <div>
                  <span className="font-medium text-gray-700">[{d.stage}]</span>{" "}
                  <span className="text-gray-600">{d.diagnosis}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 개선 추천 */}
      {recommendations.length > 0 && recommendations[0] !== "현행 유지" && (
        <div>
          <div className="flex items-center gap-1 font-semibold text-gray-700 mb-1.5">
            <Lightbulb className="w-3.5 h-3.5" /> 개선 추천
          </div>
          <ol className="list-decimal list-inside space-y-0.5 text-gray-600">
            {recommendations.slice(0, 5).map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ol>
        </div>
      )}

      {/* 학습 기반 스마트 추천 */}
      {smartRecs.length > 0 && (
        <div>
          <div className="flex items-center gap-1 font-semibold text-gray-700 mb-1.5">
            <Brain className="w-3.5 h-3.5 text-purple-600" /> 학습 기반 추천
          </div>
          <div className="space-y-1">
            {smartRecs.slice(0, 3).map((rec: { recommendation: string; confidence: string; evidence: string }, i: number) => (
              <div key={i} className="text-gray-600">
                <span className="font-medium">{rec.recommendation}</span>
                {rec.confidence && (
                  <span className="ml-1 text-xs text-purple-600">({rec.confidence})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 벤치마크 대비 */}
      {benchmark && (
        <div>
          <div className="flex items-center gap-1 font-semibold text-gray-700 mb-1.5">
            <BarChart3 className="w-3.5 h-3.5" /> 벤치마크 대비
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(benchmark).map(([key, val]: [string, unknown]) => {
              const v = val as { value?: number; avg?: number; percentile?: number };
              if (!v || typeof v !== "object" || v.value === undefined) return null;
              const diff = v.avg ? ((v.value - v.avg) / v.avg * 100).toFixed(0) : null;
              const isGood = key === "roas" ? v.value > (v.avg || 0) : key === "cpc" || key === "cpa" ? v.value < (v.avg || 0) : v.value > (v.avg || 0);
              return (
                <div key={key} className="bg-white rounded p-1.5">
                  <span className="text-gray-500 uppercase">{key}</span>
                  <div className={`font-medium ${isGood ? "text-green-600" : "text-red-600"}`}>
                    {typeof v.value === "number" ? v.value.toFixed(2) : v.value}
                    {diff && <span className="text-xs ml-1">({diff}%)</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 수익성 */}
      {profitability && profitability.net_profit !== undefined && (
        <div>
          <div className="flex items-center gap-1 font-semibold text-gray-700 mb-1.5">
            <DollarSign className="w-3.5 h-3.5" /> 수익성 분석
          </div>
          <div className="flex items-center gap-4 text-gray-600">
            <span>순이익: <span className={`font-medium ${profitability.net_profit > 0 ? "text-green-600" : "text-red-600"}`}>
              ₩{Math.round(profitability.net_profit).toLocaleString()}
            </span></span>
            {profitability.net_margin !== undefined && (
              <span>마진: <span className="font-medium">{profitability.net_margin.toFixed(1)}%</span></span>
            )}
            {profitability.break_even_roas !== undefined && profitability.break_even_roas > 0 && (
              <span>손익분기: <span className="font-medium">{profitability.break_even_roas.toFixed(2)}x</span></span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 개선 결과 배지 */
function ImprovementBadge({ result }: { result: ImprovementResult }) {
  if (!result.measured) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">
        <Clock className="w-3 h-3" /> 측정 중
      </span>
    );
  }

  if (result.result_verdict === "improved") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium">
        <CheckCircle2 className="w-3 h-3" />
        ROAS {result.before_roas?.toFixed(2)} &rarr; {result.after_roas?.toFixed(2)} (+{((result.roas_change || 0) / (result.before_roas || 1) * 100).toFixed(0)}%)
      </span>
    );
  }

  if (result.result_verdict === "worsened") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 font-medium">
        <XCircle className="w-3 h-3" />
        ROAS {result.before_roas?.toFixed(2)} &rarr; {result.after_roas?.toFixed(2)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
      — 변화 없음
    </span>
  );
}

/** Early Signal 바 차트 — 시그널별 점수 시각화 */
function EarlySignalBadge({ data }: { data: EarlySignalData }) {
  const gradeColors: Record<string, string> = {
    Promising: "text-green-700 bg-green-50 border-green-200",
    Watch: "text-yellow-700 bg-yellow-50 border-yellow-200",
    "At Risk": "text-red-700 bg-red-50 border-red-200",
    Kill: "text-red-800 bg-red-100 border-red-300",
  };

  const barColor = (score: number | null) => {
    if (score === null) return "bg-gray-200";
    if (score >= 70) return "bg-green-500";
    if (score >= 40) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className={`mt-3 p-3 rounded-lg border text-xs ${gradeColors[data.grade] || "bg-gray-50 border-gray-200"}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">
          {data.emoji} Early Health Score: {data.score}
        </span>
        <span className="font-medium">{data.grade}</span>
      </div>
      <div className="space-y-1.5">
        {(data.signals || []).map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="w-24 text-gray-600 truncate">{s.name}</span>
            <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
              {s.score !== null && (
                <div
                  className={`h-full rounded-full transition-all ${barColor(s.score)}`}
                  style={{ width: `${Math.min(100, Math.max(0, s.score))}%` }}
                />
              )}
            </div>
            <span className="w-8 text-right font-medium text-gray-700">
              {s.score !== null ? s.score : "—"}
            </span>
          </div>
        ))}
      </div>
      {data.recommendations?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10 space-y-0.5">
          {data.recommendations.slice(0, 3).map((rec, i) => (
            <p key={i} className="text-gray-600">💡 {rec}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function safeJsonParse<T>(jsonStr: string | null | undefined, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return fallback;
  }
}

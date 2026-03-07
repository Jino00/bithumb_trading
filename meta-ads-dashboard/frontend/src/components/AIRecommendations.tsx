// AI 추천 패널 — 캠페인별 판정 + 액션 아이템 + 카피 대안
import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle, AlertTriangle, XCircle, Lightbulb, Copy } from "lucide-react";
import { AnalysisResult } from "../lib/api";
import { getVerdictColor } from "../lib/utils";

interface Props {
  results: AnalysisResult[];
  loading: boolean;
  onAnalyzeAll: () => void;
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

function RecommendationCard({ result }: { result: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const verdictIcon =
    result.verdict === "MAINTAIN" ? <CheckCircle className="w-5 h-5 text-green-600" /> :
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

export default function AIRecommendations({ results, loading, onAnalyzeAll }: Props) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">AI Recommendations</h2>
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
            "Analyze All Campaigns"
          )}
        </button>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Lightbulb className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">Click "Analyze All Campaigns" to get AI-powered recommendations</p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <RecommendationCard key={r.id} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

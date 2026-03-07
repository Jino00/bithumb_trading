// Meta Ads 트렌드 피드 — 실시간 웹 검색 기반 최신 정보
import { useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Zap, BarChart3, Lightbulb, Newspaper, Clock } from "lucide-react";
import { TrendsData, refreshTrends } from "../lib/api";

interface Props {
  trends: TrendsData | null;
  onRefresh: (data: TrendsData) => void;
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "up") return <TrendingUp className="w-3 h-3 text-green-500" />;
  if (trend === "down") return <TrendingDown className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-gray-400" />;
}

export default function TrendsFeed({ trends, onRefresh }: Props) {
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const data = await refreshTrends();
      onRefresh(data);
    } catch (err) {
      console.error("Failed to refresh trends:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-900">Meta Ads Trends</h2>
          <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-medium rounded-full">
            <Clock className="w-3 h-3" /> 매일 06:00 자동 업데이트
          </span>
        </div>
        <div className="flex items-center gap-2">
          {trends?.last_updated && (
            <span className="text-xs text-gray-400">
              Updated: {new Date(trends.last_updated).toLocaleString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Fetching..." : "Refresh"}
          </button>
        </div>
      </div>

      {!trends ? (
        <div className="text-center py-8 text-gray-500">
          <Newspaper className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">Click Refresh to fetch latest Meta Ads trends</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Algorithm Updates */}
          {trends.algorithm_updates && trends.algorithm_updates.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <Zap className="w-4 h-4 text-yellow-500" /> Algorithm Updates
              </h3>
              <div className="space-y-2">
                {trends.algorithm_updates.map((update, i) => (
                  <div key={i} className="p-3 bg-yellow-50 border border-yellow-100 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-sm font-medium text-gray-900">{update.title}</h4>
                      {update.date && <span className="text-xs text-gray-400">{update.date}</span>}
                    </div>
                    <p className="text-xs text-gray-600">{update.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Best Formats */}
          {trends.best_formats && trends.best_formats.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <BarChart3 className="w-4 h-4 text-blue-500" /> Best Performing Formats
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {trends.best_formats.map((fmt, i) => (
                  <div key={i} className="p-2 bg-blue-50 border border-blue-100 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{fmt.format}</span>
                      <TrendIcon trend={fmt.trend} />
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{fmt.performance}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Benchmarks */}
          {trends.benchmarks && (
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <BarChart3 className="w-4 h-4 text-green-500" /> Industry Benchmarks
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500">Avg CTR</div>
                  <div className="text-sm font-bold text-gray-900">{trends.benchmarks.average_ctr}</div>
                </div>
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500">Avg CPC</div>
                  <div className="text-sm font-bold text-gray-900">{trends.benchmarks.average_cpc}</div>
                </div>
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500">Avg CPM</div>
                  <div className="text-sm font-bold text-gray-900">{trends.benchmarks.average_cpm}</div>
                </div>
                <div className="p-2 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500">Avg ROAS</div>
                  <div className="text-sm font-bold text-gray-900">{trends.benchmarks.average_roas}</div>
                </div>
              </div>
              {trends.benchmarks.industry_note && (
                <p className="text-xs text-gray-500 mt-2">{trends.benchmarks.industry_note}</p>
              )}
            </section>
          )}

          {/* What's Working */}
          {trends.whats_working && trends.whats_working.length > 0 && (
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <Lightbulb className="w-4 h-4 text-orange-500" /> What's Working Now
              </h3>
              <ul className="space-y-1.5">
                {trends.whats_working.map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                    <span className="w-1.5 h-1.5 bg-orange-400 rounded-full mt-1.5 flex-shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

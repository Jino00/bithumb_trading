// Meta Ad Library 리뷰 페이지 — 검색/분석/레퍼런스 축적
import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Library,
  Loader2,
  TrendingUp,
  Palette,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Lightbulb,
  Sparkles,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import {
  AdLibraryReview as AdLibraryReviewType,
  AdLibraryReviewSummary,
  fetchAdLibraryReviews,
  createAdLibraryReview,
  fetchAdLibraryReview,
  deleteAdLibraryReview,
} from "../lib/api";

type SearchType = "keyword" | "brand" | "category";

const SEARCH_TYPES: { value: SearchType; label: string }[] = [
  { value: "keyword", label: "키워드" },
  { value: "brand", label: "브랜드" },
  { value: "category", label: "카테고리" },
];

const PRIORITY_COLORS = {
  high: "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-gray-100 text-gray-600",
};

const PREVALENCE_COLORS = {
  high: "bg-green-100 text-green-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-gray-100 text-gray-600",
};

export default function AdLibraryReviewPage() {
  const [reviews, setReviews] = useState<AdLibraryReviewSummary[]>([]);
  const [selectedReview, setSelectedReview] = useState<AdLibraryReviewType | null>(null);
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("keyword");
  const [searching, setSearching] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReviews = useCallback(async () => {
    try {
      const data = await fetchAdLibraryReviews();
      setReviews(data);
    } catch (err) {
      console.error("Failed to load reviews:", err);
    }
  }, []);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setSelectedReview(null);
    try {
      const result = await createAdLibraryReview(query.trim(), searchType);
      setSelectedReview(result);
      setQuery("");
      await loadReviews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelectReview = async (id: number) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const data = await fetchAdLibraryReview(id);
      setSelectedReview(data);
    } catch (err) {
      setError("리뷰를 불러오지 못했습니다.");
      console.error(err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAdLibraryReview(id);
      if (selectedReview?.id === id) setSelectedReview(null);
      await loadReviews();
    } catch (err) {
      console.error("Failed to delete review:", err);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Library className="w-5 h-5 text-purple-600" />
        <h2 className="text-xl font-bold text-gray-900">Ad Library Review</h2>
      </div>

      {/* Search Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="키워드, 브랜드명, 카테고리 검색..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="relative">
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as SearchType)}
                className="appearance-none px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {SEARCH_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="flex items-center justify-center gap-1.5 px-5 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {searching ? "분석 중..." : "AI 분석"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Review History */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">리뷰 히스토리</h3>
            {reviews.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">아직 리뷰가 없습니다</p>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors ${
                      selectedReview?.id === r.id ? "bg-purple-50 border border-purple-200" : "hover:bg-gray-50 border border-transparent"
                    }`}
                    onClick={() => handleSelectReview(r.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{r.search_query}</div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded">{r.search_type}</span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-3 h-3" />
                          {new Date(r.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Review Detail */}
        <div className="lg:col-span-3">
          {loadingDetail ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400" />
              <p className="mt-2 text-sm text-gray-500">불러오는 중...</p>
            </div>
          ) : searching ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-400" />
              <p className="mt-2 text-sm text-gray-500">AI가 Ad Library를 분석하고 있습니다...</p>
              <p className="text-xs text-gray-400 mt-1">최대 30초 소요될 수 있습니다</p>
            </div>
          ) : selectedReview ? (
            <ReviewDetail review={selectedReview} />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <Library className="w-12 h-12 mx-auto text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">키워드나 브랜드를 검색하여 Ad Library를 분석하세요</p>
              <p className="text-xs text-gray-400 mt-1">AI가 트렌드, 스타일, 메시징 패턴을 분석합니다</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewDetail({ review }: { review: AdLibraryReviewType }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["trends", "styles", "pros_cons", "messaging", "takeaways", "adaptations"])
  );

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const SectionHeader = ({ id, icon: Icon, title, iconColor }: { id: string; icon: typeof TrendingUp; title: string; iconColor: string }) => (
    <button
      onClick={() => toggleSection(id)}
      className="flex items-center gap-2 w-full text-left mb-3"
    >
      {expandedSections.has(id) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      <Icon className={`w-4 h-4 ${iconColor}`} />
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">"{review.search_query}"</h3>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
              <span className="px-2 py-0.5 bg-purple-50 text-purple-600 rounded-full font-medium">{review.search_type}</span>
              <span>광고 {review.ads_found}건 분석</span>
              <span>{new Date(review.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Trends */}
      {review.trends?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <SectionHeader id="trends" icon={TrendingUp} title="트렌드" iconColor="text-green-500" />
          {expandedSections.has("trends") && (
            <div className="space-y-3 ml-6">
              {review.trends.map((t, i) => (
                <div key={i} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-medium text-gray-900">{t.trend_name}</h4>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PREVALENCE_COLORS[t.prevalence]}`}>
                      {t.prevalence}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{t.description}</p>
                  {t.examples?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.examples.map((ex, j) => (
                        <span key={j} className="text-[10px] px-2 py-0.5 bg-white border border-green-200 rounded text-gray-600">{ex}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Creative Styles */}
      {review.styles?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <SectionHeader id="styles" icon={Palette} title="크리에이티브 스타일" iconColor="text-purple-500" />
          {expandedSections.has("styles") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 ml-6">
              {review.styles.map((s, i) => (
                <div key={i} className="p-3 bg-purple-50 border border-purple-100 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-medium text-gray-900">{s.style_name}</h4>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${PREVALENCE_COLORS[s.effectiveness]}`}>
                      {s.effectiveness}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{s.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {s.visual_elements?.map((el, j) => (
                      <span key={j} className="text-[10px] px-2 py-0.5 bg-white border border-purple-200 rounded text-gray-600">{el}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pros & Cons */}
      {(review.pros_cons?.pros?.length > 0 || review.pros_cons?.cons?.length > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <SectionHeader id="pros_cons" icon={ThumbsUp} title="장단점 분석" iconColor="text-blue-500" />
          {expandedSections.has("pros_cons") && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 ml-6">
              {review.pros_cons.pros?.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-green-600 mb-2">
                    <ThumbsUp className="w-3.5 h-3.5" /> 강점
                  </h4>
                  <div className="space-y-2">
                    {review.pros_cons.pros.map((p, i) => (
                      <div key={i} className="p-2.5 bg-green-50 rounded-lg">
                        <div className="text-xs font-medium text-gray-900">{p.point}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{p.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {review.pros_cons.cons?.length > 0 && (
                <div>
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-red-600 mb-2">
                    <ThumbsDown className="w-3.5 h-3.5" /> 약점
                  </h4>
                  <div className="space-y-2">
                    {review.pros_cons.cons.map((c, i) => (
                      <div key={i} className="p-2.5 bg-red-50 rounded-lg">
                        <div className="text-xs font-medium text-gray-900">{c.point}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{c.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messaging Patterns */}
      {review.messaging_patterns?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <SectionHeader id="messaging" icon={MessageSquare} title="메시징 패턴" iconColor="text-orange-500" />
          {expandedSections.has("messaging") && (
            <div className="space-y-3 ml-6">
              {review.messaging_patterns.map((m, i) => (
                <div key={i} className="p-3 bg-orange-50 border border-orange-100 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-900 mb-1">{m.pattern_name}</h4>
                  <p className="text-xs text-gray-600 mb-2">{m.description}</p>
                  {m.example_headlines?.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] font-medium text-gray-500 mb-1">헤드라인 예시</div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.example_headlines.map((h, j) => (
                          <span key={j} className="text-[10px] px-2 py-0.5 bg-white border border-orange-200 rounded text-gray-700 italic">"{h}"</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {m.cta_types?.length > 0 && (
                    <div>
                      <div className="text-[10px] font-medium text-gray-500 mb-1">CTA 유형</div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.cta_types.map((c, j) => (
                          <span key={j} className="text-[10px] px-2 py-1 bg-orange-100 rounded font-medium text-orange-700">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Key Takeaways */}
      {review.key_takeaways?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <SectionHeader id="takeaways" icon={Lightbulb} title="핵심 인사이트" iconColor="text-yellow-500" />
          {expandedSections.has("takeaways") && (
            <div className="space-y-2 ml-6">
              {review.key_takeaways.map((t, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-yellow-50 border border-yellow-100 rounded-lg">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium mt-0.5 flex-shrink-0 ${PRIORITY_COLORS[t.priority]}`}>
                    {t.priority}
                  </span>
                  <div>
                    <div className="text-xs font-medium text-gray-900">{t.insight}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{t.actionable_tip}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recommended Adaptations */}
      {review.raw_analysis?.recommended_adaptations?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <SectionHeader id="adaptations" icon={Sparkles} title="추천 적용 방안" iconColor="text-indigo-500" />
          {expandedSections.has("adaptations") && (
            <div className="space-y-3 ml-6">
              {review.raw_analysis.recommended_adaptations.map((a, i) => (
                <div key={i} className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-900 mb-1">{a.recommendation}</h4>
                  <p className="text-xs text-gray-600 mb-1">{a.rationale}</p>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-indigo-500" />
                    <span className="text-[10px] font-medium text-indigo-600">{a.estimated_impact}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

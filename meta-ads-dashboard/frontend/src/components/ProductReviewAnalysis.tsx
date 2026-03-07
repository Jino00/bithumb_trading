// 제품 리뷰 분석 페이지 — 제품 레지스트리 + 플랫폼별 리뷰 분석 + 크로스 플랫폼 종합
import { useState, useEffect, useCallback } from "react";
import {
  ShoppingBag, Plus, Trash2, ExternalLink, Loader2, Search,
  ChevronDown, ChevronRight, Star, TrendingUp, ThumbsUp, ThumbsDown,
  BarChart3, Lightbulb, MessageSquare, Globe, Clock, Database, CheckCircle2, AlertCircle,
} from "lucide-react";
import {
  Product, ProductDetail, ProductListing, ProductReview, ProductAggregation,
  ReviewSentiment, ReviewTheme, ReviewPoint, CrossPlatformTheme,
  PlatformComparison, ActionableInsight, PLATFORM_LABELS, ScrapeStatus,
  fetchProducts, createProduct, fetchProduct, deleteProduct,
  addProductListing, deleteProductListing, analyzeProductReviews, fetchScrapeStatus,
} from "../lib/api";

const PLATFORM_OPTIONS = [
  { value: "naver_smartstore", label: "네이버 스마트스토어" },
  { value: "coupang", label: "쿠팡" },
  { value: "11st", label: "11번가" },
  { value: "own_store", label: "자사몰" },
  { value: "other", label: "기타" },
];

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-gray-100 text-gray-600",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-green-600",
  negative: "text-red-600",
  neutral: "text-gray-500",
  mixed: "text-yellow-600",
};

const FREQUENCY_COLORS: Record<string, string> = {
  high: "bg-teal-100 text-teal-700",
  medium: "bg-blue-100 text-blue-700",
  low: "bg-gray-100 text-gray-600",
};

const SCRAPE_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  idle: { label: "대기", color: "text-gray-400", icon: Clock },
  scraping: { label: "수집 중", color: "text-blue-500", icon: Loader2 },
  done: { label: "완료", color: "text-green-600", icon: CheckCircle2 },
  done_web_search: { label: "완료 (웹검색)", color: "text-green-600", icon: Search },
  error: { label: "오류", color: "text-red-500", icon: AlertCircle },
};

function platformLabel(type: string) {
  return PLATFORM_LABELS[type] || type;
}

function ScrapeStatusBadge({ status }: { status: ScrapeStatus }) {
  const config = SCRAPE_STATUS_CONFIG[status.scrape_status] || SCRAPE_STATUS_CONFIG.idle;
  const Icon = config.icon;
  const isSpinning = status.scrape_status === "scraping";

  return (
    <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-1">
      <span className={`flex items-center gap-0.5 ${config.color}`}>
        <Icon className={`w-3 h-3 ${isSpinning ? "animate-spin" : ""}`} />
        {config.label}
      </span>
      {status.total_review_count > 0 && (
        <span className="flex items-center gap-0.5">
          <Database className="w-3 h-3" />
          총 {status.total_review_count.toLocaleString()}개
        </span>
      )}
      {status.average_rating && (
        <span className="flex items-center gap-0.5 text-yellow-600">
          <Star className="w-3 h-3 fill-yellow-400" />
          {status.average_rating.toFixed(1)}
        </span>
      )}
      {status.last_scraped_at && (
        <span className="flex items-center gap-0.5">
          <Clock className="w-3 h-3" />
          {new Date(status.last_scraped_at).toLocaleDateString()}
        </span>
      )}
      {status.unanalyzed_count > 0 && (
        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">
          미분석 {status.unanalyzed_count}건
        </span>
      )}
    </div>
  );
}

function SentimentBar({ sentiment }: { sentiment: ReviewSentiment }) {
  return (
    <div className="space-y-1">
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
        {sentiment.positive_pct > 0 && (
          <div className="bg-green-400" style={{ width: `${sentiment.positive_pct}%` }} />
        )}
        {sentiment.neutral_pct > 0 && (
          <div className="bg-gray-300" style={{ width: `${sentiment.neutral_pct}%` }} />
        )}
        {sentiment.negative_pct > 0 && (
          <div className="bg-red-400" style={{ width: `${sentiment.negative_pct}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span className="text-green-600">긍정 {sentiment.positive_pct}%</span>
        <span>중립 {sentiment.neutral_pct}%</span>
        <span className="text-red-600">부정 {sentiment.negative_pct}%</span>
      </div>
    </div>
  );
}

function PlatformReviewCard({ review }: { review: ProductReview }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Globe className="w-4 h-4 text-teal-600" />
          <span className="text-sm font-medium">{platformLabel(review.platform_type)}</span>
          <span className="text-xs text-gray-400">리뷰 {review.review_count}개</span>
          {review.average_rating && (
            <span className="flex items-center gap-0.5 text-xs text-yellow-600">
              <Star className="w-3 h-3 fill-yellow-400" /> {review.average_rating.toFixed(1)}
            </span>
          )}
        </div>
        <span className={`text-xs font-medium ${SENTIMENT_COLORS[review.sentiment_summary?.overall] || ""}`}>
          {review.sentiment_summary?.overall === "positive" ? "긍정적" :
           review.sentiment_summary?.overall === "negative" ? "부정적" :
           review.sentiment_summary?.overall === "mixed" ? "혼합" : "중립"}
        </span>
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          <SentimentBar sentiment={review.sentiment_summary} />

          {review.themes.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-gray-600 mb-2">주요 테마</h5>
              <div className="flex flex-wrap gap-2">
                {review.themes.map((t: ReviewTheme, i: number) => (
                  <div key={i} className="px-2 py-1 bg-teal-50 border border-teal-100 rounded text-xs">
                    <span className={SENTIMENT_COLORS[t.sentiment]}>{t.theme}</span>
                    <span className={`ml-1 px-1 rounded ${FREQUENCY_COLORS[t.frequency]}`}>{t.frequency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {review.strengths.length > 0 && (
              <div>
                <h5 className="flex items-center gap-1 text-xs font-semibold text-green-700 mb-1">
                  <ThumbsUp className="w-3 h-3" /> 장점
                </h5>
                <div className="space-y-1">
                  {review.strengths.map((s: ReviewPoint, i: number) => (
                    <div key={i} className="p-2 bg-green-50 rounded text-xs">
                      <div className="font-medium text-gray-800">{s.point} ({s.mention_count}회)</div>
                      <div className="text-gray-600 mt-0.5">{s.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {review.weaknesses.length > 0 && (
              <div>
                <h5 className="flex items-center gap-1 text-xs font-semibold text-red-700 mb-1">
                  <ThumbsDown className="w-3 h-3" /> 단점
                </h5>
                <div className="space-y-1">
                  {review.weaknesses.map((w: ReviewPoint, i: number) => (
                    <div key={i} className="p-2 bg-red-50 rounded text-xs">
                      <div className="font-medium text-gray-800">{w.point} ({w.mention_count}회)</div>
                      <div className="text-gray-600 mt-0.5">{w.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {review.notable_reviews.length > 0 && (
            <div>
              <h5 className="flex items-center gap-1 text-xs font-semibold text-gray-600 mb-1">
                <MessageSquare className="w-3 h-3" /> 주목할 리뷰
              </h5>
              <div className="space-y-1">
                {review.notable_reviews.map((nr, i) => (
                  <div key={i} className="p-2 bg-gray-50 rounded text-xs flex items-start gap-2">
                    <span className={nr.sentiment === "positive" ? "text-green-500" : "text-red-500"}>
                      {nr.sentiment === "positive" ? "+" : "-"}
                    </span>
                    <div>
                      <div className="text-gray-800">{nr.summary}</div>
                      <div className="text-gray-500 mt-0.5">{nr.key_point}</div>
                    </div>
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

function AggregationView({ aggregation }: { aggregation: ProductAggregation }) {
  const [expandedSections, setExpandedSections] = useState(new Set(["themes", "comparison", "insights"]));

  const toggleSection = (id: string) => {
    const next = new Set(expandedSections);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedSections(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-teal-600" /> 크로스 플랫폼 종합 분석
        </h4>
        <span className="text-xs text-gray-400">
          총 리뷰 {aggregation.total_review_count}개 · {new Date(aggregation.aggregated_at).toLocaleDateString()}
        </span>
      </div>

      <SentimentBar sentiment={aggregation.overall_sentiment} />

      {/* 크로스 플랫폼 테마 */}
      <div>
        <button onClick={() => toggleSection("themes")} className="flex items-center gap-1 text-sm font-semibold text-gray-700">
          {expandedSections.has("themes") ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <TrendingUp className="w-4 h-4 text-teal-500" /> 공통 테마
        </button>
        {expandedSections.has("themes") && aggregation.cross_platform_themes.length > 0 && (
          <div className="mt-2 space-y-2 ml-5">
            {aggregation.cross_platform_themes.map((t: CrossPlatformTheme, i: number) => (
              <div key={i} className="p-2 bg-teal-50 border border-teal-100 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{t.theme}</span>
                  <span className={`text-xs ${SENTIMENT_COLORS[t.overall_sentiment]}`}>{t.overall_sentiment}</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">{t.insight}</p>
                <div className="flex gap-1 mt-1">
                  {t.appears_on.map((p, j) => (
                    <span key={j} className="px-1.5 py-0.5 bg-white rounded text-[10px] text-gray-500">{platformLabel(p)}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 장단점 */}
      <div className="grid grid-cols-2 gap-3">
        {aggregation.cross_platform_strengths.length > 0 && (
          <div>
            <h5 className="flex items-center gap-1 text-xs font-semibold text-green-700 mb-1">
              <ThumbsUp className="w-3 h-3" /> 공통 장점
            </h5>
            {aggregation.cross_platform_strengths.map((s, i) => (
              <div key={i} className="p-2 bg-green-50 rounded text-xs mb-1">
                <div className="font-medium">{s.point}</div>
                <div className="text-gray-600">{s.detail}</div>
              </div>
            ))}
          </div>
        )}
        {aggregation.cross_platform_weaknesses.length > 0 && (
          <div>
            <h5 className="flex items-center gap-1 text-xs font-semibold text-red-700 mb-1">
              <ThumbsDown className="w-3 h-3" /> 공통 단점
            </h5>
            {aggregation.cross_platform_weaknesses.map((w, i) => (
              <div key={i} className="p-2 bg-red-50 rounded text-xs mb-1">
                <div className="font-medium">{w.point}</div>
                <div className="text-gray-600">{w.detail}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 플랫폼 비교 */}
      <div>
        <button onClick={() => toggleSection("comparison")} className="flex items-center gap-1 text-sm font-semibold text-gray-700">
          {expandedSections.has("comparison") ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Globe className="w-4 h-4 text-blue-500" /> 플랫폼 비교
        </button>
        {expandedSections.has("comparison") && aggregation.platform_comparison.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2 ml-5">
            {aggregation.platform_comparison.map((pc: PlatformComparison, i: number) => (
              <div key={i} className="p-2 bg-blue-50 border border-blue-100 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{platformLabel(pc.platform)}</span>
                  {pc.average_rating && (
                    <span className="flex items-center gap-0.5 text-xs text-yellow-600">
                      <Star className="w-3 h-3 fill-yellow-400" /> {pc.average_rating}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">리뷰 {pc.review_count}개 · {pc.sentiment}</div>
                <div className="text-xs text-gray-700 mt-1">{pc.unique_insight}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 실행 가능한 인사이트 */}
      <div>
        <button onClick={() => toggleSection("insights")} className="flex items-center gap-1 text-sm font-semibold text-gray-700">
          {expandedSections.has("insights") ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Lightbulb className="w-4 h-4 text-yellow-500" /> 실행 가능한 인사이트
        </button>
        {expandedSections.has("insights") && aggregation.actionable_insights.length > 0 && (
          <div className="mt-2 space-y-2 ml-5">
            {aggregation.actionable_insights.map((ins: ActionableInsight, i: number) => (
              <div key={i} className="p-3 bg-yellow-50 border border-yellow-100 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_COLORS[ins.priority]}`}>
                    {ins.priority}
                  </span>
                  <span className="text-sm font-medium text-gray-900">{ins.insight}</span>
                </div>
                <p className="text-xs text-gray-700">{ins.action}</p>
                <p className="text-xs text-teal-600 mt-1">예상 효과: {ins.expected_impact}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductDetailView({
  product, onListingAdded, onListingDeleted, onAnalyze, analyzing,
}: {
  product: ProductDetail;
  onListingAdded: () => void;
  onListingDeleted: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const [newPlatform, setNewPlatform] = useState("naver_smartstore");
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [scrapeStatuses, setScrapeStatuses] = useState<Record<number, ScrapeStatus>>({});

  useEffect(() => {
    if (product.listings.length > 0) {
      fetchScrapeStatus(product.id)
        .then((statuses) => {
          const map: Record<number, ScrapeStatus> = {};
          for (const s of statuses) map[s.listing_id] = s;
          setScrapeStatuses(map);
        })
        .catch(() => {});
    }
  }, [product.id, product.listings.length]);

  const handleAddListing = async () => {
    if (!newUrl.trim() || !newName.trim()) return;
    setAdding(true);
    try {
      await addProductListing(product.id, newPlatform, newUrl.trim(), newName.trim());
      setNewUrl("");
      setNewName("");
      onListingAdded();
    } catch (err) {
      console.error(err);
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteListing = async (listing: ProductListing) => {
    try {
      await deleteProductListing(product.id, listing.id);
      onListingDeleted();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-5">
      {/* 제품 헤더 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{product.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded-full">{product.category}</span>
              {product.description && <span className="text-xs text-gray-500">{product.description}</span>}
            </div>
          </div>
          <button
            onClick={onAnalyze}
            disabled={analyzing || product.listings.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {analyzing ? "스크래핑 + AI 분석 중..." : "AI 리뷰 분석"}
          </button>
        </div>
        {product.listings.length === 0 && (
          <p className="text-xs text-amber-600 mt-2">판매처를 먼저 등록해주세요.</p>
        )}
      </div>

      {/* 판매처 관리 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h4 className="text-sm font-bold text-gray-900 mb-3">판매처 등록</h4>

        {/* 기존 등록 목록 */}
        {product.listings.length > 0 && (
          <div className="space-y-2 mb-3">
            {product.listings.map((listing) => (
              <div key={listing.id} className="p-2 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-[10px] font-medium rounded whitespace-nowrap">
                      {platformLabel(listing.platform_type)}
                    </span>
                    <span className="text-xs text-gray-700 truncate">{listing.listing_name}</span>
                    <a href={listing.listing_url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-teal-600 flex-shrink-0">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <button
                    onClick={() => handleDeleteListing(listing)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {scrapeStatuses[listing.id] && (
                  <ScrapeStatusBadge status={scrapeStatuses[listing.id]} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* 새 등록 폼 */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
            >
              {PLATFORM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="판매처 상품명 (예: 오하이 저반사 지문방지 필름)"
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="상품 페이지 URL"
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              onKeyDown={(e) => e.key === "Enter" && handleAddListing()}
            />
            <button
              onClick={handleAddListing}
              disabled={adding || !newUrl.trim() || !newName.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              추가
            </button>
          </div>
          {newPlatform === "naver_smartstore" && (
            <p className="text-[10px] text-amber-600">
              네이버 스마트스토어는 옵션별로 리뷰가 분리됩니다. 분석 시 모든 옵션의 리뷰를 자동 종합합니다.
            </p>
          )}
        </div>
      </div>

      {/* 플랫폼별 분석 결과 */}
      {product.latest_reviews.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-bold text-gray-900">플랫폼별 리뷰 분석</h4>
          {product.latest_reviews.map((review) => (
            <PlatformReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}

      {/* 크로스 플랫폼 종합 */}
      {product.aggregation && (
        <div className="bg-white rounded-xl border border-teal-200 p-4">
          <AggregationView aggregation={product.aggregation} />
        </div>
      )}
    </div>
  );
}

export default function ProductReviewAnalysisPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 새 제품 등록 폼
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const loadProducts = useCallback(async () => {
    try {
      const data = await fetchProducts();
      setProducts(data);
    } catch (err) {
      console.error("Failed to load products:", err);
    }
  }, []);

  const loadProductDetail = useCallback(async (id: number) => {
    setLoadingDetail(true);
    try {
      const data = await fetchProduct(id);
      setSelectedProduct(data);
    } catch (err) {
      console.error("Failed to load product:", err);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleCreateProduct = async () => {
    if (!newName.trim() || !newCategory.trim()) return;
    try {
      const product = await createProduct(newName.trim(), newCategory.trim());
      setNewName("");
      setNewCategory("");
      await loadProducts();
      loadProductDetail(product.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "제품 등록 실패");
    }
  };

  const handleDeleteProduct = async (id: number) => {
    try {
      await deleteProduct(id);
      if (selectedProduct?.id === id) setSelectedProduct(null);
      await loadProducts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedProduct) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeProductReviews(selectedProduct.id);
      await loadProductDetail(selectedProduct.id);
      await loadProducts();
      if (result.listings_analyzed === 0) {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "분석 실패");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
      {/* 왼쪽: 제품 목록 */}
      <div className="lg:col-span-1 space-y-4">
        {/* 제품 등록 */}
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1.5">
            <ShoppingBag className="w-4 h-4 text-teal-600" /> 제품 등록
          </h3>
          <div className="space-y-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="제품 대표명"
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="카테고리 (예: 액정보호필름)"
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              onKeyDown={(e) => e.key === "Enter" && handleCreateProduct()}
            />
            <button
              onClick={handleCreateProduct}
              disabled={!newName.trim() || !newCategory.trim()}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> 등록
            </button>
          </div>
        </div>

        {/* 제품 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <h3 className="text-sm font-bold text-gray-900 mb-2">내 제품</h3>
          {products.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">등록된 제품이 없습니다</p>
          ) : (
            <div className="space-y-1">
              {products.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                    selectedProduct?.id === p.id ? "bg-teal-50 border border-teal-200" : "hover:bg-gray-50"
                  }`}
                  onClick={() => loadProductDetail(p.id)}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{p.name}</div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                      <span>{p.category}</span>
                      <span>판매처 {p.listing_count}개</span>
                      {p.last_analyzed && (
                        <span>분석: {new Date(p.last_analyzed).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteProduct(p.id); }}
                    className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 오른쪽: 상세 뷰 */}
      <div className="lg:col-span-3">
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {loadingDetail ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
          </div>
        ) : selectedProduct ? (
          <ProductDetailView
            product={selectedProduct}
            onListingAdded={() => loadProductDetail(selectedProduct.id)}
            onListingDeleted={() => loadProductDetail(selectedProduct.id)}
            onAnalyze={handleAnalyze}
            analyzing={analyzing}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <ShoppingBag className="w-12 h-12 mb-3" />
            <p className="text-sm">왼쪽에서 제품을 선택하거나 새 제품을 등록하세요</p>
          </div>
        )}
      </div>
    </div>
  );
}

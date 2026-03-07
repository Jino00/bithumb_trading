// API 클라이언트 — 백엔드 통신 래퍼
import axios from "axios";

const API_BASE = "/api";

const api = axios.create({ baseURL: API_BASE });

export interface Campaign {
  id: number;
  name: string;
  status: string;
  ctr: number;
  roas: number;
  cpc: number;
  frequency: number;
  daily_spend: number;
  total_spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ai_verdict: string | null;
  ai_recommendation: string | null;
  ai_fix_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisResult {
  id: number;
  name: string;
  verdict: string;
  fix_type: string | null;
  reasoning: string;
  action_items: string[];
  estimated_improvement: string;
  copy_alternatives: string[] | null;
}

export interface Competitor {
  id: number;
  name: string;
  page_url: string | null;
  insights: CompetitorInsights | null;
  last_analyzed: string | null;
  created_at: string;
}

export interface CompetitorInsights {
  competitor_name: string;
  active_campaigns: { format: string; theme: string; estimated_spend: string }[];
  messaging_themes: string[];
  top_formats: string[];
  creative_angles: string[];
  estimated_monthly_spend: string;
  strategy_summary: string;
}

export interface TrendsData {
  algorithm_updates: { title: string; content: string; date: string }[];
  best_formats: { format: string; performance: string; trend: string }[];
  benchmarks: {
    average_ctr: string;
    average_cpc: string;
    average_cpm: string;
    average_roas: string;
    industry_note: string;
  };
  whats_working: string[];
  last_updated: string | null;
}

// Ads
export type DatePeriod = "1d" | "7d" | "15d" | "30d";
export const fetchCampaigns = () => api.get<Campaign[]>("/ads").then((r) => r.data);
export const fetchCampaignsByPeriod = (period: DatePeriod) =>
  api.get<Campaign[]>(`/meta/insights?period=${period}`).then((r) => r.data);
export const createCampaign = (data: Partial<Campaign>) => api.post<Campaign>("/ads", data).then((r) => r.data);
export const updateCampaign = (id: number, data: Partial<Campaign>) =>
  api.put<Campaign>(`/ads/${id}`, data).then((r) => r.data);
export const deleteCampaign = (id: number) => api.delete(`/ads/${id}`);

// Analysis
export const analyzeAll = () =>
  api.post<{ campaigns: AnalysisResult[] }>("/analysis/analyze-all").then((r) => r.data);
export const analyzeSingle = (id: number) =>
  api.post<AnalysisResult>(`/analysis/analyze/${id}`).then((r) => r.data);

// Competitors
export const fetchCompetitors = () => api.get<Competitor[]>("/competitors").then((r) => r.data);
export const addCompetitor = (name: string, page_url?: string) =>
  api.post<Competitor>("/competitors", { name, page_url }).then((r) => r.data);
export const analyzeCompetitor = (id: number) =>
  api.post<Competitor>(`/competitors/${id}/analyze`).then((r) => r.data);
export const stealStrategy = (id: number) =>
  api.post(`/competitors/${id}/steal-strategy`).then((r) => r.data);
export const deleteCompetitor = (id: number) => api.delete(`/competitors/${id}`);

// Trends
export const fetchTrends = () => api.get("/trends").then((r) => r.data);
export const refreshTrends = () => api.post<TrendsData>("/trends/refresh").then((r) => r.data);

// Meta OAuth / Sync
export interface MetaConfig {
  app_id_configured: boolean;
  redirect_uri: string;
}

export interface MetaStatus {
  connected: boolean;
  expired?: boolean;
  user_name?: string;
  fb_user_id?: string;
  expires_at?: string;
  selected_ad_account_id?: string;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export interface MetaSyncResult {
  synced: number;
  failed: number;
  synced_campaigns: string[];
  errors?: { campaign: string; error: string }[];
}

export const fetchMetaConfig = () => api.get<MetaConfig>("/meta/config").then((r) => r.data);
export const saveMetaConfig = (app_id: string, app_secret: string) =>
  api.post("/meta/config", { app_id, app_secret }).then((r) => r.data);
export const fetchMetaAuthUrl = () => api.get<{ url: string }>("/meta/auth-url").then((r) => r.data);
export const fetchMetaStatus = () => api.get<MetaStatus>("/meta/status").then((r) => r.data);
export const disconnectMeta = () => api.post("/meta/disconnect").then((r) => r.data);
export const fetchMetaAdAccounts = () => api.get<MetaAdAccount[]>("/meta/ad-accounts").then((r) => r.data);
export const selectMetaAdAccount = (account_id: string) =>
  api.post("/meta/select-account", { account_id }).then((r) => r.data);
export const syncMetaCampaigns = () => api.post<MetaSyncResult>("/meta/sync").then((r) => r.data);

// Business portfolios
export interface MetaBusiness {
  id: string;
  name: string;
}

export const fetchMetaBusinesses = () => api.get<MetaBusiness[]>("/meta/businesses").then((r) => r.data);
export const fetchBusinessAdAccounts = (businessId: string) =>
  api.get<MetaAdAccount[]>(`/meta/businesses/${businessId}/ad-accounts`).then((r) => r.data);

// Period insights with optional account override
export const fetchCampaignsByAccount = (period: DatePeriod, accountId: string) =>
  api.get<Campaign[]>(`/meta/insights?period=${period}&account_id=${accountId}`).then((r) => r.data);

// Ad Library Reviews
export interface AdLibraryTrend {
  trend_name: string;
  description: string;
  prevalence: "high" | "medium" | "low";
  examples: string[];
}

export interface AdLibraryStyle {
  style_name: string;
  description: string;
  visual_elements: string[];
  effectiveness: "high" | "medium" | "low";
}

export interface AdLibraryProsCons {
  pros: { point: string; detail: string }[];
  cons: { point: string; detail: string }[];
}

export interface AdLibraryMessaging {
  pattern_name: string;
  description: string;
  example_headlines: string[];
  cta_types: string[];
}

export interface AdLibraryTakeaway {
  insight: string;
  actionable_tip: string;
  priority: "high" | "medium" | "low";
}

export interface AdLibraryReviewSummary {
  id: number;
  search_query: string;
  search_type: string;
  ads_found: number;
  created_at: string;
}

export interface AdLibraryReview extends AdLibraryReviewSummary {
  trends: AdLibraryTrend[];
  styles: AdLibraryStyle[];
  pros_cons: AdLibraryProsCons;
  messaging_patterns: AdLibraryMessaging[];
  key_takeaways: AdLibraryTakeaway[];
  raw_analysis: {
    recommended_adaptations?: { recommendation: string; rationale: string; estimated_impact: string }[];
    [key: string]: unknown;
  };
}

export const fetchAdLibraryReviews = () =>
  api.get<AdLibraryReviewSummary[]>("/ad-library/reviews").then((r) => r.data);
export const createAdLibraryReview = (query: string, type: string = "keyword") =>
  api.post<AdLibraryReview>("/ad-library/review", { query, type }).then((r) => r.data);
export const fetchAdLibraryReview = (id: number) =>
  api.get<AdLibraryReview>(`/ad-library/reviews/${id}`).then((r) => r.data);
export const deleteAdLibraryReview = (id: number) =>
  api.delete(`/ad-library/reviews/${id}`);

// Product Review Analysis
export type PlatformType = "naver_smartstore" | "coupang" | "11st" | "own_store" | string;

export const PLATFORM_LABELS: Record<string, string> = {
  naver_smartstore: "네이버 스마트스토어",
  coupang: "쿠팡",
  "11st": "11번가",
  own_store: "자사몰",
};

export interface Product {
  id: number;
  name: string;
  category: string;
  description: string | null;
  listing_count: number;
  last_analyzed: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductListing {
  id: number;
  product_id: number;
  platform_type: PlatformType;
  listing_url: string;
  listing_name: string;
  created_at: string;
}

export interface ReviewSentiment {
  positive_pct: number;
  neutral_pct: number;
  negative_pct: number;
  overall: "positive" | "neutral" | "negative" | "mixed";
}

export interface ReviewTheme {
  theme: string;
  frequency: "high" | "medium" | "low";
  sentiment: "positive" | "negative" | "mixed";
  example_quotes: string[];
}

export interface ReviewPoint {
  point: string;
  detail: string;
  mention_count: number;
}

export interface NotableReview {
  summary: string;
  sentiment: "positive" | "negative";
  rating: number | null;
  key_point: string;
}

export interface ProductReview {
  id: number;
  product_id: number;
  listing_id: number;
  platform_type: PlatformType;
  review_count: number;
  average_rating: number | null;
  sentiment_summary: ReviewSentiment;
  themes: ReviewTheme[];
  strengths: ReviewPoint[];
  weaknesses: ReviewPoint[];
  notable_reviews: NotableReview[];
  raw_analysis: Record<string, unknown>;
  analyzed_at: string;
}

export interface CrossPlatformTheme {
  theme: string;
  appears_on: string[];
  overall_sentiment: "positive" | "negative" | "mixed";
  insight: string;
}

export interface CrossPlatformPoint {
  point: string;
  detail: string;
  platforms: string[];
}

export interface PlatformComparison {
  platform: string;
  review_count: number;
  average_rating: number | null;
  sentiment: string;
  unique_insight: string;
}

export interface ActionableInsight {
  insight: string;
  priority: "high" | "medium" | "low";
  action: string;
  expected_impact: string;
}

export interface ProductAggregation {
  id: number;
  product_id: number;
  total_review_count: number;
  overall_sentiment: ReviewSentiment;
  cross_platform_themes: CrossPlatformTheme[];
  cross_platform_strengths: CrossPlatformPoint[];
  cross_platform_weaknesses: CrossPlatformPoint[];
  platform_comparison: PlatformComparison[];
  actionable_insights: ActionableInsight[];
  raw_aggregation: Record<string, unknown>;
  aggregated_at: string;
}

export interface ProductDetail extends Product {
  listings: ProductListing[];
  latest_reviews: ProductReview[];
  aggregation: ProductAggregation | null;
}

export interface AnalyzeResult {
  product_id: number;
  listings_analyzed: number;
  aggregation: ProductAggregation;
}

// Products API
export const fetchProducts = () =>
  api.get<Product[]>("/products").then((r) => r.data);
export const createProduct = (name: string, category: string, description?: string) =>
  api.post<Product>("/products", { name, category, description }).then((r) => r.data);
export const fetchProduct = (id: number) =>
  api.get<ProductDetail>(`/products/${id}`).then((r) => r.data);
export const updateProduct = (id: number, data: Partial<Pick<Product, "name" | "category" | "description">>) =>
  api.put<Product>(`/products/${id}`, data).then((r) => r.data);
export const deleteProduct = (id: number) =>
  api.delete(`/products/${id}`);
export const addProductListing = (productId: number, platform_type: string, listing_url: string, listing_name: string) =>
  api.post<ProductListing>(`/products/${productId}/listings`, { platform_type, listing_url, listing_name }).then((r) => r.data);
export const deleteProductListing = (productId: number, listingId: number) =>
  api.delete(`/products/${productId}/listings/${listingId}`);
export const analyzeProductReviews = (productId: number) =>
  api.post<AnalyzeResult>(`/products/${productId}/analyze`).then((r) => r.data);
export const fetchProductReviews = (productId: number) =>
  api.get<ProductReview[]>(`/products/${productId}/reviews`).then((r) => r.data);

// Scrape status
export interface ScrapeStatus {
  listing_id: number;
  platform_type: string;
  listing_name: string;
  total_review_count: number;
  average_rating: number | null;
  last_scraped_at: string | null;
  scrape_status: "idle" | "scraping" | "done" | "done_web_search" | "error";
  error_message: string | null;
  scraped_review_count: number;
  unanalyzed_count: number;
}

export const fetchScrapeStatus = (productId: number) =>
  api.get<ScrapeStatus[]>(`/products/${productId}/scrape-status`).then((r) => r.data);

// Ad Copy Generation
export interface AdCopy {
  headline: string;
  body: string;
  cta: string;
  rationale: string;
  data_sources: { review_themes: string[]; ad_patterns: string[] };
}

export interface AdCopyGeneration {
  id: number;
  product_id: number;
  copy_type: string;
  platform: string;
  tone: string;
  copies: AdCopy[];
  context_summary: {
    reviews_used: { total_count: number; themes: number; strengths: number };
    ad_library_used: { searches: number; patterns: number; trends: number };
  };
}

export interface AdCopyHistorySummary {
  id: number;
  product_id: number;
  copy_type: string;
  platform: string;
  tone: string;
  copies_count: number;
  user_rating: number | null;
  has_performance: boolean;
  created_at: string;
}

export interface AdCopyDetail {
  id: number;
  product_id: number;
  copy_type: string;
  platform: string;
  tone: string;
  generated_copies: AdCopy[];
  review_context: Record<string, unknown>;
  ad_library_context: Record<string, unknown>;
  user_feedback: { rating: number; selected_index?: number; notes?: string } | null;
  performance_data: { ctr?: number; roas?: number; cpc?: number; conversions?: number } | null;
  created_at: string;
}

export const generateAdCopy = (data: {
  product_id: number;
  copy_type?: string;
  platform?: string;
  tone?: string;
  custom_instruction?: string;
}) => api.post<AdCopyGeneration>("/ad-copy/generate", data).then((r) => r.data);

export const generateAdCopyWithMedia = (data: {
  product_id: number;
  copy_type?: string;
  platform?: string;
  tone?: string;
  custom_instruction?: string;
  media?: File;
  media_emphasis?: string;
}) => {
  const formData = new FormData();
  formData.append("product_id", String(data.product_id));
  if (data.copy_type) formData.append("copy_type", data.copy_type);
  if (data.platform) formData.append("platform", data.platform);
  if (data.tone) formData.append("tone", data.tone);
  if (data.custom_instruction) formData.append("custom_instruction", data.custom_instruction);
  if (data.media) formData.append("media", data.media);
  if (data.media_emphasis) formData.append("media_emphasis", data.media_emphasis);

  return api.post<AdCopyGeneration>("/ad-copy/generate-with-media", formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120000,
  }).then((r) => r.data);
};

export const fetchAdCopyHistory = (productId: number) =>
  api.get<AdCopyHistorySummary[]>(`/ad-copy/history/${productId}`).then((r) => r.data);

export const fetchAdCopyDetail = (id: number) =>
  api.get<AdCopyDetail>(`/ad-copy/${id}`).then((r) => r.data);

export const submitAdCopyFeedback = (id: number, feedback: {
  rating: number;
  selected_index?: number;
  notes?: string;
}) => api.put(`/ad-copy/${id}/feedback`, feedback).then((r) => r.data);

export const submitAdCopyPerformance = (id: number, data: {
  campaign_id?: number;
  ctr?: number;
  roas?: number;
  cpc?: number;
  conversions?: number;
  impressions?: number;
  clicks?: number;
  notes?: string;
}) => api.put(`/ad-copy/${id}/performance`, data).then((r) => r.data);

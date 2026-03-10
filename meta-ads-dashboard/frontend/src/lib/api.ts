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
  revenue: number;
  aov: number;
  cpa: number;
  purchase_count: number;
  // Cafe24 자사몰 퍼널 이벤트 (Meta Pixel 추적)
  landing_page_views: number;
  content_views: number;
  add_to_cart_count: number;
  initiate_checkout_count: number;
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
export type DatePeriod = "1d" | "7d" | "15d" | "30d" | "custom";

export interface CustomDateRange {
  since: string; // "YYYY-MM-DD"
  until: string; // "YYYY-MM-DD"
}
export const fetchCampaigns = () => api.get<Campaign[]>("/ads").then((r) => r.data);
export const fetchCampaignsByPeriod = (period: DatePeriod) =>
  api.get<Campaign[]>(`/meta/insights?period=${period}`).then((r) => r.data);
export const fetchCampaignsByCustomRange = (since: string, until: string) =>
  api.get<Campaign[]>(`/meta/insights?since=${since}&until=${until}`).then((r) => r.data);
export const createCampaign = (data: Partial<Campaign>) => api.post<Campaign>("/ads", data).then((r) => r.data);
export const updateCampaign = (id: number, data: Partial<Campaign>) =>
  api.put<Campaign>(`/ads/${id}`, data).then((r) => r.data);
export const deleteCampaign = (id: number) => api.delete(`/ads/${id}`);

// Analysis
export const analyzeAll = () =>
  api.post<{ campaigns: AnalysisResult[] }>("/analysis/analyze-all").then((r) => r.data);
export const analyzeSingle = (id: number) =>
  api.post<AnalysisResult>(`/analysis/analyze/${id}`).then((r) => r.data);

// 규칙 기반 자동 판단 + 복합 퍼널 진단 (AI 비용 없음, 즉시 실행)

export interface FunnelRates {
  click_to_landing: number;
  landing_to_view: number;
  view_to_cart: number;
  cart_to_checkout: number;
  checkout_to_purchase: number;
  click_to_purchase: number;
  click_to_cart: number;
}

export interface FunnelDiagnosis {
  stage: string;
  diagnosis: string;
  severity: "critical" | "warning" | "info" | "good";
  evidence: string;
  actions: string[];
  funnel_rates: FunnelRates;
}

export interface BenchmarkComparison {
  value: number;
  avg: number;
  median: number;
  p75: number;
  position: string;
  vs_avg_pct: number;
}

export interface SmartRecommendation {
  type: "learned" | "info";
  action_type?: string;
  diagnosis_stage?: string;
  message: string;
  expected_impact?: {
    roas: string;
    ctr: string;
  };
  confidence?: "high" | "medium" | "low";
  relevance_score?: number;
}

export interface CampaignJudgment {
  campaign_id: string | number;
  campaign_name: string;
  verdict: "SCALE" | "MAINTAIN" | "MODIFY" | "PAUSE";
  severity: "excellent" | "good" | "warning" | "urgent" | "critical";
  score: number;
  reasons: string[];
  recommendations: string[];
  funnel_diagnosis: FunnelDiagnosis[];
  metrics: {
    roas: number; ctr: number; cpc: number; frequency: number;
    spend: number; revenue: number; purchases: number; cpa: number; aov: number;
  };
  funnel: {
    clicks: number;
    landing_page_views: number;
    content_views: number;
    add_to_cart: number;
    initiate_checkout: number;
    purchases: number;
  };
  // 동적 벤치마크 대비 위치 (데이터 축적 후 활성화)
  benchmark_comparison?: Record<string, BenchmarkComparison>;
  // 학습 기반 스마트 추천 (과거 조치 효과 데이터에서 도출)
  smart_recommendations?: SmartRecommendation[];
}

export interface FunnelSummary {
  clicks: number;
  landing_page_views: number;
  content_views: number;
  add_to_cart: number;
  initiate_checkout: number;
  purchases: number;
  rates: FunnelRates;
}

export interface BenchmarkMetricSummary {
  avg: number;
  median: number;
  p75: number;
  p90: number;
  sample_count: number;
  suffix: string;
}

export interface JudgeSummary {
  total_campaigns: number;
  total_spend: number;
  total_revenue: number;
  total_purchases: number;
  overall_roas: number;
  profit_loss: number;
  is_profitable: boolean;
  avg_cpa: number;
  avg_aov: number;
  verdict_distribution: { SCALE: number; MAINTAIN: number; MODIFY: number; PAUSE: number };
  overall_funnel: FunnelSummary;
  top_bottlenecks: { stage: string; campaigns_affected: number }[];
  // 동적 벤치마크 정보
  has_benchmarks: boolean;
  benchmark_period: string | null;
  benchmark_summary: Record<string, BenchmarkMetricSummary | null> | null;
}

export interface JudgeResult {
  judgments: CampaignJudgment[];
  summary: JudgeSummary;
}

export const judgeAllCampaigns = (period: DatePeriod = "30d") =>
  api.post<JudgeResult>(`/analysis/judge-all?period=${period}`).then((r) => r.data);
export const judgeAllCampaignsByCustomRange = (since: string, until: string) =>
  api.post<JudgeResult>(`/analysis/judge-all?since=${since}&until=${until}`).then((r) => r.data);

// Phase 4: 성과 트렌드 + 개선 추적
export interface CampaignSnapshot {
  id: number;
  campaign_id: number;
  snapshot_date: string;
  roas: number;
  ctr: number;
  cpc: number;
  frequency: number;
  spend: number;
  revenue: number;
  purchases: number;
  cpa: number;
  aov: number;
}

export interface CampaignTrend {
  snapshots: CampaignSnapshot[];
  trend: "improving" | "stable" | "declining" | "insufficient_data";
  change_7d: { roas: number; ctr: number; cpc: number; cpa: number; spend: number; revenue: number } | null;
  change_30d: { roas: number; ctr: number; cpc: number; cpa: number; spend: number; revenue: number } | null;
}

export interface ImprovementEntry {
  id: number;
  campaign_id: number;
  action_type: string;
  action_description: string;
  before_roas: number | null;
  after_roas: number | null;
  before_ctr: number | null;
  after_ctr: number | null;
  result_verdict: "improved" | "unchanged" | "worsened" | null;
  measured_at: string | null;
  created_at: string;
}

export interface ImprovementHistory {
  improvements: ImprovementEntry[];
  success_rate: string;
  best_action: string | null;
  action_breakdown: Record<string, { success: number; total: number }>;
}

export const fetchCampaignTrend = (campaignId: number) =>
  api.get<CampaignTrend>(`/analysis/trends/${campaignId}`).then((r) => r.data);
export const logCampaignImprovement = (campaignId: number, action_type: string, description: string) =>
  api.post(`/analysis/improvements/${campaignId}`, { action_type, description }).then((r) => r.data);
export const fetchImprovementHistory = (campaignId: number) =>
  api.get<ImprovementHistory>(`/analysis/improvements/${campaignId}`).then((r) => r.data);
export const takeSnapshot = () =>
  api.post("/analysis/snapshot").then((r) => r.data);

// ─── 트렌드 인텔리전스 (동적 벤치마크 + 메트릭 트렌드 + 학습 데이터) ───

export interface MetricBenchmark {
  avg: number;
  median: number;
  p25: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  std_dev: number;
  sample_count: number;
  computed_at: string;
}

export interface BenchmarkData {
  period: string;
  metrics: Record<string, MetricBenchmark>;
}

export interface MetricTrend {
  direction: "improving" | "stable" | "declining" | "insufficient_data";
  current: number;
  change_7d: number;
  change_14d: number;
  change_30d: number;
  ma_7d: number;
  ma_14d: number;
  ma_30d: number;
  volatility: number;
  percentile_rank: number;
  computed_at: string;
}

export interface CampaignMetricTrends {
  campaign_id: number;
  ad_metrics: Record<string, MetricTrend>;
  funnel_metrics: Record<string, MetricTrend>;
}

export interface MetricHealthEntry {
  current_value: number;
  benchmark_avg: number;
  benchmark_median?: number;
  vs_avg: number;
  position: string;
  trend_direction: string;
  trend_7d_change: number;
  volatility?: number;
}

export interface DataMaturity {
  level: "초기" | "발전" | "성장" | "성숙";
  description: string;
  snapshots: number;
  unique_days: number;
  measured_improvements: number;
  recommendation: string;
}

export interface CampaignHealthReport {
  campaign_id: number;
  campaign_name: string;
  ad_metrics: Record<string, MetricHealthEntry>;
  funnel_metrics: Record<string, MetricHealthEntry>;
  learned_recommendations: string[];
  data_maturity: DataMaturity;
}

export interface ActionEffectivenessEntry {
  action_type: string;
  diagnosis_stage: string;
  times_applied: number;
  success_rate: string;
  avg_roas_impact: string;
  avg_ctr_impact: string;
  breakdown: {
    improved: number;
    unchanged: number;
    worsened: number;
  };
}

export interface RecomputeResult {
  success: boolean;
  computed: { benchmarks: number; trends: number; effectiveness: number };
  message: string;
}

// ─── 제품 원가 데이터 ───
export interface ProductCost {
  id: number;
  campaign_id: number | null;
  meta_campaign_id: string | null;
  campaign_name: string;
  product_name: string;
  cost_price: number;
}

export const fetchProductCosts = () =>
  api.get<ProductCost[]>("/analysis/product-costs").then((r) => r.data);

// ─── 수익성 분석 (원가 기반) ───
export interface ProfitabilityResult {
  campaign_id: number;
  campaign_name: string;
  product_name: string;
  cost_price: number;
  purchases: number;
  revenue: number;
  ad_spend: number;
  cogs: number;
  gross_profit: number;
  net_profit: number;
  gross_margin: number;
  net_margin: number;
  true_roi: number;
  roas: number;
  break_even_roas: number;
  is_profitable: boolean;
}

export interface ProfitabilitySummary {
  total_revenue: number;
  total_cogs: number;
  total_ad_spend: number;
  total_gross_profit: number;
  total_net_profit: number;
  overall_net_margin: number;
  overall_true_roi: number;
  profitable_campaigns: number;
  total_campaigns: number;
  is_profitable: boolean;
}

export interface ProfitabilityData {
  period: string;
  campaigns: ProfitabilityResult[];
  summary: ProfitabilitySummary;
}

export const fetchProfitability = (period: DatePeriod = "30d") =>
  api.get<ProfitabilityData>(`/analysis/profitability?period=${period}`).then((r) => r.data);
export const fetchProfitabilityByCustomRange = (since: string, until: string) =>
  api.get<ProfitabilityData>(`/analysis/profitability?since=${since}&until=${until}`).then((r) => r.data);

export const fetchBenchmarks = (period: string = "30d") =>
  api.get<BenchmarkData>(`/analysis/benchmarks?period=${period}`).then((r) => r.data);
export const fetchMetricTrends = (campaignId: number) =>
  api.get<CampaignMetricTrends>(`/analysis/metric-trends/${campaignId}`).then((r) => r.data);
export const fetchHealthReport = (campaignId: number) =>
  api.get<CampaignHealthReport>(`/analysis/health-report/${campaignId}`).then((r) => r.data);
export const fetchSmartRecommendations = (campaignId: number) =>
  api.get<{ campaign_id: number; recommendations: SmartRecommendation[] }>(`/analysis/smart-recommendations/${campaignId}`).then((r) => r.data);
export const fetchActionEffectiveness = () =>
  api.get<{ actions: ActionEffectivenessEntry[]; total: number }>("/analysis/action-effectiveness").then((r) => r.data);
export const recomputeIntelligence = () =>
  api.post<RecomputeResult>("/analysis/recompute-intelligence").then((r) => r.data);

// ─── 크로스 검증 (Meta Pixel vs Cafe24 Admin API) ───

export interface CrossValidationDiscrepancy {
  type: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  action: string;
}

export interface CrossValidationCorrectedMetrics {
  corrected_roas: number;
  roas_source: "meta_pixel" | "cafe24_actual";
  meta_roas: number;
  cafe24_roas: number | null;
  corrected_cpa: number;
  cpa_source: "meta_pixel" | "cafe24_actual";
  corrected_aov: number;
  aov_source: "meta_pixel" | "cafe24_actual";
  total_spend: number;
  best_revenue: number;
  best_purchases: number;
  confidence: "high" | "low";
  note: string;
}

export interface CrossValidationQuality {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  deductions: { reason: string; points: number }[];
  summary: string;
}

export interface CrossValidationRecommendation {
  priority: "critical" | "warning" | "info";
  title: string;
  action: string;
  expected_impact: string;
}

export interface UtmMatchedCampaign {
  campaign_name: string;
  meta_campaign_id: string | null;
  meta_spend: number;
  meta_revenue: number;
  meta_purchases: number;
  meta_roas: number;
  cafe24_orders: number;
  cafe24_revenue: number;
  cafe24_roas: number;
  revenue_gap: number;
  revenue_gap_pct: number;
  purchase_gap: number;
}

export interface UtmUnmatchedMeta {
  campaign_name: string;
  meta_spend: number;
  meta_revenue: number;
  meta_purchases: number;
  reason: string;
}

export interface CrossValidationResult {
  period: { start: string; end: string };
  meta_pixel: {
    total_campaigns: number;
    total_spend: number;
    total_revenue: number;
    total_purchases: number;
    overall_roas: number;
    total_clicks: number;
    avg_cpa: number;
    avg_aov: number;
    funnel: {
      landing_page_views: number;
      content_views: number;
      add_to_cart: number;
      initiate_checkout: number;
      purchases: number;
    };
    funnel_empty: boolean;
  };
  cafe24_actual: {
    total_orders: number;
    total_revenue: number;
    meta_attributed_orders: number;
    meta_attributed_revenue: number;
    non_meta_orders: number;
    no_utm_orders: number;
    no_utm_rate: number;
    by_campaign: Record<string, { orders: number; revenue: number }>;
    avg_order_value: number;
  };
  utm_matching: {
    matched: UtmMatchedCampaign[];
    unmatched_meta: UtmUnmatchedMeta[];
    unmatched_cafe24: { utm_campaign: string; orders: number; revenue: number; reason: string }[];
    match_rate: number;
    total_matched: number;
    total_meta: number;
  };
  discrepancies: CrossValidationDiscrepancy[];
  corrected_metrics: CrossValidationCorrectedMetrics;
  quality_score: CrossValidationQuality;
  recommendations: CrossValidationRecommendation[];
  validated_at: string;
}

export interface SyncAndValidateResult {
  sync: {
    synced: number;
    meta_attributed: number;
    total_revenue: number;
  } | { skipped: true; reason: string };
  validation: CrossValidationResult | null;
  message: string;
}

export const fetchCrossValidation = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return api.get<CrossValidationResult>(`/analysis/cross-validate?${params}`).then((r) => r.data);
};

export const syncAndValidate = () =>
  api.post<SyncAndValidateResult>("/analysis/sync-and-validate").then((r) => r.data);

// ─── UTM 관리 ───

export interface UtmAdDetail {
  ad_id: string;
  ad_name: string;
  url_tags: string;
  status: "configured" | "missing";
}

export interface UtmCampaignStatus {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  total_ads: number;
  utm_configured: boolean;
  ads_with_utm: number;
  ads_without_utm: number;
  ads: UtmAdDetail[];
}

export interface UtmDiagnosisResult {
  summary: {
    total_campaigns: number;
    with_utm: number;
    without_utm: number;
    coverage_pct: number;
  };
  campaigns: UtmCampaignStatus[];
  recommended_utm_template: string;
}

export interface UtmApplyResult {
  updated: number;
  failed: number;
  skipped: number;
  details: {
    updated: { ad_id: string; ad_name: string; url_tags: string }[];
    failed: { ad_id: string; ad_name: string; error: string }[];
    skipped: { ad_id: string; ad_name: string; reason: string }[];
  };
}

export const fetchUtmStatus = () =>
  api.get<UtmDiagnosisResult>("/meta/utm/status").then((r) => r.data);
export const applyUtmToAllCampaigns = (campaignIds?: string[]) =>
  api.post<UtmApplyResult>("/meta/utm/apply", { campaign_ids: campaignIds || [] }).then((r) => r.data);

// ─── Pixel 진단 ───

export interface PixelInfo {
  pixel_count: number;
  pixels: {
    id: string;
    name: string;
    creation_time: string;
    last_fired_time: string | null;
    is_active: boolean;
  }[];
}

export interface PixelEventStatus {
  purchase: "active" | "inactive";
  view_content: "active" | "inactive";
  add_to_cart: "active" | "inactive";
  initiate_checkout: "active" | "inactive";
  landing_page_view: "active" | "inactive";
}

export interface Cafe24PixelGuideStep {
  step: number;
  title: string;
  description: string;
  url?: string;
  path?: string;
  pixel_id?: string;
  events?: { event: string; page: string; description: string }[];
  important?: boolean;
  tool_url?: string;
}

export interface Cafe24PixelGuide {
  overview: string;
  steps: Cafe24PixelGuideStep[];
  alternative_method: {
    title: string;
    description: string;
    base_code: string;
    event_codes: Record<string, string>;
  };
}

export interface PixelDiagnosticsResult {
  pixel_info: PixelInfo | { error: string } | null;
  event_status: PixelEventStatus | null;
  funnel_check: {
    campaigns_checked: number;
    total_clicks: number;
    total_purchases: number;
    funnel_events: Record<string, number>;
    funnel_empty: boolean;
    has_purchases_but_no_funnel: boolean;
  } | null;
  cafe24_guide: Cafe24PixelGuide | null;
  overall_status: "healthy" | "warning" | "critical" | "disconnected" | "no_account" | "unknown";
  issues: { severity: "critical" | "warning"; message: string }[];
  actions: string[];
}

export const fetchPixelDiagnostics = () =>
  api.get<PixelDiagnosticsResult>("/meta/pixel/diagnostics").then((r) => r.data);

// ─── 데이터 파이프라인 통합 체크 ───

export interface PipelineChecklistItem {
  id: string;
  title: string;
  status: "done" | "todo" | "partial" | "unknown";
  priority: number;
  action: string | null;
  details?: Record<string, unknown> | null;
}

export interface PipelineCheckResult {
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  checklist: PipelineChecklistItem[];
  next_action: {
    title: string;
    action: string | null;
    priority: number;
  } | null;
  connections: {
    meta: boolean;
    cafe24: boolean;
  };
  pixel: Record<string, unknown>;
  utm: Record<string, unknown>;
  validation: {
    quality_score: number;
    grade: string;
    discrepancy_count?: number;
    critical_issues?: number;
    corrected_roas?: number;
    confidence?: string;
  };
  checked_at: string;
}

export const fetchPipelineCheck = () =>
  api.get<PipelineCheckResult>("/meta/pipeline/check").then((r) => r.data);

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
export const fetchCampaignsByAccountCustomRange = (since: string, until: string, accountId: string) =>
  api.get<Campaign[]>(`/meta/insights?since=${since}&until=${until}&account_id=${accountId}`).then((r) => r.data);

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
  primary_text: string;
  headline: string;
  description: string;
  body: string;  // 하위 호환 (primary_text와 동일)
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
  has_media?: boolean;
  media_type?: "image" | "video" | null;
  has_video_analysis?: boolean;
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
    timeout: 600000, // 10분 (대용량 영상 업로드 + Gemini 분석 + Claude 카피 생성)
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

// ─── Cafe24 연동 ───

export interface Cafe24Config {
  configured: boolean;
  mall_id: string | null;
  client_id_set: boolean;
  redirect_uri: string;
}

export interface Cafe24Status {
  connected: boolean;
  mall_id?: string;
  token_expires_at?: string;
  token_valid?: boolean;
  refresh_valid?: boolean;
  refresh_expires_at?: string;
  scopes?: string;
  updated_at?: string;
}

export interface Cafe24Order {
  order_id: string;
  order_date: string;
  total_amount: number;
  item_count: number;
  product_names: string;
  payment_method: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
}

export interface Cafe24SalesSummary {
  period: { start: string; end: string };
  total_orders: number;
  total_revenue: number;
  total_items: number;
  avg_order_value: number;
  payment_methods: Record<string, number>;
  utm_sources: Record<string, number>;
  daily_revenue: Record<string, { revenue: number; orders: number }>;
}

export interface Cafe24SyncResult {
  synced: number;
  period: { start: string; end: string };
  meta_attributed: number;
}

export interface Cafe24MetaOrders {
  total_meta_orders: number;
  total_meta_revenue: number;
  by_campaign: {
    campaign_name: string;
    orders: number;
    revenue: number;
    items: number;
    avg_order_value: number;
  }[];
  all_orders: number;
  meta_attribution_rate: string;
}

export const fetchCafe24Config = () =>
  api.get<Cafe24Config>("/cafe24/config").then((r) => r.data);
export const saveCafe24Config = (mall_id: string, client_id: string, client_secret: string) =>
  api.post("/cafe24/config", { mall_id, client_id, client_secret }).then((r) => r.data);
export const fetchCafe24AuthUrl = () =>
  api.get<{ url: string }>("/cafe24/auth-url").then((r) => r.data);
export const fetchCafe24Status = () =>
  api.get<Cafe24Status>("/cafe24/status").then((r) => r.data);
export const disconnectCafe24 = () =>
  api.post("/cafe24/disconnect").then((r) => r.data);
export const fetchCafe24Orders = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return api.get<{ orders: Cafe24Order[]; count: number }>(`/cafe24/orders?${params}`).then((r) => r.data);
};
export const fetchCafe24SalesSummary = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return api.get<Cafe24SalesSummary>(`/cafe24/sales-summary?${params}`).then((r) => r.data);
};
export const syncCafe24Orders = () =>
  api.post<Cafe24SyncResult>("/cafe24/sync").then((r) => r.data);
export const fetchCafe24MetaOrders = (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return api.get<Cafe24MetaOrders>(`/cafe24/meta-orders?${params}`).then((r) => r.data);
};

// ─── 일일 리뷰 액션 큐 (자동 캠페인 리뷰 → 승인 → 실행) ───

export interface ActionQueueItem {
  id: number;
  review_run_id: number;
  campaign_name: string;
  meta_campaign_id: string;
  action_type: "pause" | "budget_increase" | "budget_decrease" | "resume" | "targeting_broaden" | "creative_refresh" | "early_warning" | "early_kill";
  current_value: string;
  proposed_value: string;
  reason: string;
  verdict: string;
  score: number;
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "manual_pending";
  created_at: string;
  acted_at: string | null;
  executed_at: string | null;
  execution_result: string | null;
  // ─── 진단 데이터 (campaign-judge.js 결과) ───
  recommendations_json: string | null;
  funnel_diagnosis_json: string | null;
  smart_recommendations_json: string | null;
  benchmark_comparison_json: string | null;
  profitability_json: string | null;
  adset_id: string | null;
  improvement_log_id: number | null;
  trend_direction: "improving" | "declining" | "flat" | null;
  early_signal_json: string | null;
}

export interface EarlySignalItem {
  name: string;
  key: string;
  value: number | null;
  score: number | null;
  weight: number;
  benchmark: { fail: number; success: number };
  skipped: boolean;
}

export interface EarlySignalData {
  score: number;
  grade: "Promising" | "Watch" | "At Risk" | "Kill";
  color: string;
  emoji: string;
  signals: EarlySignalItem[];
  recommendations: string[];
  isEarlyKill: boolean;
  reason: string;
  dayCount: number;
  spend: number;
  purchases: number;
}

export interface FunnelDiagnosis {
  stage: string;
  diagnosis: string;
  severity: "critical" | "warning" | "info" | "good";
  evidence: string;
  actions: string[];
}

export interface ImprovementResult {
  measured: boolean;
  before_roas?: number;
  after_roas?: number;
  before_ctr?: number;
  after_ctr?: number;
  roas_change?: number | null;
  ctr_change?: number | null;
  result_verdict?: "improved" | "unchanged" | "worsened" | null;
  created_at?: string;
  measured_at?: string;
  message?: string;
}

export interface LearningStatus {
  maturity: {
    stage: string;
    days_tracked: number;
    improvements_measured: number;
    recommendations_available: boolean;
  } | null;
  effectiveness: {
    action_type: string;
    diagnosis_stage: string;
    times_applied: number;
    times_improved: number;
    times_unchanged: number;
    times_worsened: number;
    success_rate: number;
    avg_roas_change: number;
  }[];
  pending_measurements: number;
}

export interface ReviewRun {
  id: number;
  run_date: string;
  total_campaigns: number;
  actions_generated: number;
  actions_approved: number;
  actions_executed: number;
  summary_json: string | null;
  created_at: string;
}

export interface NotificationConfig {
  id: number;
  channel: string;
  webhook_url: string;
  enabled: number;
  created_at: string;
}

export interface ReviewResult {
  run_id: number | null;
  total_campaigns: number;
  actions_generated: number;
  actions: ActionQueueItem[];
  skipped?: boolean;
  reason?: string;
}

export interface ExecuteResult {
  executed: number;
  failed: number;
  results: { success: boolean; action_id: number; error?: string }[];
}

export const fetchPendingActions = () =>
  api.get<ActionQueueItem[]>("/actions/pending").then((r) => r.data);
export const fetchAllActions = (status?: string, limit?: number) => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (limit) params.set("limit", String(limit));
  return api.get<ActionQueueItem[]>(`/actions?${params}`).then((r) => r.data);
};
export const fetchReviewRuns = (limit?: number) =>
  api.get<ReviewRun[]>(`/actions/runs${limit ? `?limit=${limit}` : ""}`).then((r) => r.data);
export const approveAction = (id: number) =>
  api.post(`/actions/${id}/approve`).then((r) => r.data);
export const rejectAction = (id: number) =>
  api.post(`/actions/${id}/reject`).then((r) => r.data);
export const approveAllActions = () =>
  api.post("/actions/approve-all").then((r) => r.data);
export const executeAction = (id: number) =>
  api.post(`/actions/${id}/execute`).then((r) => r.data);
export const completeManualAction = (id: number) =>
  api.post(`/actions/${id}/complete-manual`).then((r) => r.data);
export const executeAllActions = () =>
  api.post<ExecuteResult>("/actions/execute-all").then((r) => r.data);
export const triggerDailyReview = () =>
  api.post<ReviewResult>("/actions/run-review").then((r) => r.data);
export const fetchNotificationConfig = () =>
  api.get<NotificationConfig[]>("/actions/notification-config").then((r) => r.data);
export const saveNotificationConfig = (channel: string, webhook_url: string, enabled: boolean = true) =>
  api.post("/actions/notification-config", { channel, webhook_url, enabled }).then((r) => r.data);
export const testNotification = (webhook_url: string, channel: string = "openclaw") =>
  api.post("/actions/notification-test", { webhook_url, channel }).then((r) => r.data);
export const fetchImprovementResult = (actionId: number) =>
  api.get<ImprovementResult>(`/actions/${actionId}/improvement`).then((r) => r.data);
export const fetchLearningStatus = () =>
  api.get<LearningStatus>("/actions/learning-status").then((r) => r.data);

// ─── Campaign Publish (Meta 캠페인 자동생성) ───

export interface FacebookPage {
  id: string;
  name: string;
  access_token: string;
  category: string;
}

export interface CampaignPublishRequest {
  ad_copy_generation_id: number;
  copy_index: number;
  campaign_name: string;
  objective: string;
  daily_budget: number;
  targeting: {
    geo_locations: { countries: string[] };
    age_min: number;
    age_max: number;
  };
  optimization_goal: string;
  start_time: string;
  page_id: string;
  link_url: string;
  cta_type: string;
}

export interface PublishResult {
  success: boolean;
  meta_campaign_id?: string;
  meta_adset_id?: string;
  meta_creative_id?: string;
  meta_ad_id?: string;
  published_campaign_id?: number;
  error?: string;
  partial_results?: Record<string, string>;
}

export const fetchFacebookPages = () =>
  api.get<FacebookPage[]>("/campaign-publish/pages").then((r) => r.data);

export const publishCampaignToMeta = (data: CampaignPublishRequest) =>
  api.post<PublishResult>("/campaign-publish/publish", data, { timeout: 600000 }).then((r) => r.data); // 10분 (대용량 비디오 Meta 청크 업로드 + 처리 대기)

// ─── 학습 기반 추천 설정 ───

export interface RecommendedSetting {
  value: string | number;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

export interface CampaignRecommendations {
  recommended_budget: RecommendedSetting | null;
  recommended_objective: RecommendedSetting | null;
  recommended_targeting: RecommendedSetting | null;
  benchmarks: {
    avg_roas: number;
    avg_ctr: number;
    avg_cpc: number;
    avg_cpa: number;
  } | null;
  data_maturity: string;
  maturity_description: string;
  success_campaign_count: number;
}

export const fetchCampaignRecommendations = () =>
  api.get<CampaignRecommendations>("/campaign-publish/recommendations").then((r) => r.data);

// ─── 포스트모템 분석 ───

export interface PostMortemDailyMetric {
  date: string;
  value: number;
}

export interface FactorDetail {
  current: number;
  avg: number;
  min: number;
  max: number;
  trend: "up" | "down" | "flat";
  daily_values: PostMortemDailyMetric[];
  verdict: "good" | "moderate" | "warning" | "critical" | "unknown";
}

export interface FunnelStage {
  name: string;
  count: number;
  conversion_rate?: number;
  drop_off_rate?: number;
}

export interface CampaignPostMortem {
  campaign: {
    name: string;
    meta_campaign_id: string;
    root_cause: string;
    pause_reason: string;
    pause_date: string;
    score: number;
    verdict: string;
  };
  daily_metrics: Array<{
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    ctr: number;
    cpc: number;
    frequency: number;
    roas: number;
    revenue: number;
    purchases: number;
  }>;
  factor_analysis: {
    roas: FactorDetail;
    ctr: FactorDetail;
    cpc: FactorDetail;
    frequency: FactorDetail;
    spend?: { total: number; daily_values: PostMortemDailyMetric[] };
    revenue?: { total: number; daily_values: PostMortemDailyMetric[] };
    purchases?: { total: number; daily_values: PostMortemDailyMetric[] };
  };
  funnel_analysis: {
    stages: FunnelStage[];
    bottleneck: string | null;
    totals: Record<string, number>;
  } | null;
  diagnosis: {
    root_cause?: string;
    funnel_diagnosis?: unknown;
    benchmark_comparison?: unknown;
    profitability?: unknown;
    recommendations?: unknown;
  };
  assessment: {
    strengths: string[];
    weaknesses: string[];
    missed_signals: string[];
  };
  improvement_history: Array<{
    action_type: string;
    action_description: string;
    before_roas: number | null;
    after_roas: number | null;
    result_verdict: string | null;
    created_at: string;
  }>;
  recovery_plan: {
    status: string;
    cooling_days: number;
    resume_date: string | null;
    attempt_count: number;
    max_attempts: number;
    strategies: string[];
  };
}

export interface PostMortemSummary {
  campaign_count: number;
  root_cause_distribution: Record<string, number>;
  total_spend_7d: number;
  total_revenue_7d: number;
  overall_roas_7d: number;
  avg_metrics: Record<string, number>;
  common_weaknesses: Array<{ weakness: string; campaign_count: number }>;
  bottleneck_distribution: Record<string, number>;
}

export interface PostMortemLesson {
  id: number;
  root_cause: string;
  lesson_type: string;
  description: string;
  evidence_json: string;
  campaign_count: number;
  confidence: string;
  created_at: string;
}

export interface PostMortemReport {
  postMortems: CampaignPostMortem[];
  summary: PostMortemSummary | null;
  lessons: PostMortemLesson[];
}

export const generatePostMortemReport = () =>
  api.post<PostMortemReport>("/analysis/postmortem").then((r) => r.data);

export const fetchPostMortemLessons = () =>
  api.get<{ lessons: PostMortemLesson[] }>("/analysis/postmortem-lessons").then((r) => r.data);

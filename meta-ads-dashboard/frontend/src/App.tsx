// Meta Ads Intelligence Dashboard — 메인 앱
import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Megaphone,
  Users,
  TrendingUp,
  RefreshCw,
  Plus,
  Brain,
  Menu,
  X,
  Settings as SettingsIcon,
  Library,
  ShoppingBag,
  PenTool,
  ListChecks,
} from "lucide-react";
import DashboardSummary from "./components/Dashboard";
import AdPerformanceTable from "./components/AdPerformanceTable";
import AIRecommendations from "./components/AIRecommendations";
import FunnelChart from "./components/FunnelChart";
import RoasTrendChart from "./components/RoasTrendChart";
import CompetitorInsights from "./components/CompetitorInsights";
import TrendsFeed from "./components/TrendsFeed";
import CampaignEditor from "./components/CampaignEditor";
import Settings from "./components/Settings";
import AdLibraryReviewPage from "./components/AdLibraryReview";
import ProductReviewAnalysisPage from "./components/ProductReviewAnalysis";
import AdCopyGeneratorPage from "./components/AdCopyGenerator";
import ActionQueue from "./components/ActionQueue";
import {
  Campaign,
  AnalysisResult,
  Competitor,
  TrendsData,
  DatePeriod,
  MetaBusiness,
  MetaAdAccount,
  fetchCampaigns,
  fetchCampaignsByPeriod,
  fetchCampaignsByAccount,
  fetchCompetitors,
  fetchTrends,
  analyzeAll,
  judgeAllCampaigns,
  CampaignJudgment,
  JudgeSummary,
  fetchMetaBusinesses,
  fetchBusinessAdAccounts,
  fetchMetaAdAccounts,
} from "./lib/api";

type Page = "dashboard" | "campaigns" | "competitors" | "trends" | "ad-library" | "product-reviews" | "ad-copy" | "actions" | "settings";

const NAV_ITEMS: { page: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "campaigns", label: "Campaigns", icon: Megaphone },
  { page: "competitors", label: "Competitors", icon: Users },
  { page: "trends", label: "Trends", icon: TrendingUp },
  { page: "ad-library", label: "Ad Library", icon: Library },
  { page: "product-reviews", label: "Reviews", icon: ShoppingBag },
  { page: "ad-copy", label: "Ad Copy", icon: PenTool },
  { page: "actions", label: "Actions", icon: ListChecks },
  { page: "settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [isNewCampaign, setIsNewCampaign] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DatePeriod>("30d");
  const [activeOnly, setActiveOnly] = useState(true);
  const [businesses, setBusinesses] = useState<MetaBusiness[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [judgments, setJudgments] = useState<CampaignJudgment[]>([]);
  const [judgeSummary, setJudgeSummary] = useState<JudgeSummary | null>(null);
  const [judgingAll, setJudgingAll] = useState(false);

  const loadCampaigns = useCallback(async (period?: DatePeriod, accountId?: string) => {
    setLoadingCampaigns(true);
    try {
      const p = period || dateRange;
      const acct = accountId || selectedAccountId;
      const data = acct
        ? await fetchCampaignsByAccount(p, acct).catch(() => fetchCampaigns())
        : await fetchCampaignsByPeriod(p).catch(() => fetchCampaigns());
      setCampaigns(data);
    } catch (err) {
      console.error("Failed to load campaigns:", err);
    } finally {
      setLoadingCampaigns(false);
    }
  }, [dateRange, selectedAccountId]);

  const loadCompetitors = useCallback(async () => {
    try {
      const data = await fetchCompetitors();
      setCompetitors(data);
    } catch (err) {
      console.error("Failed to load competitors:", err);
    }
  }, []);

  const loadTrends = useCallback(async () => {
    try {
      const data = await fetchTrends();
      if (data.latest) {
        setTrends({ ...data.latest, last_updated: data.last_updated });
      }
    } catch (err) {
      console.error("Failed to load trends:", err);
    }
  }, []);

  // 비즈니스 포트폴리오 로드 (기본값: 오하이 갤럭시 액정보호필름 케이스 + 오하이 Ohi)
  const DEFAULT_BUSINESS_ID = "1416669939538806";
  const DEFAULT_ACCOUNT_ID = "act_24178740038427052";

  const loadBusinesses = useCallback(async () => {
    try {
      const data = await fetchMetaBusinesses();
      setBusinesses(data);

      // 기본 비즈니스 선택 + 해당 광고계정 로드
      const defaultBiz = data.find((b: MetaBusiness) => b.id === DEFAULT_BUSINESS_ID);
      if (defaultBiz && !selectedBusinessId) {
        setSelectedBusinessId(DEFAULT_BUSINESS_ID);
        const accounts = await fetchBusinessAdAccounts(DEFAULT_BUSINESS_ID);
        setAdAccounts(accounts);
        // 기본 광고계정 선택
        const defaultAcct = accounts.find((a: MetaAdAccount) => a.id === DEFAULT_ACCOUNT_ID);
        if (defaultAcct && !selectedAccountId) {
          setSelectedAccountId(DEFAULT_ACCOUNT_ID);
        }
      } else {
        const allAccounts = await fetchMetaAdAccounts();
        setAdAccounts(allAccounts);
      }
    } catch {
      // Meta 미연결 시 무시
    }
  }, []);

  const handleBusinessChange = async (businessId: string) => {
    setSelectedBusinessId(businessId);
    setSelectedAccountId("");
    if (businessId) {
      try {
        const accounts = await fetchBusinessAdAccounts(businessId);
        setAdAccounts(accounts);
      } catch {
        setAdAccounts([]);
      }
    } else {
      // "전체" 선택 시 모든 광고계정 표시
      try {
        const allAccounts = await fetchMetaAdAccounts();
        setAdAccounts(allAccounts);
      } catch {
        setAdAccounts([]);
      }
    }
  };

  const handleAccountChange = (accountId: string) => {
    setSelectedAccountId(accountId);
    loadCampaigns(dateRange, accountId);
  };

  // URL 파라미터 처리 (OAuth 콜백 + 알림 링크)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetPage = params.get("page");
    const targetTab = params.get("tab");
    if (targetPage === "settings") {
      setPage("settings");
    } else if (targetTab === "actions") {
      setPage("actions");
    }
    if (targetPage || targetTab) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      // 비즈니스/광고계정 먼저 로드 → 기본값 설정 후 캠페인 로드
      await loadBusinesses();
      await loadCampaigns(dateRange, DEFAULT_ACCOUNT_ID);
      loadCompetitors();
      loadTrends();
      // 초기 로드 시 판단도 자동 실행
      try {
        setJudgingAll(true);
        const result = await judgeAllCampaigns(dateRange);
        setJudgments(result.judgments || []);
        setJudgeSummary(result.summary || null);
      } catch { /* 판단 실패해도 대시보드는 정상 표시 */ }
      finally { setJudgingAll(false); }
    };
    init();
  }, [loadCampaigns, loadCompetitors, loadTrends, loadBusinesses]);

  const handleAnalyzeAll = async () => {
    setAnalyzingAll(true);
    try {
      const result = await analyzeAll();
      setAnalysisResults(result.campaigns || []);
      setLastUpdated(new Date().toISOString());
      await loadCampaigns();
    } catch (err) {
      console.error("Failed to analyze campaigns:", err);
    } finally {
      setAnalyzingAll(false);
    }
  };

  const handleJudgeAll = async () => {
    setJudgingAll(true);
    try {
      const result = await judgeAllCampaigns(dateRange);
      setJudgments(result.judgments || []);
      setJudgeSummary(result.summary || null);
      setLastUpdated(new Date().toISOString());
      await loadCampaigns();
    } catch (err) {
      console.error("Failed to judge campaigns:", err);
    } finally {
      setJudgingAll(false);
    }
  };

  const handleDateRangeChange = async (period: DatePeriod) => {
    setDateRange(period);
    await loadCampaigns(period);
    // 기간 변경 시 판단 데이터도 해당 기간으로 자동 리프레시
    try {
      setJudgingAll(true);
      const result = await judgeAllCampaigns(period);
      setJudgments(result.judgments || []);
      setJudgeSummary(result.summary || null);
    } catch (err) {
      console.error("Failed to refresh judgments for period:", err);
    } finally {
      setJudgingAll(false);
    }
  };

  const handleRefreshAll = async () => {
    await loadCampaigns();
    await loadCompetitors();
    await loadTrends();
    setLastUpdated(new Date().toISOString());
  };

  const filteredCampaigns = activeOnly ? campaigns.filter((c) => c.status === "active") : campaigns;

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return (
          <div className="space-y-5">
            <DashboardSummary
              campaigns={filteredCampaigns}
              dateRange={dateRange}
              onDateRangeChange={handleDateRangeChange}
              loading={loadingCampaigns}
              activeOnly={activeOnly}
              onActiveOnlyChange={setActiveOnly}
              businesses={businesses}
              selectedBusinessId={selectedBusinessId}
              onBusinessChange={handleBusinessChange}
              adAccounts={adAccounts}
              selectedAccountId={selectedAccountId}
              onAccountChange={handleAccountChange}
            />
            <AdPerformanceTable campaigns={filteredCampaigns} onEdit={setEditingCampaign} loading={loadingCampaigns} />
            <AIRecommendations results={analysisResults} loading={analyzingAll} onAnalyzeAll={handleAnalyzeAll} judgments={judgments} judgeSummary={judgeSummary} judgingLoading={judgingAll} onJudgeAll={handleJudgeAll} />
            <FunnelChart judgments={judgments} />
            <RoasTrendChart campaigns={filteredCampaigns} />
          </div>
        );
      case "campaigns":
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Campaigns</h2>
              <button
                onClick={() => { setIsNewCampaign(true); setEditingCampaign({} as Campaign); }}
                className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" /> New Campaign
              </button>
            </div>
            <AdPerformanceTable campaigns={filteredCampaigns} onEdit={setEditingCampaign} loading={loadingCampaigns} />
            <AIRecommendations results={analysisResults} loading={analyzingAll} onAnalyzeAll={handleAnalyzeAll} judgments={judgments} judgeSummary={judgeSummary} judgingLoading={judgingAll} onJudgeAll={handleJudgeAll} />
          </div>
        );
      case "competitors":
        return <CompetitorInsights competitors={competitors} onRefresh={loadCompetitors} />;
      case "trends":
        return <TrendsFeed trends={trends} onRefresh={(data) => setTrends(data)} />;
      case "ad-library":
        return <AdLibraryReviewPage />;
      case "product-reviews":
        return <ProductReviewAnalysisPage />;
      case "ad-copy":
        return <AdCopyGeneratorPage />;
      case "actions":
        return <ActionQueue />;
      case "settings":
        return <Settings />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navbar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-1 hover:bg-gray-100 rounded"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <Brain className="w-6 h-6 text-blue-600" />
              <h1 className="text-lg font-bold text-gray-900">Meta Ads Intelligence</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-400 hidden sm:inline">
                Last updated: {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={handleRefreshAll}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-30 w-56 bg-white border-r border-gray-200 pt-16 lg:pt-0 transition-transform duration-200`}
        >
          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map(({ page: p, label, icon: Icon }) => (
              <button
                key={p}
                onClick={() => { setPage(p); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors ${
                  page === p
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black bg-opacity-25 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-6 min-w-0">{renderPage()}</main>
      </div>

      {/* Campaign Editor Modal */}
      {editingCampaign && (
        <CampaignEditor
          campaign={editingCampaign}
          isNew={isNewCampaign}
          onClose={() => { setEditingCampaign(null); setIsNewCampaign(false); }}
          onSaved={() => { loadCampaigns(); setEditingCampaign(null); setIsNewCampaign(false); }}
        />
      )}
    </div>
  );
}

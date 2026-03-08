// 캠페인 퍼블리시 모달 — AI 카피를 Meta 광고로 자동 생성하는 3단계 위저드
import { useState, useEffect } from "react";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  Target,
  DollarSign,
  Globe,
  Film,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import {
  AdCopy,
  FacebookPage,
  CampaignPublishRequest,
  PublishResult,
  CampaignRecommendations,
  fetchFacebookPages,
  publishCampaignToMeta,
  fetchCampaignRecommendations,
} from "../lib/api";

interface Props {
  copy: AdCopy;
  copyIndex: number;
  generationId: number;
  hasMedia: boolean;
  mediaType?: "image" | "video";
  onClose: () => void;
  onPublished: () => void;
}

const OBJECTIVES = [
  { value: "OUTCOME_TRAFFIC", label: "트래픽", desc: "웹사이트 방문 유도" },
  { value: "OUTCOME_LEADS", label: "리드", desc: "잠재 고객 정보 수집" },
  { value: "OUTCOME_SALES", label: "매출", desc: "구매/전환 유도" },
  { value: "OUTCOME_AWARENESS", label: "인지도", desc: "브랜드 인지도 향상" },
  { value: "OUTCOME_ENGAGEMENT", label: "참여", desc: "게시물 참여 유도" },
];

const OPTIMIZATION_GOALS = [
  { value: "LINK_CLICKS", label: "링크 클릭" },
  { value: "IMPRESSIONS", label: "노출" },
  { value: "REACH", label: "도달" },
  { value: "LANDING_PAGE_VIEWS", label: "랜딩페이지 조회" },
];

const CTA_TYPES = [
  { value: "LEARN_MORE", label: "더 알아보기" },
  { value: "SHOP_NOW", label: "지금 구매" },
  { value: "SIGN_UP", label: "가입하기" },
  { value: "CONTACT_US", label: "문의하기" },
  { value: "GET_OFFER", label: "제안 받기" },
  { value: "SUBSCRIBE", label: "구독하기" },
];

export default function CampaignPublishModal({
  copy,
  copyIndex,
  generationId,
  mediaType,
  onClose,
  onPublished,
}: Props) {
  const [step, setStep] = useState(1);
  const [publishing, setPublishing] = useState(false);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // 학습 기반 추천
  const [recommendations, setRecommendations] = useState<CampaignRecommendations | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);

  // Form state
  const [campaignName, setCampaignName] = useState(
    `${(copy.headline || "캠페인").substring(0, 40)} - ${new Date().toLocaleDateString("ko-KR")}`
  );
  const [objective, setObjective] = useState("OUTCOME_TRAFFIC");
  const [dailyBudget, setDailyBudget] = useState(10000);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [optimizationGoal, setOptimizationGoal] = useState("LINK_CLICKS");
  const [startDate, setStartDate] = useState(
    new Date(Date.now() + 86400000).toISOString().split("T")[0]
  );
  const [selectedPageId, setSelectedPageId] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [ctaType, setCtaType] = useState("LEARN_MORE");

  // Step 2 진입 시 학습 기반 추천 로드
  useEffect(() => {
    if (step === 2 && !recommendations && !recsLoading) {
      setRecsLoading(true);
      fetchCampaignRecommendations()
        .then((data) => setRecommendations(data))
        .catch(() => {}) // 실패해도 무시 (추천은 선택사항)
        .finally(() => setRecsLoading(false));
    }
  }, [step]);

  // Step 3 진입 시 Facebook Pages 로드
  useEffect(() => {
    if (step === 3 && pages.length === 0 && !pagesLoading) {
      loadPages();
    }
  }, [step]);

  const loadPages = async () => {
    setPagesLoading(true);
    setPagesError(null);
    try {
      const data = await fetchFacebookPages();
      setPages(data);
      if (data.length > 0) {
        setSelectedPageId(data[0].id);
      }
    } catch (err) {
      setPagesError(
        err instanceof Error ? err.message : "Facebook Page 목록을 불러오지 못했습니다."
      );
    } finally {
      setPagesLoading(false);
    }
  };

  const canProceedStep1 = campaignName.trim().length > 0;
  const canProceedStep2 = dailyBudget > 0 && ageMin < ageMax;
  const canProceedStep3 = selectedPageId && linkUrl.trim().length > 0;

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const request: CampaignPublishRequest = {
        ad_copy_generation_id: generationId,
        copy_index: copyIndex,
        campaign_name: campaignName,
        objective,
        daily_budget: dailyBudget,
        targeting: {
          geo_locations: { countries: ["KR"] },
          age_min: ageMin,
          age_max: ageMax,
        },
        optimization_goal: optimizationGoal,
        start_time: new Date(startDate).toISOString(),
        page_id: selectedPageId,
        link_url: linkUrl,
        cta_type: ctaType,
      };
      const result = await publishCampaignToMeta(request);
      setPublishResult(result);
      if (result.success) {
        onPublished();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "퍼블리시에 실패했습니다.";
      setError(msg);
    } finally {
      setPublishing(false);
    }
  };

  // 완료 화면
  if (publishResult?.success) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
          <div className="p-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">캠페인이 생성되었습니다!</h2>
            <p className="text-sm text-gray-500">
              PAUSED 상태로 생성되었습니다. Meta Ads Manager에서 검토 후 활성화하세요.
            </p>
            <div className="bg-gray-50 rounded-lg p-4 text-left space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Campaign ID</span>
                <span className="font-mono text-gray-700">{publishResult.meta_campaign_id}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Ad Set ID</span>
                <span className="font-mono text-gray-700">{publishResult.meta_adset_id}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Ad ID</span>
                <span className="font-mono text-gray-700">{publishResult.meta_ad_id}</span>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${publishResult.meta_campaign_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> Ads Manager 열기
              </a>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Meta 캠페인 퍼블리시</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Step {step}/3 — {step === 1 ? "캠페인 설정" : step === 2 ? "예산 & 타겟팅" : "크리에이티브 & 확인"}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicators */}
        <div className="flex items-center gap-2 px-6 py-3 border-b bg-gray-50">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  s < step
                    ? "bg-blue-600 text-white"
                    : s === step
                    ? "bg-blue-100 text-blue-700 ring-2 ring-blue-300"
                    : "bg-gray-200 text-gray-400"
                }`}
              >
                {s < step ? <CheckCircle className="w-4 h-4" /> : s}
              </div>
              {s < 3 && <div className={`w-8 h-0.5 ${s < step ? "bg-blue-600" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: 캠페인 기본 설정 */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Target className="w-4 h-4 inline mr-1" />
                  캠페인 이름
                </label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="캠페인 이름 입력"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">캠페인 목표</label>
                <div className="grid grid-cols-1 gap-2">
                  {OBJECTIVES.map((obj) => (
                    <label
                      key={obj.value}
                      className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                        objective === obj.value
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="objective"
                        value={obj.value}
                        checked={objective === obj.value}
                        onChange={(e) => setObjective(e.target.value)}
                        className="text-blue-600"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-800">{obj.label}</span>
                        <span className="text-xs text-gray-500 ml-2">{obj.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: 예산 + 타겟팅 */}
          {step === 2 && (
            <div className="space-y-5">
              {/* 학습 기반 추천 패널 */}
              {recsLoading ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2 text-sm text-blue-600">
                  <Loader2 className="w-4 h-4 animate-spin" /> 학습 기반 추천을 불러오는 중...
                </div>
              ) : recommendations && (recommendations.recommended_budget || recommendations.recommended_objective || recommendations.recommended_targeting) ? (
                <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-semibold text-amber-800">
                      학습 기반 추천 설정
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-700 font-medium">
                      {recommendations.data_maturity} 단계
                    </span>
                  </div>

                  <div className="space-y-2">
                    {recommendations.recommended_budget && (
                      <div className="flex items-center justify-between bg-white rounded-md px-3 py-2 border border-amber-100">
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <DollarSign className="w-3.5 h-3.5 text-amber-600" />
                            <span className="text-xs font-medium text-gray-700">일예산</span>
                            <span className="text-xs font-bold text-amber-700">
                              ₩{Number(recommendations.recommended_budget.value).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5 ml-5">
                            {recommendations.recommended_budget.evidence}
                          </p>
                        </div>
                        <button
                          onClick={() => setDailyBudget(Number(recommendations.recommended_budget!.value))}
                          className="text-[10px] px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors font-medium flex items-center gap-0.5"
                        >
                          <Sparkles className="w-3 h-3" /> 적용
                        </button>
                      </div>
                    )}

                    {recommendations.recommended_objective && (
                      <div className="flex items-center justify-between bg-white rounded-md px-3 py-2 border border-amber-100">
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <Target className="w-3.5 h-3.5 text-amber-600" />
                            <span className="text-xs font-medium text-gray-700">목표</span>
                            <span className="text-xs font-bold text-amber-700">
                              {OBJECTIVES.find((o) => o.value === recommendations.recommended_objective!.value)?.label || String(recommendations.recommended_objective.value)}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5 ml-5">
                            {recommendations.recommended_objective.evidence}
                          </p>
                        </div>
                        <button
                          onClick={() => setObjective(String(recommendations.recommended_objective!.value))}
                          className="text-[10px] px-2 py-1 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 transition-colors font-medium flex items-center gap-0.5"
                        >
                          <Sparkles className="w-3 h-3" /> 적용
                        </button>
                      </div>
                    )}

                    {recommendations.recommended_targeting && (
                      <div className="flex items-center justify-between bg-white rounded-md px-3 py-2 border border-amber-100">
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-amber-600" />
                            <span className="text-xs font-medium text-gray-700">타겟</span>
                            <span className="text-xs font-bold text-amber-700">
                              {recommendations.recommended_targeting.value === "broad" ? "Broad (넓은 타겟)" : String(recommendations.recommended_targeting.value)}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5 ml-5">
                            {recommendations.recommended_targeting.evidence}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {recommendations.benchmarks && (
                    <div className="flex gap-3 pt-1 border-t border-amber-200">
                      <div className="text-[10px] text-gray-500">
                        평균 ROAS <span className="font-bold text-gray-700">{recommendations.benchmarks.avg_roas.toFixed(2)}x</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        평균 CTR <span className="font-bold text-gray-700">{recommendations.benchmarks.avg_ctr.toFixed(2)}%</span>
                      </div>
                      <div className="text-[10px] text-gray-500">
                        평균 CPC <span className="font-bold text-gray-700">₩{Math.round(recommendations.benchmarks.avg_cpc).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <DollarSign className="w-4 h-4 inline mr-1" />
                  일일 예산 (KRW)
                </label>
                <input
                  type="number"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(parseInt(e.target.value) || 0)}
                  min={1000}
                  step={1000}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="10000"
                />
                <p className="text-xs text-gray-400 mt-1">
                  최소 1,000원 이상. 현재: {dailyBudget.toLocaleString()}원/일
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Globe className="w-4 h-4 inline mr-1" />
                  타겟 설정
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">최소 연령</label>
                    <input
                      type="number"
                      value={ageMin}
                      onChange={(e) => setAgeMin(parseInt(e.target.value) || 18)}
                      min={13}
                      max={64}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">최대 연령</label>
                    <input
                      type="number"
                      value={ageMax}
                      onChange={(e) => setAgeMax(parseInt(e.target.value) || 65)}
                      min={14}
                      max={65}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">국가: 한국 (KR) 고정</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">최적화 목표</label>
                <select
                  value={optimizationGoal}
                  onChange={(e) => setOptimizationGoal(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {OPTIMIZATION_GOALS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">시작일</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Step 3: 크리에이티브 + 확인 */}
          {step === 3 && (
            <div className="space-y-5">
              {/* Facebook Page 선택 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Facebook Page</label>
                {pagesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> 페이지 목록을 불러오는 중...
                  </div>
                ) : pagesError ? (
                  <div className="text-sm text-red-500 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {pagesError}
                    <button onClick={loadPages} className="ml-2 text-blue-500 underline text-xs">
                      다시 시도
                    </button>
                  </div>
                ) : pages.length === 0 ? (
                  <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    연결된 Facebook Page가 없습니다. 광고를 생성하려면 Facebook Page가 필요합니다.
                  </div>
                ) : (
                  <select
                    value={selectedPageId}
                    onChange={(e) => setSelectedPageId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    {pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.name} ({page.category})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 랜딩 URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">랜딩 URL (필수)</label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="https://example.com/product"
                />
              </div>

              {/* CTA 버튼 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">CTA 버튼</label>
                <select
                  value={ctaType}
                  onChange={(e) => setCtaType(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {CTA_TYPES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* 비디오 광고 안내 */}
              {mediaType === "video" && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-start gap-2">
                  <Film className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-purple-700">
                    <strong>비디오 광고</strong>로 생성됩니다. 업로드한 영상이 원본 품질 그대로 Meta에 업로드되어
                    비디오 크리에이티브로 사용됩니다. 영상 업로드에 시간이 다소 소요될 수 있습니다.
                  </div>
                </div>
              )}

              {/* 카피 미리보기 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">광고 카피 미리보기</label>
                <div className="bg-gray-50 border rounded-lg p-4 space-y-2">
                  {copy.headline && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-gray-400">헤드라인</span>
                      <p className="text-sm font-medium text-gray-800">{copy.headline}</p>
                    </div>
                  )}
                  {copy.body && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-gray-400">본문</span>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{copy.body}</p>
                    </div>
                  )}
                  {copy.cta && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-gray-400">CTA</span>
                      <p className="text-sm text-blue-600 font-medium">{copy.cta}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 경고 */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700">
                  캠페인은 <strong>PAUSED (일시정지)</strong> 상태로 생성됩니다.
                  Meta Ads Manager에서 검토 후 직접 활성화하세요. 활성화 전에는 비용이 발생하지 않습니다.
                </p>
              </div>

              {/* 에러 메시지 */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
          <button
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="flex items-center gap-1 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            {step > 1 ? "이전" : "취소"}
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
              className="flex items-center gap-1 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              다음 <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handlePublish}
              disabled={publishing || !canProceedStep3}
              className="flex items-center gap-1 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {publishing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> 생성 중...
                </>
              ) : (
                "Meta에 퍼블리시"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

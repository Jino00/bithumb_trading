// 데이터 기반 광고 카피 생성 페이지 — 리뷰 인사이트 + Ad Library + 성과 학습 기반
import { useState, useEffect, useCallback } from "react";
import {
  PenTool,
  Loader2,
  Copy,
  CheckCircle,
  Star,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Sparkles,
  BarChart3,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  ImagePlus,
  X,
  Film,
  Send,
} from "lucide-react";
import {
  Product,
  AdCopy,
  AdCopyGeneration,
  AdCopyHistorySummary,
  AdCopyDetail,
  fetchProducts,
  generateAdCopy,
  generateAdCopyWithMedia,
  fetchAdCopyHistory,
  fetchAdCopyDetail,
  submitAdCopyFeedback,
  submitAdCopyPerformance,
} from "../lib/api";
import CampaignPublishModal from "./CampaignPublishModal";

type CopyType = "full" | "headline" | "body" | "cta";
type Platform = "facebook" | "instagram" | "both";
type Tone = "professional" | "casual" | "urgent" | "emotional" | "humorous";

const COPY_TYPES: { value: CopyType; label: string }[] = [
  { value: "full", label: "전체 (기본문구+제목+설명+CTA)" },
  { value: "headline", label: "제목만" },
  { value: "body", label: "기본문구만" },
  { value: "cta", label: "CTA만" },
];

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "both", label: "공통" },
];

const TONES: { value: Tone; label: string; desc: string }[] = [
  { value: "professional", label: "전문적", desc: "신뢰감, 데이터 활용" },
  { value: "casual", label: "캐주얼", desc: "친근, 대화체" },
  { value: "urgent", label: "긴급감", desc: "FOMO, 한정" },
  { value: "emotional", label: "감성적", desc: "공감, 스토리" },
  { value: "humorous", label: "유머", desc: "위트, 반전" },
];

export default function AdCopyGeneratorPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [copyType, setCopyType] = useState<CopyType>("full");
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [tone, setTone] = useState<Tone>("professional");
  const [customInstruction, setCustomInstruction] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<AdCopyGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AdCopyHistorySummary[]>([]);
  const [selectedHistoryDetail, setSelectedHistoryDetail] = useState<AdCopyDetail | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 미디어 업로드 상태
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaEmphasis, setMediaEmphasis] = useState("");

  // 제품 목록 로드
  useEffect(() => {
    fetchProducts().then(setProducts).catch(console.error);
  }, []);

  // 제품 선택 시 히스토리 로드
  const loadHistory = useCallback(async (productId: number) => {
    try {
      const data = await fetchAdCopyHistory(productId);
      setHistory(data);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (selectedProductId) {
      loadHistory(selectedProductId);
    }
  }, [selectedProductId, loadHistory]);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const ACCEPTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime"];
  const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB

  const handleMediaSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_MEDIA_TYPES.includes(file.type)) {
      setError("지원하지 않는 파일 형식입니다. JPG, PNG, WebP, GIF, MP4, MOV만 가능합니다.");
      return;
    }
    const maxSize = file.type.startsWith("video/") ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    const maxMB = maxSize / (1024 * 1024);
    if (file.size > maxSize) {
      setError(`파일 크기가 ${maxMB}MB를 초과합니다.`);
      return;
    }

    setMediaFile(file);
    setError(null);

    // 이미지 프리뷰 생성
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setMediaPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setMediaPreview(null);
    }
  };

  const handleMediaRemove = () => {
    setMediaFile(null);
    setMediaPreview(null);
    setMediaEmphasis("");
  };

  const handleGenerate = async () => {
    if (!selectedProductId) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    setSelectedHistoryDetail(null);
    try {
      let data: AdCopyGeneration;
      if (mediaFile) {
        data = await generateAdCopyWithMedia({
          product_id: selectedProductId,
          copy_type: copyType,
          platform,
          tone,
          custom_instruction: customInstruction || undefined,
          media: mediaFile,
          media_emphasis: mediaEmphasis || undefined,
        });
      } else {
        data = await generateAdCopy({
          product_id: selectedProductId,
          copy_type: copyType,
          platform,
          tone,
          custom_instruction: customInstruction || undefined,
        });
      }
      setResult(data);
      loadHistory(selectedProductId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "카피 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const handleLoadDetail = async (id: number) => {
    setLoadingHistory(true);
    setResult(null);
    try {
      const data = await fetchAdCopyDetail(id);
      setSelectedHistoryDetail(data);
    } catch {
      setError("히스토리를 불러오지 못했습니다.");
    } finally {
      setLoadingHistory(false);
    }
  };

  // 현재 표시할 카피 목록 (생성 결과 또는 히스토리 상세)
  const displayCopies: AdCopy[] = result?.copies || selectedHistoryDetail?.generated_copies || [];
  const displayId = result?.id || selectedHistoryDetail?.id || null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <PenTool className="w-5 h-5 text-indigo-600" />
        <h2 className="text-xl font-bold text-gray-900">Ad Copy Generator</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Left Panel — Settings */}
        <div className="lg:col-span-1 space-y-4">
          {/* Product Selection */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" /> 제품 선택
            </h3>
            <select
              value={selectedProductId || ""}
              onChange={(e) => setSelectedProductId(Number(e.target.value) || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">제품을 선택하세요</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.category})
                </option>
              ))}
            </select>

            {selectedProduct && (
              <div className="mt-3 p-2.5 bg-indigo-50 rounded-lg">
                <div className="text-xs font-medium text-indigo-700">{selectedProduct.name}</div>
                <div className="text-[10px] text-indigo-500 mt-0.5">
                  카테고리: {selectedProduct.category}
                  {selectedProduct.last_analyzed && (
                    <> · 마지막 분석: {new Date(selectedProduct.last_analyzed).toLocaleDateString()}</>
                  )}
                </div>
                {!selectedProduct.last_analyzed && (
                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-amber-600">
                    <AlertCircle className="w-3 h-3" />
                    리뷰 분석을 먼저 실행해주세요
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Options */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> 생성 옵션
            </h3>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">카피 타입</label>
              <select
                value={copyType}
                onChange={(e) => setCopyType(e.target.value as CopyType)}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {COPY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">플랫폼</label>
              <div className="flex gap-1.5">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPlatform(p.value)}
                    className={`flex-1 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                      platform === p.value
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">톤앤매너</label>
              <div className="grid grid-cols-2 gap-1.5">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTone(t.value)}
                    className={`px-2 py-1.5 text-xs rounded-lg border transition-colors text-left ${
                      tone === t.value
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <div className="font-medium">{t.label}</div>
                    <div className="text-[9px] opacity-70">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">추가 지시사항 (선택)</label>
              <textarea
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                rows={2}
                placeholder="예: 20대 여성 타겟, 여름 시즌 강조..."
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            {/* 미디어 첨부 (선택) */}
            <div className="border-t border-gray-100 pt-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5 flex items-center gap-1">
                <ImagePlus className="w-3 h-3" /> 미디어 첨부 (선택)
              </label>

              {!mediaFile ? (
                <label className="block cursor-pointer">
                  <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                    <ImagePlus className="w-6 h-6 mx-auto text-gray-300" />
                    <p className="text-xs text-gray-400 mt-1.5">클릭하여 업로드</p>
                    <p className="text-[10px] text-gray-300 mt-0.5">이미지: JPG, PNG, WebP, GIF (20MB) | 영상: MP4, MOV (500MB)</p>
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime"
                    onChange={handleMediaSelect}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="relative border border-gray-200 rounded-lg p-2">
                  <button
                    onClick={handleMediaRemove}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors z-10"
                  >
                    <X className="w-3 h-3" />
                  </button>

                  {mediaPreview ? (
                    <img src={mediaPreview} alt="미디어 프리뷰" className="w-full h-24 object-cover rounded" />
                  ) : (
                    <div className="w-full h-24 bg-gray-100 rounded flex flex-col items-center justify-center">
                      <Film className="w-8 h-8 text-gray-400" />
                      <span className="text-[10px] text-gray-400 mt-1">{mediaFile.name}</span>
                    </div>
                  )}

                  <div className="mt-2">
                    <label className="block text-[10px] font-medium text-gray-400 mb-0.5">강조 포인트 (선택)</label>
                    <input
                      type="text"
                      value={mediaEmphasis}
                      onChange={(e) => setMediaEmphasis(e.target.value)}
                      placeholder="예: 슬림한 디자인, 프리미엄 소재 질감..."
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !selectedProductId || !selectedProduct?.last_analyzed}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> AI 카피 생성 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> AI 카피 생성
                </>
              )}
            </button>
          </div>

          {/* Context Summary */}
          {result?.context_summary && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5" /> 사용된 데이터
              </h3>
              <div className="space-y-1.5 text-xs text-gray-600">
                <div className="flex items-center justify-between">
                  <span>리뷰 데이터</span>
                  <span className="font-medium text-indigo-600">
                    {result.context_summary.reviews_used.total_count.toLocaleString()}건
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>분석 테마</span>
                  <span className="font-medium">{result.context_summary.reviews_used.themes}개</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>강점 포인트</span>
                  <span className="font-medium">{result.context_summary.reviews_used.strengths}개</span>
                </div>
                <div className="border-t border-gray-100 my-1" />
                <div className="flex items-center justify-between">
                  <span>Ad Library 검색</span>
                  <span className="font-medium text-purple-600">
                    {result.context_summary.ad_library_used.searches}건
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>메시징 패턴</span>
                  <span className="font-medium">{result.context_summary.ad_library_used.patterns}개</span>
                </div>
              </div>
              {result?.has_video_analysis && (
                <div className="flex items-center gap-1.5 mt-3 p-2 bg-purple-50 rounded-lg border border-purple-100">
                  <Film className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-xs text-purple-600 font-medium">Gemini 영상 분석 반영됨</span>
                </div>
              )}
            </div>
          )}

          {/* History */}
          {selectedProductId && history.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> 생성 히스토리
              </h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => handleLoadDetail(h.id)}
                    className={`w-full text-left p-2.5 rounded-lg transition-colors ${
                      selectedHistoryDetail?.id === h.id
                        ? "bg-indigo-50 border border-indigo-200"
                        : "hover:bg-gray-50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-700">
                        {h.tone} · {h.platform}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {h.copies_count}개
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                      <span>{new Date(h.created_at).toLocaleDateString()}</span>
                      {h.user_rating && (
                        <span className="flex items-center gap-0.5 text-yellow-500">
                          <Star className="w-2.5 h-2.5 fill-current" />
                          {h.user_rating}
                        </span>
                      )}
                      {h.has_performance && (
                        <span className="flex items-center gap-0.5 text-green-500">
                          <TrendingUp className="w-2.5 h-2.5" /> 성과
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel — Results */}
        <div className="lg:col-span-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {generating ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-400" />
              <p className="mt-2 text-sm text-gray-500">
                {mediaFile?.type.startsWith("video/")
                  ? "Gemini가 영상을 분석하고, Claude가 카피를 생성하고 있습니다..."
                  : `AI가 리뷰 데이터와 광고 트렌드${mediaFile ? ", 첨부된 미디어" : ""}를 분석하여 카피를 생성하고 있습니다...`}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {mediaFile?.type.startsWith("video/")
                  ? "영상 업로드 + AI 분석 포함 — 최대 2~3분 소요될 수 있습니다"
                  : mediaFile
                    ? "미디어 분석 포함 — 최대 60초 소요될 수 있습니다"
                    : "최대 30초 소요될 수 있습니다"}
              </p>
              {mediaFile?.type.startsWith("video/") && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-purple-500">
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  Gemini AI 영상 분석 진행 중...
                </div>
              )}
            </div>
          ) : loadingHistory ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-400" />
              <p className="mt-2 text-sm text-gray-500">불러오는 중...</p>
            </div>
          ) : displayCopies.length > 0 ? (
            <div className="space-y-4">
              {displayCopies.map((copy, i) => (
                <CopyCard key={i} copy={copy} index={i} generationId={displayId} mediaType={mediaFile?.type.startsWith("video/") ? "video" : mediaFile ? "image" : undefined} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <PenTool className="w-12 h-12 mx-auto text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">
                {selectedProductId
                  ? "제품을 선택하고 'AI 카피 생성'을 클릭하세요"
                  : "왼쪽에서 제품을 먼저 선택하세요"
                }
              </p>
              <p className="text-xs text-gray-400 mt-1">
                리뷰 인사이트와 경쟁사 광고 패턴을 기반으로 광고 카피를 자동 생성합니다
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyCard({ copy, index, generationId, mediaType }: { copy: AdCopy; index: number; generationId: number | null; mediaType?: "image" | "video" }) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showRationale, setShowRationale] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);
  const [perfForm, setPerfForm] = useState({ ctr: "", roas: "", conversions: "" });
  const [perfSubmitted, setPerfSubmitted] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCopyAll = () => {
    const pt = copy.primary_text || copy.body;
    const all = `[기본 문구]\n${pt}\n\n[제목]\n${copy.headline}\n\n[설명]\n${copy.description || ""}\n\n[CTA]\n${copy.cta}`;
    handleCopy(all, "all");
  };

  const handleRating = async (stars: number) => {
    setRating(stars);
    if (generationId) {
      try {
        await submitAdCopyFeedback(generationId, { rating: stars, selected_index: index });
        setRatingSubmitted(true);
      } catch {
        console.error("Failed to submit feedback");
      }
    }
  };

  const handlePerfSubmit = async () => {
    if (!generationId) return;
    try {
      await submitAdCopyPerformance(generationId, {
        ctr: perfForm.ctr ? parseFloat(perfForm.ctr) : undefined,
        roas: perfForm.roas ? parseFloat(perfForm.roas) : undefined,
        conversions: perfForm.conversions ? parseInt(perfForm.conversions) : undefined,
      });
      setPerfSubmitted(true);
      setShowPerformance(false);
    } catch {
      console.error("Failed to submit performance data");
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Card Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-gray-700">카피 #{index + 1}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Rating Stars */}
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                onClick={() => handleRating(s)}
                disabled={ratingSubmitted}
                className={`p-0.5 transition-colors ${ratingSubmitted ? "cursor-default" : "hover:scale-110"}`}
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    s <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-300"
                  }`}
                />
              </button>
            ))}
            {ratingSubmitted && <CheckCircle className="w-3 h-3 text-green-500 ml-1" />}
          </div>

          {/* Performance button */}
          <button
            onClick={() => setShowPerformance(!showPerformance)}
            className={`p-1 rounded text-xs transition-colors ${
              perfSubmitted
                ? "text-green-500"
                : "text-gray-400 hover:text-indigo-500 hover:bg-indigo-50"
            }`}
            title="성과 데이터 입력"
          >
            <TrendingUp className="w-3.5 h-3.5" />
          </button>

          {/* Copy all */}
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          >
            {copiedField === "all" ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
            전체 복사
          </button>

          {/* Publish to Meta */}
          <button
            onClick={() => setShowPublishModal(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Meta 캠페인으로 퍼블리시"
          >
            <Send className="w-3 h-3" /> Meta 퍼블리시
          </button>
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4 space-y-3">
        {/* 기본 문구 (Primary Text) */}
        {(copy.primary_text || copy.body) && (
          <CopyField label="기본 문구" value={copy.primary_text || copy.body} fieldId="primary_text" copiedField={copiedField} onCopy={handleCopy} isLong />
        )}

        {/* 제목 (Headline) */}
        {copy.headline && (
          <CopyField label="제목" value={copy.headline} fieldId="headline" copiedField={copiedField} onCopy={handleCopy} />
        )}

        {/* 설명 (Description) */}
        {copy.description && (
          <CopyField label="설명" value={copy.description} fieldId="description" copiedField={copiedField} onCopy={handleCopy} />
        )}

        {/* CTA */}
        {copy.cta && (
          <CopyField label="CTA" value={copy.cta} fieldId="cta" copiedField={copiedField} onCopy={handleCopy} />
        )}

        {/* Performance Input */}
        {showPerformance && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
            <h4 className="text-xs font-semibold text-green-700">📊 실제 캠페인 성과 입력</h4>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-green-600 mb-0.5">CTR (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={perfForm.ctr}
                  onChange={(e) => setPerfForm({ ...perfForm, ctr: e.target.value })}
                  className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-green-400"
                  placeholder="2.5"
                />
              </div>
              <div>
                <label className="block text-[10px] text-green-600 mb-0.5">ROAS (x)</label>
                <input
                  type="number"
                  step="0.1"
                  value={perfForm.roas}
                  onChange={(e) => setPerfForm({ ...perfForm, roas: e.target.value })}
                  className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-green-400"
                  placeholder="3.0"
                />
              </div>
              <div>
                <label className="block text-[10px] text-green-600 mb-0.5">전환수</label>
                <input
                  type="number"
                  value={perfForm.conversions}
                  onChange={(e) => setPerfForm({ ...perfForm, conversions: e.target.value })}
                  className="w-full px-2 py-1 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-green-400"
                  placeholder="50"
                />
              </div>
            </div>
            <button
              onClick={handlePerfSubmit}
              className="w-full px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
            >
              성과 저장 (다음 카피 생성에 반영)
            </button>
          </div>
        )}

        {/* Rationale */}
        {copy.rationale && (
          <div>
            <button
              onClick={() => setShowRationale(!showRationale)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-500 transition-colors"
            >
              {showRationale ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              생성 근거
            </button>
            {showRationale && (
              <div className="mt-1.5 p-2.5 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-600 leading-relaxed">{copy.rationale}</p>
                {copy.data_sources?.review_themes?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {copy.data_sources.review_themes.map((t, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded">리뷰: {t}</span>
                    ))}
                  </div>
                )}
                {copy.data_sources?.ad_patterns?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {copy.data_sources.ad_patterns.map((p, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">패턴: {p}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Campaign Publish Modal */}
      {showPublishModal && generationId && (
        <CampaignPublishModal
          copy={copy}
          copyIndex={index}
          generationId={generationId}
          hasMedia={!!mediaType}
          mediaType={mediaType}
          onClose={() => setShowPublishModal(false)}
          onPublished={() => setShowPublishModal(false)}
        />
      )}
    </div>
  );
}

function CopyField({
  label, value, fieldId, copiedField, onCopy, isLong,
}: {
  label: string; value: string; fieldId: string; copiedField: string | null; onCopy: (text: string, field: string) => void; isLong?: boolean;
}) {
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase text-gray-400">{label}</span>
        <button
          onClick={() => onCopy(value, fieldId)}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-indigo-500 transition-all"
        >
          {copiedField === fieldId ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      <div className={`px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 ${isLong ? "text-sm" : "text-sm font-medium"} text-gray-800`}>
        {value}
      </div>
    </div>
  );
}

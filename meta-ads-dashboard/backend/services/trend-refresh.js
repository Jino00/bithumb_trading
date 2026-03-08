// 트렌드 갱신 서비스 — 스케줄러와 HTTP 라우트 양쪽에서 호출
import { getDb } from "../db/database.js";
import { callClaude, parseClaudeJson } from "./claude-client.js";
import { saveTrendActionable } from "./trend-bridge.js";

const SYSTEM_PROMPT = `You are a Meta Ads expert with access to real-time web search. Always search for the latest Meta Ads updates, algorithm changes, best practices, and trends before answering. Your knowledge must be current as of today. Return ONLY valid JSON.`;

// 기존 프롬프트 (대시보드 표시용)
const REFRESH_PROMPT = `Search the web for the very latest Meta Ads information and return:

1. Recent algorithm updates or policy changes from Meta
2. Best-performing ad formats right now with performance data
3. Current CPM/CPC/CTR benchmarks by industry
4. What strategies are working best right now

Return JSON:
{
  "algorithm_updates": [{"title": string, "content": string, "date": string}],
  "best_formats": [{"format": string, "performance": string, "trend": "up"|"stable"|"down"}],
  "benchmarks": {"average_ctr": string, "average_cpc": string, "average_cpm": string, "average_roas": string, "industry_note": string},
  "whats_working": string[]
}`;

// 강화된 프롬프트 (한국 이커머스 특화, 구조화된 수치 데이터)
const REFRESH_PROMPT_V2 = `Search the web for the latest Meta (Facebook/Instagram) Ads information, specifically focused on:
- Korean e-commerce / D2C brands (이커머스, 자사몰)
- Small-to-medium online stores selling physical products (phone cases, accessories, cosmetics, etc.)

Return structured JSON with these sections:

{
  "algorithm_updates": [
    {
      "title": "변경 제목",
      "content": "상세 설명",
      "date": "YYYY-MM",
      "impact_area": "targeting|creative|bidding|placement|attribution",
      "action_required": "구체적인 대응 행동"
    }
  ],
  "best_formats": [
    {
      "format": "광고 포맷명 (예: Reels, Carousel, Collection)",
      "performance": "성과 설명",
      "trend": "up|stable|down",
      "recommended_for": "ecommerce|awareness|retargeting",
      "avg_cpm_change_pct": null,
      "avg_ctr_range": "예: 1.5-3.0%"
    }
  ],
  "benchmarks_kr_ecommerce": {
    "avg_ctr_pct": 1.8,
    "avg_cpc_krw": 800,
    "avg_cpm_krw": 8000,
    "avg_roas": 3.0,
    "avg_frequency_cap": 2.5,
    "data_source": "데이터 출처 (예: Revealbot, Databox, Meta Business Suite)",
    "confidence": "high|medium|low"
  },
  "whats_working": [
    {
      "strategy": "전략 설명",
      "category": "targeting|creative|bidding|budget|placement",
      "effectiveness": "high|medium|low",
      "relevance_to_kr_ecommerce": "high|medium|low"
    }
  ],
  "seasonal_context": {
    "current_season": "현재 시즌 (예: 봄 시즌, 설 연휴 전, 블프 시즌)",
    "upcoming_events": ["다가오는 마케팅 이벤트 리스트"],
    "cpm_trend": "rising|stable|falling",
    "recommended_budget_adjustment_pct": 0
  }
}

IMPORTANT:
- benchmarks_kr_ecommerce의 수치는 한국 원화(KRW) 기준으로 반환
- CPC는 원(₩) 단위 (예: 800 = ₩800)
- CPM도 원(₩) 단위 (예: 8000 = ₩8,000)
- 정확한 수치를 모르면 합리적인 범위의 중간값 사용 + confidence를 "low"로 설정
- whats_working의 각 항목에 한국 이커머스 관련성(relevance_to_kr_ecommerce) 표시
- seasonal_context에 한국 기준 시즌/이벤트 반영 (설날, 추석, 11.11, 블프 등)`;

export function generateMockTrends() {
  return JSON.stringify({
    algorithm_updates: [
      {
        title: "Meta Advantage+ Shopping Campaigns Enhanced",
        content: "Meta has expanded Advantage+ shopping campaigns with improved AI-driven targeting and creative optimization. Advertisers report 15-20% improvement in ROAS.",
        date: "2025-03",
      },
      {
        title: "New Reels Ad Placements",
        content: "Meta introduced new Reels ad placements with interactive features. Early adopters see 30% lower CPMs compared to feed placements.",
        date: "2025-02",
      },
    ],
    best_formats: [
      { format: "Short-form Video (Reels)", performance: "Highest engagement, 40% lower CPM", trend: "up" },
      { format: "Carousel Ads", performance: "Best for e-commerce, 2.5x higher CTR", trend: "stable" },
      { format: "Collection Ads", performance: "Strong for product discovery, 3x conversion rate", trend: "up" },
      { format: "Stories Ads", performance: "Good for awareness, declining engagement", trend: "down" },
    ],
    benchmarks: {
      average_ctr: "1.5-2.5%",
      average_cpc: "$1.00-2.50",
      average_cpm: "$8.00-15.00",
      average_roas: "2.5-4.0x",
      industry_note: "E-commerce tends to outperform, B2B has higher CPCs but better conversion values",
    },
    whats_working: [
      "UGC-style video ads outperform polished creative by 30-50%",
      "Advantage+ audience targeting now matches or beats manual targeting for most advertisers",
      "First-party data integration via Conversions API improves attribution accuracy by 20%",
      "AI-generated ad variations show 15% improvement in creative testing velocity",
      "Broad targeting + creative diversity strategy replacing narrow interest targeting",
    ],
  });
}

/**
 * 트렌드 데이터를 갱신하고 DB에 저장 (기존 대시보드용 + 신규 구조화 데이터)
 * @returns {{ data: object, last_updated: string }} 갱신된 트렌드 데이터
 */
export async function refreshTrendsData() {
  // 1. 기존 대시보드용 트렌드 (하위 호환)
  const result = await callClaude(REFRESH_PROMPT, SYSTEM_PROMPT, generateMockTrends);
  const parsed = parseClaudeJson(result, JSON.parse(generateMockTrends()));

  const db = getDb();
  saveTrends(db, parsed);

  // 2. 구조화된 한국 이커머스 특화 트렌드 (자동화 서비스용)
  try {
    const resultV2 = await callClaude(REFRESH_PROMPT_V2, SYSTEM_PROMPT, generateMockTrendsV2);
    const parsedV2 = parseClaudeJson(resultV2, JSON.parse(generateMockTrendsV2()));
    const saved = saveTrendActionable(parsedV2);
    if (saved) {
      console.log("[TrendRefresh] Actionable trend data saved for automation services");
    }
  } catch (err) {
    console.error("[TrendRefresh] V2 trend fetch failed (non-blocking):", err.message);
  }

  return { data: parsed, last_updated: new Date().toISOString() };
}

export function generateMockTrendsV2() {
  return JSON.stringify({
    algorithm_updates: [
      {
        title: "Advantage+ Shopping Campaigns 강화",
        content: "Meta가 Advantage+ 쇼핑 캠페인의 AI 타겟팅을 개선. 이커머스 광고주 ROAS 15-20% 향상 보고.",
        date: "2025-03",
        impact_area: "targeting",
        action_required: "기존 수동 타겟팅 캠페인을 Advantage+로 전환 테스트",
      },
      {
        title: "Reels 광고 신규 인터랙티브 기능",
        content: "Reels 광고에 새로운 인터랙티브 기능 추가. 초기 채택자 CPM 30% 감소.",
        date: "2025-02",
        impact_area: "creative",
        action_required: "Reels 포맷 광고 비중 확대, 인터랙티브 요소 활용",
      },
    ],
    best_formats: [
      { format: "Short-form Video (Reels)", performance: "최고 인게이지먼트, CPM 40% 낮음", trend: "up", recommended_for: "ecommerce", avg_cpm_change_pct: -40, avg_ctr_range: "2.0-4.0%" },
      { format: "Carousel Ads", performance: "이커머스 최적, CTR 2.5배", trend: "stable", recommended_for: "ecommerce", avg_cpm_change_pct: null, avg_ctr_range: "1.5-3.0%" },
      { format: "Collection Ads", performance: "제품 디스커버리 강점, 전환율 3배", trend: "up", recommended_for: "ecommerce", avg_cpm_change_pct: null, avg_ctr_range: "1.0-2.5%" },
      { format: "Stories Ads", performance: "인지도 적합, 인게이지먼트 하락", trend: "down", recommended_for: "awareness", avg_cpm_change_pct: 10, avg_ctr_range: "0.8-1.5%" },
    ],
    benchmarks_kr_ecommerce: {
      avg_ctr_pct: 1.8,
      avg_cpc_krw: 800,
      avg_cpm_krw: 8000,
      avg_roas: 3.0,
      avg_frequency_cap: 2.5,
      data_source: "Mock data (web search unavailable)",
      confidence: "low",
    },
    whats_working: [
      { strategy: "UGC 스타일 영상 광고가 기업형 크리에이티브 대비 30-50% 높은 성과", category: "creative", effectiveness: "high", relevance_to_kr_ecommerce: "high" },
      { strategy: "Advantage+ 오디언스 타겟팅이 수동 타겟팅과 동등 또는 상회", category: "targeting", effectiveness: "high", relevance_to_kr_ecommerce: "high" },
      { strategy: "Conversions API 연동으로 어트리뷰션 정확도 20% 향상", category: "attribution", effectiveness: "medium", relevance_to_kr_ecommerce: "medium" },
      { strategy: "Broad 타겟팅 + 다양한 크리에이티브 조합이 좁은 관심사 타겟팅 대체", category: "targeting", effectiveness: "high", relevance_to_kr_ecommerce: "high" },
    ],
    seasonal_context: {
      current_season: "봄 시즌",
      upcoming_events: ["어린이날", "어버이날"],
      cpm_trend: "stable",
      recommended_budget_adjustment_pct: 0,
    },
  });
}

/**
 * 마지막 갱신 시간 조회
 * @returns {string|null} ISO 날짜 문자열 또는 null
 */
export function getLastRefreshTime() {
  const db = getDb();
  const row = db.prepare("SELECT fetched_at FROM trends ORDER BY fetched_at DESC LIMIT 1").get();
  return row?.fetched_at || null;
}

function saveTrends(db, data) {
  db.prepare("DELETE FROM trends").run();

  const insert = db.prepare("INSERT INTO trends (category, title, content, source) VALUES (?, ?, ?, ?)");

  const save = db.transaction((trendData) => {
    if (trendData.algorithm_updates) {
      for (const update of trendData.algorithm_updates) {
        insert.run("algorithm_update", update.title, update.content, update.date || null);
      }
    }
    if (trendData.best_formats) {
      for (const fmt of trendData.best_formats) {
        insert.run("best_format", fmt.format, `${fmt.performance} (trend: ${fmt.trend})`, null);
      }
    }
    if (trendData.benchmarks) {
      insert.run("benchmark", "Industry Benchmarks", JSON.stringify(trendData.benchmarks), null);
    }
    if (trendData.whats_working) {
      for (const tip of trendData.whats_working) {
        insert.run("whats_working", "Best Practice", tip, null);
      }
    }
  });

  try {
    save(data);
  } catch (err) {
    console.error("Failed to save trends:", err.message);
  }
}

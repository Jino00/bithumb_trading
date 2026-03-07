// Meta Ad Library 리뷰 서비스 — Claude web_search로 광고 트렌드/스타일/장단점 분석
import { callClaude, parseClaudeJson } from "./claude-client.js";

const SYSTEM_PROMPT = `You are a world-class Meta Ads creative strategist and Ad Library analyst. Use web search to find real-time data from Facebook/Meta Ad Library and advertising trend sources. Analyze ads with a focus on Korean market relevance. Return ONLY valid JSON in the exact format requested.`;

/**
 * Meta Ad Library를 검색하고 분석 리포트 생성
 * @param {string} query - 검색 키워드 또는 브랜드명
 * @param {string} type - 검색 타입: 'keyword' | 'brand' | 'category'
 * @returns {object} 구조화된 분석 결과
 */
export async function reviewAdLibrary(query, type = "keyword") {
  const prompt = buildPrompt(query, type);
  const result = await callClaude(prompt, SYSTEM_PROMPT, () => generateMockReview(query));

  const parsed = parseClaudeJson(result, JSON.parse(generateMockReview(query)));

  return {
    search_query: query,
    search_type: type,
    ads_found: parsed.ads_found || 0,
    trends: parsed.trends || [],
    styles: parsed.styles || [],
    pros_cons: parsed.pros_cons || { pros: [], cons: [] },
    messaging_patterns: parsed.messaging_patterns || [],
    key_takeaways: parsed.key_takeaways || [],
    raw_analysis: parsed,
  };
}

function buildPrompt(query, type) {
  const typeContext = {
    keyword: `Search the Meta Ad Library and web for ads related to the keyword "${query}".`,
    brand: `Search the Meta Ad Library and web for ads by the brand "${query}".`,
    category: `Search the Meta Ad Library and web for ads in the "${query}" category/industry.`,
  };

  return `${typeContext[type] || typeContext.keyword}

Focus on the Korean market but include global trends that are relevant.

Analyze and return JSON in this format:
{
  "ads_found": number,
  "trends": [
    {
      "trend_name": string,
      "description": string,
      "prevalence": "high" | "medium" | "low",
      "examples": string[]
    }
  ],
  "styles": [
    {
      "style_name": string,
      "description": string,
      "visual_elements": string[],
      "effectiveness": "high" | "medium" | "low"
    }
  ],
  "pros_cons": {
    "pros": [{"point": string, "detail": string}],
    "cons": [{"point": string, "detail": string}]
  },
  "messaging_patterns": [
    {
      "pattern_name": string,
      "description": string,
      "example_headlines": string[],
      "cta_types": string[]
    }
  ],
  "key_takeaways": [
    {
      "insight": string,
      "actionable_tip": string,
      "priority": "high" | "medium" | "low"
    }
  ],
  "recommended_adaptations": [
    {
      "recommendation": string,
      "rationale": string,
      "estimated_impact": string
    }
  ]
}`;
}

function generateMockReview(query) {
  return JSON.stringify({
    ads_found: 15,
    trends: [
      {
        trend_name: "숏폼 비디오 중심",
        description: `"${query}" 관련 광고에서 15초 이하 숏폼 비디오가 주도적`,
        prevalence: "high",
        examples: ["제품 시연 릴스", "사용 전/후 비교 영상", "고객 리뷰 UGC"],
      },
      {
        trend_name: "감성 스토리텔링",
        description: "단순 기능 소개 대신 라이프스타일 중심 스토리텔링 접근",
        prevalence: "medium",
        examples: ["일상 속 제품 활용", "계절감 있는 비주얼"],
      },
    ],
    styles: [
      {
        style_name: "미니멀 클린",
        description: "흰 배경 + 제품 중심 + 깔끔한 타이포그래피",
        visual_elements: ["화이트 스페이스", "산세리프 폰트", "파스텔 톤"],
        effectiveness: "high",
      },
      {
        style_name: "UGC 스타일",
        description: "사용자가 직접 촬영한 듯한 자연스러운 영상",
        visual_elements: ["스마트폰 촬영감", "자연광", "자막 오버레이"],
        effectiveness: "high",
      },
    ],
    pros_cons: {
      pros: [
        { point: "높은 참여율", detail: "UGC 스타일 광고가 전통적 광고 대비 30-50% 높은 참여율" },
        { point: "비용 효율", detail: "제작 비용이 낮으면서도 성과가 좋음" },
      ],
      cons: [
        { point: "브랜드 일관성 부족", detail: "UGC 다양성으로 브랜드 톤앤매너 유지 어려움" },
        { point: "크리에이티브 피로", detail: "비슷한 포맷의 광고가 많아 차별화 필요" },
      ],
    },
    messaging_patterns: [
      {
        pattern_name: "문제-해결 구조",
        description: "고객의 문제를 제시하고 제품으로 해결하는 패턴",
        example_headlines: ["이런 고민 있으셨죠?", "드디어 찾았다!", "이걸로 해결됐어요"],
        cta_types: ["지금 구매하기", "자세히 보기", "무료 체험"],
      },
    ],
    key_takeaways: [
      {
        insight: "숏폼 비디오가 가장 효과적인 포맷",
        actionable_tip: "15초 이하 릴스 광고를 메인 포맷으로 활용",
        priority: "high",
      },
      {
        insight: "UGC 스타일이 전통적 크리에이티브보다 우수",
        actionable_tip: "실제 고객 리뷰/사용 영상을 광고 소재로 활용",
        priority: "high",
      },
    ],
    recommended_adaptations: [
      {
        recommendation: "릴스 중심 크리에이티브 전환",
        rationale: "현재 트렌드에서 가장 높은 참여율과 낮은 CPM",
        estimated_impact: "CTR 20-30% 개선 예상",
      },
    ],
  });
}

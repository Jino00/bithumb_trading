// 상품 리뷰 분석 서비스 — 스크래핑된 리뷰 텍스트를 Claude로 분석 (하이브리드 방식)
import { callClaude, callClaudeNoTools, parseClaudeJson } from "./claude-client.js";

const SYSTEM_PROMPT = `You are a product review analyst specializing in Korean e-commerce platforms (Naver Smart Store, Coupang, 11st, etc.).

STEP-BY-STEP PROCESS — follow this order:
1. FIRST, search for the product page URL to find the TOTAL review count and average star rating.
   - Search: "[product name] site:[platform domain] 리뷰" or visit the product URL directly
   - Look for numbers like "상품평 14,549개", "리뷰 10,543건", "별점 4.71"
   - The review_count should be in the THOUSANDS for popular products. If you get a small number (under 100), search again more carefully.
2. THEN, search for actual review content: "[product name] 후기", "[product name] 리뷰 장점 단점"
3. Analyze the review content for sentiment, themes, strengths, weaknesses.

CRITICAL RULES:
- review_count MUST be the TOTAL number displayed on the product page (e.g., 14549, 10543). NEVER report 0.
- average_rating MUST be the overall rating from the product page (e.g., 4.5, 4.71). NEVER report null if ratings exist.
- If you cannot find exact numbers, estimate based on search results but NEVER return 0 or null.

Return ONLY valid JSON in the exact format requested.
Always respond in Korean for review content analysis.`;

const AGGREGATION_SYSTEM_PROMPT = `You are a cross-platform product intelligence analyst.
Given review analyses from multiple e-commerce platforms, synthesize them into unified insights.
Identify patterns that appear across platforms and platform-specific differences.
Return ONLY valid JSON in the exact format requested.
Always respond in Korean.`;

const JSON_FORMAT = `{
  "review_count": number,
  "average_rating": number | null,
  "sentiment_summary": {
    "positive_pct": number,
    "neutral_pct": number,
    "negative_pct": number,
    "overall": "positive" | "neutral" | "negative" | "mixed"
  },
  "themes": [
    {
      "theme": string,
      "frequency": "high" | "medium" | "low",
      "sentiment": "positive" | "negative" | "mixed",
      "example_quotes": string[]
    }
  ],
  "strengths": [
    { "point": string, "detail": string, "mention_count": number }
  ],
  "weaknesses": [
    { "point": string, "detail": string, "mention_count": number }
  ],
  "notable_reviews": [
    {
      "summary": string,
      "sentiment": "positive" | "negative",
      "rating": number | null,
      "key_point": string
    }
  ]
}`;

function buildPlatformPrompt(listing) {
  const base = `상품 "${listing.listing_name}"의 고객 리뷰를 분석해주세요.\nURL: ${listing.listing_url}`;

  const instructions = {
    naver_smartstore: `${base}

중요: 이 상품은 네이버 스마트스토어에 등록된 제품입니다.
네이버 스마트스토어는 옵션(사이즈, 색상, 수량 등)별로 리뷰가 분리되어 표시됩니다.
반드시 모든 옵션의 리뷰를 종합해서 분석해주세요. 하나의 옵션 리뷰만 보지 마세요.
"${listing.listing_name} 리뷰" 또는 "${listing.listing_name} 후기"로도 검색해서 가능한 한 많은 리뷰를 수집하세요.

반드시 확인: 상품 페이지에 표시된 "전체 리뷰 수"와 "평균 별점"을 정확히 가져오세요.
예: "구매평 10,543개", "별점 4.71" → review_count: 10543, average_rating: 4.71`,

    coupang: `${base}

이 상품은 쿠팡에 등록된 제품입니다. 제품 단위로 리뷰가 통합되어 있습니다.
"쿠팡 ${listing.listing_name} 리뷰 후기"로도 검색해서 리뷰를 수집하세요.

반드시 확인: 상품 페이지에 표시된 "전체 상품평 수"와 "평균 별점"을 정확히 가져오세요.
예: "상품평 14,549개", "4.5점" → review_count: 14549, average_rating: 4.5`,

    "11st": `${base}

이 상품은 11번가에 등록된 제품입니다. 제품 단위로 리뷰가 통합되어 있습니다.
"11번가 ${listing.listing_name} 리뷰 후기"로도 검색해서 리뷰를 수집하세요.

반드시 확인: 상품 페이지에 표시된 "전체 리뷰 수"와 "평균 별점"을 정확히 가져오세요.`,

    own_store: `${base}

이 상품은 자사몰(브랜드 공식 사이트)에 등록된 제품입니다. 제품 단위로 리뷰가 통합되어 있습니다.
"${listing.listing_name} 리뷰 후기"로 웹 검색도 수행해서 리뷰를 수집하세요.

반드시 확인: 상품 페이지에 표시된 "전체 리뷰 수"와 "평균 별점"을 정확히 가져오세요.`,
  };

  const instruction = instructions[listing.platform_type]
    || `${base}\n\n"${listing.listing_name} 리뷰 후기"로 웹 검색해서 리뷰를 수집하세요.`;

  return `${instruction}\n\n분석 결과를 다음 JSON 형식으로 반환해주세요:\n${JSON_FORMAT}`;
}

function buildAggregationPrompt(product, platformReviews) {
  const reviewSummaries = platformReviews.map((r) =>
    `--- ${r.platform_type} (${r.listing_name}) ---\n${JSON.stringify(r.analysis, null, 2)}`
  ).join("\n\n");

  return `제품: "${product.name}" (카테고리: ${product.category})

아래는 ${platformReviews.length}개 판매 플랫폼의 리뷰 분석 결과입니다:

${reviewSummaries}

모든 플랫폼의 리뷰를 종합해서 통합 분석을 작성하세요. 다음 JSON 형식으로 반환:
{
  "total_review_count": number,
  "overall_sentiment": {
    "positive_pct": number,
    "neutral_pct": number,
    "negative_pct": number,
    "overall": "positive" | "neutral" | "negative" | "mixed"
  },
  "cross_platform_themes": [
    {
      "theme": string,
      "appears_on": string[],
      "overall_sentiment": "positive" | "negative" | "mixed",
      "insight": string
    }
  ],
  "cross_platform_strengths": [
    { "point": string, "detail": string, "platforms": string[] }
  ],
  "cross_platform_weaknesses": [
    { "point": string, "detail": string, "platforms": string[] }
  ],
  "platform_comparison": [
    {
      "platform": string,
      "review_count": number,
      "average_rating": number | null,
      "sentiment": string,
      "unique_insight": string
    }
  ],
  "actionable_insights": [
    {
      "insight": string,
      "priority": "high" | "medium" | "low",
      "action": string,
      "expected_impact": string
    }
  ]
}`;
}

/**
 * 단일 판매처 리뷰 분석
 * @param {object} listing - { platform_type, listing_url, listing_name }
 * @returns {object} 구조화된 리뷰 분석 결과
 */
export async function analyzeListingReviews(listing) {
  const prompt = buildPlatformPrompt(listing);
  const result = await callClaude(prompt, SYSTEM_PROMPT, () => generateMockReview(listing));

  const parsed = parseClaudeJson(result, JSON.parse(generateMockReview(listing)));

  return {
    review_count: parsed.review_count || 0,
    average_rating: parsed.average_rating || null,
    sentiment_summary: parsed.sentiment_summary || { positive_pct: 0, neutral_pct: 0, negative_pct: 0, overall: "neutral" },
    themes: parsed.themes || [],
    strengths: parsed.strengths || [],
    weaknesses: parsed.weaknesses || [],
    notable_reviews: parsed.notable_reviews || [],
  };
}

/**
 * 크로스 플랫폼 종합 분석
 * @param {object} product - { name, category }
 * @param {Array} platformReviews - [{ platform_type, listing_name, analysis }]
 * @returns {object} 통합 분석 결과
 */
export async function aggregateProductReviews(product, platformReviews) {
  const prompt = buildAggregationPrompt(product, platformReviews);
  const mockResult = generateMockAggregation(product, platformReviews);
  const result = await callClaude(prompt, AGGREGATION_SYSTEM_PROMPT, () => mockResult);

  const parsed = parseClaudeJson(result, JSON.parse(mockResult));

  return {
    total_review_count: parsed.total_review_count || 0,
    overall_sentiment: parsed.overall_sentiment || { positive_pct: 0, neutral_pct: 0, negative_pct: 0, overall: "neutral" },
    cross_platform_themes: parsed.cross_platform_themes || [],
    cross_platform_strengths: parsed.cross_platform_strengths || [],
    cross_platform_weaknesses: parsed.cross_platform_weaknesses || [],
    platform_comparison: parsed.platform_comparison || [],
    actionable_insights: parsed.actionable_insights || [],
  };
}

const DELTA_SYSTEM_PROMPT = `You are a product review analyst. You are given scraped review texts from a Korean e-commerce platform.
Analyze the reviews and return structured insights in the exact JSON format requested.
If existing analysis data is provided, merge the new reviews into the existing analysis — update counts, themes, and sentiments accordingly.
Always respond in Korean.`;

/**
 * 스크래핑된 새 리뷰 텍스트를 Claude로 분석 (web_search 없이 — 비용 절감)
 * @param {object} listing - { platform_type, listing_name }
 * @param {Array} newReviews - [{ reviewText, rating, reviewDate, optionName }]
 * @param {object|null} existingAnalysis - 기존 분석 결과 (병합용)
 * @param {{ totalReviewCount, averageRating }} scrapeStats - 스크래핑된 총 리뷰 수/평점
 * @returns {object} 구조화된 리뷰 분석 결과
 */
export async function analyzeNewReviews(listing, newReviews, existingAnalysis, scrapeStats) {
  const reviewTexts = newReviews
    .map((r, i) => `[리뷰 ${i + 1}] 별점: ${r.rating || "없음"} | 옵션: ${r.optionName || "없음"} | 날짜: ${r.reviewDate || "없음"}\n${r.reviewText}`)
    .join("\n---\n");

  let prompt = `상품 "${listing.listing_name}" (${listing.platform_type})의 리뷰를 분석해주세요.

총 리뷰 수: ${scrapeStats.totalReviewCount}
평균 평점: ${scrapeStats.averageRating || "알 수 없음"}
새로 수집된 리뷰: ${newReviews.length}건

--- 새 리뷰 텍스트 ---
${reviewTexts}
`;

  if (existingAnalysis) {
    prompt += `\n--- 기존 분석 결과 (이전 리뷰 기반) ---
${JSON.stringify(existingAnalysis, null, 2)}

위 기존 분석에 새 리뷰 ${newReviews.length}건을 반영하여 업데이트된 분석을 반환해주세요.
기존 테마/강점/약점에 새로운 내용을 병합하고, 수치(mention_count 등)를 업데이트하세요.
`;
  }

  prompt += `\n분석 결과를 다음 JSON 형식으로 반환해주세요:\n${JSON_FORMAT}`;

  const mockData = generateMockReview(listing);
  const result = await callClaudeNoTools(prompt, DELTA_SYSTEM_PROMPT, () => mockData);
  const parsed = parseClaudeJson(result, JSON.parse(mockData));

  return {
    review_count: scrapeStats.totalReviewCount || parsed.review_count || 0,
    average_rating: scrapeStats.averageRating || parsed.average_rating || null,
    sentiment_summary: parsed.sentiment_summary || { positive_pct: 0, neutral_pct: 0, negative_pct: 0, overall: "neutral" },
    themes: parsed.themes || [],
    strengths: parsed.strengths || [],
    weaknesses: parsed.weaknesses || [],
    notable_reviews: parsed.notable_reviews || [],
  };
}

function generateMockReview(listing) {
  return JSON.stringify({
    review_count: 42,
    average_rating: 4.3,
    sentiment_summary: { positive_pct: 72, neutral_pct: 18, negative_pct: 10, overall: "positive" },
    themes: [
      { theme: "제품 품질", frequency: "high", sentiment: "positive", example_quotes: ["품질 좋아요", "가격 대비 훌륭합니다"] },
      { theme: "배송 속도", frequency: "medium", sentiment: "positive", example_quotes: ["빠른 배송", "다음날 도착"] },
      { theme: "포장 상태", frequency: "low", sentiment: "mixed", example_quotes: ["포장이 꼼꼼해요", "박스가 좀 찌그러져 옴"] },
    ],
    strengths: [
      { point: "가성비", detail: `"${listing.listing_name}" 가격 대비 품질이 우수하다는 평가 다수`, mention_count: 15 },
      { point: "사용 편의성", detail: "초보자도 쉽게 사용할 수 있다는 리뷰 다수", mention_count: 10 },
    ],
    weaknesses: [
      { point: "설명서 부족", detail: "사용 설명이 부실하다는 의견", mention_count: 5 },
      { point: "내구성 우려", detail: "장기 사용 시 내구성에 대한 우려 일부", mention_count: 3 },
    ],
    notable_reviews: [
      { summary: "3개월 사용 후 만족스럽다는 상세 리뷰", sentiment: "positive", rating: 5, key_point: "장기 사용 만족도 높음" },
      { summary: "타제품 대비 비교 리뷰", sentiment: "positive", rating: 4, key_point: "경쟁 제품 대비 우수" },
    ],
  });
}

function generateMockAggregation(product, platformReviews) {
  const platforms = platformReviews.map((r) => r.platform_type);
  return JSON.stringify({
    total_review_count: platformReviews.length * 42,
    overall_sentiment: { positive_pct: 70, neutral_pct: 20, negative_pct: 10, overall: "positive" },
    cross_platform_themes: [
      { theme: "제품 품질", appears_on: platforms, overall_sentiment: "positive", insight: "모든 플랫폼에서 제품 품질에 대한 긍정 평가" },
      { theme: "가격 만족", appears_on: platforms, overall_sentiment: "positive", insight: "가성비가 좋다는 의견이 전 플랫폼 공통" },
    ],
    cross_platform_strengths: [
      { point: "일관된 품질 평가", detail: `"${product.name}" 전 플랫폼에서 높은 품질 점수`, platforms },
    ],
    cross_platform_weaknesses: [
      { point: "설명서/가이드 부족", detail: "사용법 안내가 부실하다는 의견 공통", platforms },
    ],
    platform_comparison: platformReviews.map((r) => ({
      platform: r.platform_type,
      review_count: 42,
      average_rating: 4.3,
      sentiment: "positive",
      unique_insight: `${r.platform_type}에서 특히 배송/포장에 대한 언급 많음`,
    })),
    actionable_insights: [
      { insight: "제품 사용 가이드 개선 필요", priority: "high", action: "상세 사용 설명서 또는 영상 가이드 제작", expected_impact: "부정 리뷰 30% 감소 예상" },
      { insight: "리뷰에서 가성비 강조 빈번", priority: "medium", action: "광고 카피에 가성비 메시지 반영", expected_impact: "전환율 10-15% 개선 예상" },
    ],
  });
}

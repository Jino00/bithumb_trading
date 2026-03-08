// 데이터 기반 광고 카피 생성 서비스 — 리뷰 인사이트 + Ad Library 패턴 + 트렌드 → Claude 카피 생성
import { getDb } from "../db/database.js";
import { callClaudeNoTools, callClaudeWithVision, parseClaudeJson } from "./claude-client.js";
import { getTrendContextForCopy } from "./trend-bridge.js";

const SYSTEM_PROMPT = `당신은 한국 시장 전문 Meta Ads 카피라이터입니다.
제공된 고객 리뷰 인사이트와 경쟁사 광고 분석 데이터를 기반으로 효과적인 광고 카피를 작성합니다.

핵심 원칙:
1. 고객이 실제로 사용하는 표현과 언급하는 장점을 카피에 반영
2. 경쟁사 광고에서 검증된 메시징 패턴을 참고하되 차별화
3. 약점/불만 포인트는 피하거나, 해결했음을 강조
4. 데이터 근거(리뷰 수, 평점 등)를 활용하여 신뢰감 구축
5. 주력 매체는 Instagram — 기본 문구(primary_text)는 인스타 피드에서 "더보기" 클릭 없이 한눈에 읽히는 길이로 작성 (한글 55자 이내). 길고 장황한 카피는 금지
6. 이미지가 첨부된 경우: 시각적 요소(색상, 구도, 제품 외형, 분위기)를 분석하고 이를 카피에 자연스럽게 반영. 카피가 해당 이미지와 함께 광고에 사용된다는 전제로 작성
7. 영상 분석 리포트가 제공된 경우: 장면 구성, 나레이션, 감정 흐름, 화면 텍스트 등을 카피에 깊이 반영. 단순 이미지 묘사가 아닌, 영상 전체의 서사와 메시지를 카피에 녹여야 함

반드시 아래 JSON 형식으로만 응답하세요.`;

const COPY_JSON_FORMAT = `{
  "copies": [
    {
      "primary_text": "기본 문구 — 인스타그램 피드에서 '더보기' 없이 한눈에 보여야 함. 한글 기준 55자 이내(영문 혼합 시 125자 이내). 핵심 메시지 1~2문장으로 압축. 이모지 1~2개 허용. 줄바꿈 없이 한 줄로 작성",
      "headline": "제목 — 이미지/영상 아래 굵은 글씨. 25자 이내. 핵심 가치 한 줄 압축",
      "description": "설명 — 제목 아래 보조 텍스트. 30자 이내. 리뷰 수, 혜택, 프로모션 등 보조 정보",
      "cta": "CTA 버튼 텍스트 (SHOP_NOW, LEARN_MORE 등)",
      "rationale": "이 카피를 작성한 근거 (어떤 리뷰 데이터/광고 패턴을 참고했는지)"
    }
  ]
}`;

const TONE_DESCRIPTIONS = {
  professional: "전문적이고 신뢰감 있는 톤 (데이터, 전문 용어 활용)",
  casual: "친근하고 대화하듯 편안한 톤 (이모지, 구어체 활용)",
  urgent: "긴급감과 FOMO를 주는 톤 (한정, 마감, 기회 강조)",
  emotional: "감성적이고 공감을 이끄는 톤 (스토리텔링, 감정 호소)",
  humorous: "유머러스하고 위트 있는 톤 (재치, 반전, 밈 활용)",
};

const PLATFORM_GUIDELINES = {
  facebook: "Facebook: 기본 문구(primary_text) 125자 권장, 제목(headline) 25자 이내, 설명(description) 30자 이내, CTA 명확하게",
  instagram: "Instagram (주력 매체): 기본 문구는 '더보기' 없이 한눈에 보이도록 한글 55자 이내로 작성. 이모지 1~2개 자연스럽게 배치. 제목 25자 이내, 설명 30자 이내",
  both: "Instagram 중심 (주력 매체): 기본 문구는 인스타 피드에서 '더보기' 없이 보이는 한글 55자 이내. 이모지 1~2개 허용. 제목 25자 이내, 설명 30자 이내",
};

/**
 * 광고 카피 생성 메인 함수
 * @param {number} productId - 제품 ID
 * @param {object} options - { copy_type, platform, tone, custom_instruction }
 * @returns {object} { copies, context_summary, review_context, ad_library_context }
 */
export async function generateAdCopy(productId, options = {}, mediaContext = null, videoAnalysis = null) {
  const { copy_type = "full", platform = "facebook", tone = "professional", custom_instruction = "" } = options;

  const reviewContext = gatherReviewContext(productId);
  const adLibraryContext = gatherAdLibraryContext(productId);
  const pastSuccesses = gatherPastSuccesses(productId);

  const prompt = buildCopyPrompt(reviewContext, adLibraryContext, pastSuccesses, {
    copy_type, platform, tone, custom_instruction,
  }, mediaContext, videoAnalysis);

  // 미디어가 첨부되면 Vision API, 아니면 기존 텍스트 전용 API
  let result;
  if (mediaContext?.base64) {
    console.log(`[Ad Copy] Using Vision API for media analysis (${mediaContext.originalType})`);
    result = await callClaudeWithVision(
      prompt, SYSTEM_PROMPT,
      { base64: mediaContext.base64, mediaType: mediaContext.mediaType },
      () => generateMockCopy(reviewContext),
    );
  } else {
    result = await callClaudeNoTools(prompt, SYSTEM_PROMPT, () => generateMockCopy(reviewContext));
  }

  const parsed = parseClaudeJson(result, JSON.parse(generateMockCopy(reviewContext)));

  const copies = (parsed.copies || []).map((c) => ({
    primary_text: c.primary_text || c.body || "",
    headline: c.headline || "",
    description: c.description || "",
    body: c.primary_text || c.body || "",  // 하위 호환성 유지
    cta: c.cta || "SHOP_NOW",
    rationale: c.rationale || "",
    data_sources: {
      review_themes: extractUsedThemes(c.rationale, reviewContext),
      ad_patterns: extractUsedPatterns(c.rationale, adLibraryContext),
    },
  }));

  const contextSummary = {
    reviews_used: {
      total_count: reviewContext.totalReviewCount,
      themes: reviewContext.themes.length,
      strengths: reviewContext.strengths.length,
    },
    ad_library_used: {
      searches: adLibraryContext.searchCount,
      patterns: adLibraryContext.messagingPatterns.length,
      trends: adLibraryContext.trends.length,
    },
  };

  return { copies, context_summary: contextSummary, review_context: reviewContext, ad_library_context: adLibraryContext };
}

/**
 * DB에서 해당 제품의 리뷰 인사이트 수집
 */
function gatherReviewContext(productId) {
  const db = getDb();

  const aggregation = db.prepare("SELECT * FROM product_review_aggregations WHERE product_id = ?").get(productId);
  const reviews = db.prepare("SELECT * FROM product_reviews WHERE product_id = ? ORDER BY analyzed_at DESC").all(productId);
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);

  if (!aggregation && reviews.length === 0) {
    return {
      productName: product?.name || "알 수 없음",
      category: product?.category || "일반",
      totalReviewCount: 0,
      overallRating: null,
      overallSentiment: null,
      themes: [],
      strengths: [],
      weaknesses: [],
      customerQuotes: [],
    };
  }

  const themes = aggregation ? JSON.parse(aggregation.cross_platform_themes || "[]") : [];
  const strengths = aggregation ? JSON.parse(aggregation.cross_platform_strengths || "[]") : [];
  const weaknesses = aggregation ? JSON.parse(aggregation.cross_platform_weaknesses || "[]") : [];
  const overallSentiment = aggregation ? JSON.parse(aggregation.overall_sentiment || "{}") : {};

  // 각 플랫폼 리뷰에서 고객 인용문 수집
  const customerQuotes = [];
  for (const review of reviews) {
    const notables = JSON.parse(review.notable_reviews || "[]");
    for (const n of notables) {
      if (n.sentiment === "positive" && n.summary) {
        customerQuotes.push({ quote: n.summary, key_point: n.key_point, platform: review.platform_type });
      }
    }
  }

  // 각 플랫폼 리뷰에서 테마별 인용문 수집
  const themeQuotes = [];
  for (const review of reviews) {
    const reviewThemes = JSON.parse(review.themes || "[]");
    for (const t of reviewThemes) {
      if (t.example_quotes?.length > 0) {
        themeQuotes.push({ theme: t.theme, quotes: t.example_quotes.slice(0, 2), sentiment: t.sentiment });
      }
    }
  }

  return {
    productName: product?.name || "알 수 없음",
    category: product?.category || "일반",
    totalReviewCount: aggregation?.total_review_count || reviews.reduce((sum, r) => sum + (r.review_count || 0), 0),
    overallRating: reviews[0]?.average_rating || null,
    overallSentiment,
    themes,
    strengths,
    weaknesses,
    customerQuotes: customerQuotes.slice(0, 10),
    themeQuotes: themeQuotes.slice(0, 10),
  };
}

/**
 * DB에서 관련 Ad Library 인사이트 수집
 */
function gatherAdLibraryContext(productId) {
  const db = getDb();

  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
  const category = product?.category || "";

  // 최근 5건의 Ad Library 분석 가져오기 (최신 순)
  const adReviews = db.prepare("SELECT * FROM ad_library_reviews ORDER BY created_at DESC LIMIT 5").all();

  if (adReviews.length === 0) {
    return { searchCount: 0, messagingPatterns: [], styles: [], trends: [], keyTakeaways: [] };
  }

  const allPatterns = [];
  const allStyles = [];
  const allTrends = [];
  const allTakeaways = [];

  for (const review of adReviews) {
    const patterns = JSON.parse(review.messaging_patterns || "[]");
    const styles = JSON.parse(review.styles || "[]");
    const trends = JSON.parse(review.trends || "[]");
    const takeaways = JSON.parse(review.key_takeaways || "[]");

    allPatterns.push(...patterns);
    allStyles.push(...styles);
    allTrends.push(...trends);
    allTakeaways.push(...takeaways);
  }

  return {
    searchCount: adReviews.length,
    messagingPatterns: deduplicateByName(allPatterns, "pattern_name").slice(0, 8),
    styles: deduplicateByName(allStyles, "style_name").slice(0, 5),
    trends: deduplicateByName(allTrends, "trend_name").slice(0, 5),
    keyTakeaways: allTakeaways.slice(0, 8),
  };
}

/**
 * 과거 피드백 + 실제 캠페인 성과가 좋았던 카피 패턴 수집
 */
function gatherPastSuccesses(productId) {
  const db = getDb();

  // 1. 사용자 피드백이 좋았던 카피
  const feedbackCopies = db.prepare(`
    SELECT generated_copies, user_feedback, selected_copy_index
    FROM ad_copy_generations
    WHERE product_id = ? AND user_feedback IS NOT NULL
    ORDER BY created_at DESC LIMIT 10
  `).all(productId);

  const successes = [];
  for (const row of feedbackCopies) {
    const feedback = JSON.parse(row.user_feedback || "{}");
    if (feedback.rating >= 4) {
      const copies = JSON.parse(row.generated_copies || "[]");
      const idx = row.selected_copy_index ?? feedback.selected_index ?? 0;
      const selectedCopy = copies[idx] || copies[0];
      if (selectedCopy) {
        successes.push({
          headline: selectedCopy.headline,
          body: selectedCopy.body,
          cta: selectedCopy.cta,
          rating: feedback.rating,
          notes: feedback.notes || null,
          source: "user_feedback",
        });
      }
    }
  }

  // 2. 실제 캠페인 성과 데이터가 있는 카피
  const performanceCopies = db.prepare(`
    SELECT generated_copies, performance_data, selected_copy_index
    FROM ad_copy_generations
    WHERE product_id = ? AND performance_data IS NOT NULL
    ORDER BY created_at DESC LIMIT 10
  `).all(productId);

  for (const row of performanceCopies) {
    const perf = JSON.parse(row.performance_data || "{}");
    // CTR > 2% 또는 ROAS > 3x이면 "성과 좋은 카피"로 판단
    if ((perf.ctr && perf.ctr >= 2.0) || (perf.roas && perf.roas >= 3.0)) {
      const copies = JSON.parse(row.generated_copies || "[]");
      const idx = row.selected_copy_index ?? 0;
      const selectedCopy = copies[idx] || copies[0];
      if (selectedCopy) {
        successes.push({
          headline: selectedCopy.headline,
          body: selectedCopy.body,
          cta: selectedCopy.cta,
          performance: { ctr: perf.ctr, roas: perf.roas, conversions: perf.conversions },
          source: "campaign_performance",
        });
      }
    }
  }

  // 3. 성과가 나빴던 카피 (피해야 할 패턴)
  const failures = [];
  for (const row of performanceCopies) {
    const perf = JSON.parse(row.performance_data || "{}");
    if ((perf.ctr && perf.ctr < 1.0) || (perf.roas && perf.roas < 1.5)) {
      const copies = JSON.parse(row.generated_copies || "[]");
      const idx = row.selected_copy_index ?? 0;
      const selectedCopy = copies[idx] || copies[0];
      if (selectedCopy) {
        failures.push({
          headline: selectedCopy.headline,
          performance: { ctr: perf.ctr, roas: perf.roas },
          source: "campaign_performance",
        });
      }
    }
  }

  return { successes: successes.slice(0, 5), failures: failures.slice(0, 3) };
}

/**
 * Claude용 카피 생성 프롬프트 구성
 */
function buildCopyPrompt(reviewCtx, adLibCtx, pastCtx, options, mediaContext = null, videoAnalysis = null) {
  const { copy_type, platform, tone, custom_instruction } = options;

  let prompt = `## 광고 카피 생성 요청

**제품**: ${reviewCtx.productName} (카테고리: ${reviewCtx.category})
**카피 유형**: ${copy_type === "full" ? "헤드라인 + 본문 + CTA" : copy_type}
**플랫폼**: ${PLATFORM_GUIDELINES[platform] || PLATFORM_GUIDELINES.both}
**톤앤매너**: ${TONE_DESCRIPTIONS[tone] || TONE_DESCRIPTIONS.professional}

---

## 📊 고객 리뷰 인사이트 (데이터 기반)

총 리뷰: ${reviewCtx.totalReviewCount.toLocaleString()}건
`;

  if (reviewCtx.overallRating) {
    prompt += `평균 평점: ${reviewCtx.overallRating}점\n`;
  }

  if (reviewCtx.overallSentiment?.overall) {
    prompt += `전반적 감정: ${reviewCtx.overallSentiment.overall} (긍정 ${reviewCtx.overallSentiment.positive_pct}%, 부정 ${reviewCtx.overallSentiment.negative_pct}%)\n`;
  }

  if (reviewCtx.strengths.length > 0) {
    prompt += `\n### 고객이 가장 많이 언급한 강점 (광고에 적극 활용)\n`;
    for (const s of reviewCtx.strengths) {
      prompt += `- **${s.point}**: ${s.detail}\n`;
    }
  }

  if (reviewCtx.weaknesses.length > 0) {
    prompt += `\n### 고객 불만 포인트 (광고에서 피하거나 해결 강조)\n`;
    for (const w of reviewCtx.weaknesses) {
      prompt += `- ${w.point}: ${w.detail}\n`;
    }
  }

  if (reviewCtx.themes.length > 0) {
    prompt += `\n### 주요 리뷰 테마\n`;
    for (const t of reviewCtx.themes) {
      prompt += `- ${t.theme} (${t.overall_sentiment || t.sentiment || "neutral"}): ${t.insight || ""}\n`;
    }
  }

  if (reviewCtx.themeQuotes?.length > 0) {
    prompt += `\n### 고객이 실제 사용한 표현 (카피에 반영 가능)\n`;
    for (const tq of reviewCtx.themeQuotes.slice(0, 5)) {
      prompt += `- [${tq.theme}] "${tq.quotes.join('", "')}" (${tq.sentiment})\n`;
    }
  }

  if (reviewCtx.customerQuotes.length > 0) {
    prompt += `\n### 주목할 만한 긍정 리뷰 요약\n`;
    for (const q of reviewCtx.customerQuotes.slice(0, 5)) {
      prompt += `- ${q.quote} — 핵심: ${q.key_point} (${q.platform})\n`;
    }
  }

  if (adLibCtx.searchCount > 0) {
    prompt += `\n---\n\n## 🔍 경쟁사 광고 분석 인사이트 (Ad Library 기반)\n\n`;
    prompt += `분석된 검색: ${adLibCtx.searchCount}건\n`;

    if (adLibCtx.messagingPatterns.length > 0) {
      prompt += `\n### 효과적인 메시징 패턴\n`;
      for (const p of adLibCtx.messagingPatterns.slice(0, 5)) {
        prompt += `- **${p.pattern_name}**: ${p.description}\n`;
        if (p.example_headlines?.length > 0) {
          prompt += `  - 헤드라인 예시: "${p.example_headlines.slice(0, 2).join('", "')}"\n`;
        }
        if (p.cta_types?.length > 0) {
          prompt += `  - CTA: ${p.cta_types.join(", ")}\n`;
        }
      }
    }

    if (adLibCtx.trends.length > 0) {
      prompt += `\n### 현재 광고 트렌드\n`;
      for (const t of adLibCtx.trends.slice(0, 3)) {
        prompt += `- **${t.trend_name}** (${t.prevalence}): ${t.description}\n`;
      }
    }

    if (adLibCtx.keyTakeaways.length > 0) {
      prompt += `\n### 핵심 인사이트\n`;
      for (const k of adLibCtx.keyTakeaways.slice(0, 3)) {
        prompt += `- ${k.insight} → ${k.actionable_tip}\n`;
      }
    }
  }

  // ─── 📈 트렌드 섹션 (최신 업계 동향 주입) ───
  try {
    const trendContext = getTrendContextForCopy();
    if (trendContext) {
      prompt += `\n---\n\n## 📈 현재 Meta Ads 트렌드 (실시간 업계 동향)\n\n`;
      prompt += trendContext;
      prompt += `\n\n이 트렌드 정보를 참고하여 현재 효과적인 광고 패턴과 표현을 카피에 반영하세요.\n`;
    }
  } catch { /* 트렌드 데이터 없으면 건너뛰기 */ }

  if (pastCtx.successes?.length > 0) {
    prompt += `\n---\n\n## ⭐ 과거 성공한 카피 패턴 (이런 방향으로 작성)\n\n`;
    for (const p of pastCtx.successes) {
      if (p.source === "campaign_performance") {
        prompt += `- 헤드라인: "${p.headline}" / CTA: "${p.cta}" — 실제 성과: CTR ${p.performance?.ctr}%, ROAS ${p.performance?.roas}x\n`;
      } else {
        prompt += `- 헤드라인: "${p.headline}" / CTA: "${p.cta}" — 사용자 평점: ${p.rating}/5\n`;
        if (p.notes) prompt += `  메모: ${p.notes}\n`;
      }
    }
  }

  if (pastCtx.failures?.length > 0) {
    prompt += `\n### ❌ 성과가 좋지 않았던 카피 패턴 (이런 방향은 피하기)\n`;
    for (const f of pastCtx.failures) {
      prompt += `- 헤드라인: "${f.headline}" — CTR ${f.performance?.ctr}%, ROAS ${f.performance?.roas}x\n`;
    }
  }

  // 미디어 첨부 시 시각적 분석 지시
  if (mediaContext) {
    prompt += `\n---\n\n## 🖼️ 첨부 미디어 분석 지시\n\n`;
    if (mediaContext.originalType === "video" && videoAnalysis) {
      prompt += `이 요청에는 비디오에서 추출한 대표 프레임 이미지가 첨부되어 있으며, 별도의 AI 영상 분석 리포트도 함께 제공됩니다.\n`;
      prompt += `대표 프레임의 시각적 요소와 아래 영상 분석 리포트를 모두 참고하여 카피를 작성해주세요.\n`;
    } else {
      prompt += `이 요청에는 ${mediaContext.originalType === "video" ? "비디오에서 추출한 대표 프레임 이미지" : "이미지"}가 첨부되어 있습니다.\n`;
      prompt += `첨부된 미디어의 시각적 요소(색상, 구도, 제품 외형, 분위기, 텍스트 등)를 분석하고 이를 광고 카피에 반영해주세요.\n`;
    }
    prompt += `카피는 이 이미지/비디오가 광고 크리에이티브로 함께 사용된다는 전제로 작성해주세요.\n`;

    if (mediaContext.emphasis) {
      prompt += `\n### 사용자 강조 포인트\n`;
      prompt += `사용자가 이 미디어에서 특히 강조하고 싶은 점: "${mediaContext.emphasis}"\n`;
      prompt += `이 강조 포인트를 카피의 핵심 메시지로 반영해주세요.\n`;
    }
  }

  // Gemini 영상 분석 리포트 주입
  if (videoAnalysis) {
    prompt += `\n---\n\n${videoAnalysis}\n`;
    prompt += `\n위 영상 분석 리포트를 참고하여, 영상의 스토리/장면/감정 흐름을 카피에 반영해주세요.\n`;
    prompt += `단순히 한 프레임만 보는 것이 아니라, 영상 전체의 서사와 메시지를 카피에 녹여주세요.\n`;
  }

  if (custom_instruction) {
    prompt += `\n---\n\n## 💬 추가 요구사항\n${custom_instruction}\n`;
  }

  prompt += `\n---\n\n위 데이터를 기반으로 **${copy_type === "full" ? "헤드라인 + 본문 + CTA" : copy_type} 광고 카피 5개**를 생성해주세요.
각 카피마다 어떤 데이터를 참고했는지 rationale에 명시하세요.

JSON 형식:\n${COPY_JSON_FORMAT}`;

  return prompt;
}

/**
 * rationale에서 사용된 리뷰 테마 추출
 */
function extractUsedThemes(rationale, reviewCtx) {
  if (!rationale || !reviewCtx.themes) return [];
  return reviewCtx.themes
    .filter((t) => rationale.includes(t.theme))
    .map((t) => t.theme)
    .slice(0, 3);
}

/**
 * rationale에서 사용된 광고 패턴 추출
 */
function extractUsedPatterns(rationale, adLibCtx) {
  if (!rationale || !adLibCtx.messagingPatterns) return [];
  return adLibCtx.messagingPatterns
    .filter((p) => rationale.includes(p.pattern_name))
    .map((p) => p.pattern_name)
    .slice(0, 3);
}

/**
 * 이름 기반 중복 제거
 */
function deduplicateByName(items, nameField) {
  const seen = new Set();
  return items.filter((item) => {
    const name = item[nameField];
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/**
 * Mock 카피 생성 (API 키 없을 때 fallback)
 */
function generateMockCopy(reviewCtx) {
  return JSON.stringify({
    copies: [
      {
        primary_text: `리뷰 ${reviewCtx.totalReviewCount.toLocaleString()}건이 증명하는 ${reviewCtx.productName} ✨ 직접 확인해보세요`,
        headline: `${reviewCtx.totalReviewCount.toLocaleString()}명이 선택한 ${reviewCtx.productName}`,
        description: `평점 ${reviewCtx.overallRating || 4.5}점 · 무료배송`,
        cta: "SHOP_NOW",
        rationale: `총 리뷰 ${reviewCtx.totalReviewCount}건의 데이터를 기반으로 숫자 강조 패턴을 활용한 신뢰 구축형 카피.`,
      },
      {
        primary_text: `고객이 인정한 품질, 직접 경험해보세요 🙌`,
        headline: `${reviewCtx.productName}, 후회 없는 선택`,
        description: `리뷰 ${reviewCtx.totalReviewCount.toLocaleString()}건 · 지금 확인`,
        cta: "SHOP_NOW",
        rationale: `긍정적 전반 감정(${reviewCtx.overallSentiment?.positive_pct || 70}%)을 반영한 감성 어필형 카피.`,
      },
      {
        primary_text: `한정 수량! 베스트셀러를 특별 가격에 🔥`,
        headline: `지금 놓치면 후회할 ${reviewCtx.productName}`,
        description: `오늘만 특별 혜택`,
        cta: "SHOP_NOW",
        rationale: `긴급감(FOMO) 패턴 + 베스트셀러 소셜 프루프 활용.`,
      },
    ],
  });
}

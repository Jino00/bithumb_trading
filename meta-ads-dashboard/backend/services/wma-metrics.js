// WMA(가중이동평균) 계산 모듈 — 7일 일별 데이터를 최근일 가중 평균으로 변환
// daily-review.js에서 사용: 평탄한 7일 집계 대신 최근 추세를 반영한 지표 산출
// 순수 함수만 포함 — DB/API 접근 없음

// 사용자 승인 가중치: Day1(7일전) → Day7(오늘)
const DEFAULT_WEIGHTS = [0.05, 0.05, 0.10, 0.15, 0.15, 0.20, 0.30];

const MIN_DAYS_FOR_WMA = 3;

/**
 * 일별 데이터 배열 → WMA 기반 캠페인 메트릭 산출
 * @param {Array<{date, spend, revenue, purchases, clicks, impressions, ctr, cpc, frequency, roas, landing_page_views?, content_views?, add_to_cart?, initiate_checkout?}>} dailyRows
 *   날짜 오름차순 정렬된 일별 데이터
 * @param {number[]} weights — 가중치 배열 (오래된 날 → 최근 날)
 * @returns {{ roas, cpc, ctr, frequency, spend, revenue, purchases, clicks, impressions, daily_spend, aov, cpa,
 *             landing_page_views, content_views, add_to_cart_count, initiate_checkout_count,
 *             trend_direction, day_count, insufficient }}
 */
export function calcWmaMetrics(dailyRows, weights = DEFAULT_WEIGHTS) {
  if (!dailyRows || dailyRows.length === 0) {
    return buildEmptyResult(true);
  }

  // 3일 미만 → WMA 부적합, insufficient 플래그
  if (dailyRows.length < MIN_DAYS_FOR_WMA) {
    return buildFallbackResult(dailyRows);
  }

  const w = renormalizeWeights(weights, dailyRows.length);

  // ─── SUM 기반 메트릭 (절대 금액 → 가중 적용 ❌) ───
  const spend = sumField(dailyRows, "spend");
  const revenue = sumField(dailyRows, "revenue");
  const purchases = sumField(dailyRows, "purchases");
  const clicks = sumField(dailyRows, "clicks");
  const impressions = sumField(dailyRows, "impressions");

  // 퍼널 데이터 (SUM)
  const landingPageViews = sumField(dailyRows, "landing_page_views");
  const contentViews = sumField(dailyRows, "content_views");
  const addToCart = sumField(dailyRows, "add_to_cart");
  const initiateCheckout = sumField(dailyRows, "initiate_checkout");

  // ─── WMA 기반 메트릭 (최근일 가중) ───

  // ROAS: 가중-소진-정규화 (소진 적은 날의 ROAS 폭발 방지)
  const roas = calcWeightedRoas(dailyRows, w);

  // CPC: 클릭 > 0인 날만 포함, 가중치 재정규화
  const cpc = calcWeightedCpcFiltered(dailyRows, w);

  // CTR, Frequency: 단순 가중 평균
  const ctr = calcWeightedAvg(dailyRows, w, "ctr");
  const frequency = calcWeightedAvg(dailyRows, w, "frequency");

  // 파생 메트릭
  const dailySpend = spend > 0 ? round2(spend / dailyRows.length) : 0;
  const aov = purchases > 0 ? Math.round(revenue / purchases) : 0;
  const cpa = purchases > 0 ? Math.round(spend / purchases) : 0;

  // 추세 방향
  const trendDirection = determineTrendDirection(dailyRows);

  return {
    roas: round2(roas),
    cpc: round2(cpc),
    ctr: round2(ctr),
    frequency: round2(frequency),
    spend,
    revenue,
    purchases,
    clicks,
    impressions,
    daily_spend: dailySpend,
    aov,
    cpa,
    landing_page_views: landingPageViews,
    content_views: contentViews,
    add_to_cart_count: addToCart,
    initiate_checkout_count: initiateCheckout,
    trend_direction: trendDirection,
    day_count: dailyRows.length,
    insufficient: false,
  };
}

/**
 * N일 데이터에 맞게 가중치 배열 재정규화
 * 7일 가중치에서 마지막 N개를 잘라 합이 1.0이 되도록 조정
 * @param {number[]} weights — 원본 가중치 (7개)
 * @param {number} actualDays — 실제 데이터 일수 (3~7)
 * @returns {number[]} 재정규화된 가중치 배열
 */
export function renormalizeWeights(weights, actualDays) {
  if (actualDays >= weights.length) return [...weights];

  // 마지막 N일의 가중치를 잘라서 사용
  const sliced = weights.slice(weights.length - actualDays);
  const sum = sliced.reduce((s, v) => s + v, 0);
  if (sum === 0) return sliced.map(() => 1 / actualDays);

  return sliced.map((v) => v / sum);
}

/**
 * ROAS 추세 방향 판정
 * 최근 3일 가중 ROAS vs 이전 4일 가중 ROAS 비교
 * @returns {"improving" | "declining" | "flat"}
 */
export function determineTrendDirection(dailyRows) {
  if (!dailyRows || dailyRows.length < MIN_DAYS_FOR_WMA) return "flat";

  // 최근 3일과 이전 일수 분리
  const recentCount = Math.min(3, Math.floor(dailyRows.length / 2) + 1);
  const earlyCount = dailyRows.length - recentCount;

  if (earlyCount < 1) return "flat";

  const earlyDays = dailyRows.slice(0, earlyCount);
  const recentDays = dailyRows.slice(earlyCount);

  const earlyRoas = calcSimpleRoas(earlyDays);
  const recentRoas = calcSimpleRoas(recentDays);

  // 둘 다 0이면 판정 불가
  if (earlyRoas === 0 && recentRoas === 0) return "flat";

  // 이전이 0인데 최근이 양수면 개선
  if (earlyRoas === 0 && recentRoas > 0) return "improving";

  // 최근이 0인데 이전이 양수면 하락
  if (recentRoas === 0 && earlyRoas > 0) return "declining";

  // 15% 이상 차이면 방향 판정
  if (recentRoas > earlyRoas * 1.15) return "improving";
  if (recentRoas < earlyRoas * 0.85) return "declining";

  return "flat";
}

// ─── 내부 헬퍼 ───

function calcWeightedRoas(rows, weights) {
  // 가중-소진-정규화: SUM(w_i × revenue_i) / SUM(w_i × spend_i)
  let weightedRevenue = 0;
  let weightedSpend = 0;

  for (let i = 0; i < rows.length; i++) {
    weightedRevenue += weights[i] * (rows[i].revenue || 0);
    weightedSpend += weights[i] * (rows[i].spend || 0);
  }

  if (weightedSpend === 0) return 0;
  return weightedRevenue / weightedSpend;
}

function calcWeightedCpcFiltered(rows, weights) {
  // 클릭 > 0인 날만 포함, 가중치 재정규화
  let totalWeight = 0;
  let weightedCpc = 0;

  for (let i = 0; i < rows.length; i++) {
    if ((rows[i].clicks || 0) > 0 && (rows[i].cpc || 0) > 0) {
      weightedCpc += weights[i] * rows[i].cpc;
      totalWeight += weights[i];
    }
  }

  if (totalWeight === 0) return 0;
  return weightedCpc / totalWeight;
}

function calcWeightedAvg(rows, weights, field) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    total += weights[i] * (rows[i][field] || 0);
  }
  return total;
}

function calcSimpleRoas(rows) {
  const spend = rows.reduce((s, d) => s + (d.spend || 0), 0);
  const revenue = rows.reduce((s, d) => s + (d.revenue || 0), 0);
  if (spend === 0) return 0;
  return revenue / spend;
}

function sumField(rows, field) {
  return rows.reduce((s, d) => s + (d[field] || 0), 0);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function buildEmptyResult(insufficient) {
  return {
    roas: 0, cpc: 0, ctr: 0, frequency: 0,
    spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0,
    daily_spend: 0, aov: 0, cpa: 0,
    landing_page_views: 0, content_views: 0,
    add_to_cart_count: 0, initiate_checkout_count: 0,
    trend_direction: "flat", day_count: 0, insufficient,
  };
}

function buildFallbackResult(rows) {
  // 3일 미만: 단순 집계 (WMA 미적용) + insufficient 플래그
  const spend = sumField(rows, "spend");
  const revenue = sumField(rows, "revenue");
  const purchases = sumField(rows, "purchases");
  const clicks = sumField(rows, "clicks");
  const impressions = sumField(rows, "impressions");
  const roas = spend > 0 ? revenue / spend : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const frequency = rows.length > 0
    ? rows.reduce((s, d) => s + (d.frequency || 0), 0) / rows.length
    : 0;

  return {
    roas: round2(roas), cpc: round2(cpc), ctr: round2(ctr), frequency: round2(frequency),
    spend, revenue, purchases, clicks, impressions,
    daily_spend: rows.length > 0 ? round2(spend / rows.length) : 0,
    aov: purchases > 0 ? Math.round(revenue / purchases) : 0,
    cpa: purchases > 0 ? Math.round(spend / purchases) : 0,
    landing_page_views: sumField(rows, "landing_page_views"),
    content_views: sumField(rows, "content_views"),
    add_to_cart_count: sumField(rows, "add_to_cart"),
    initiate_checkout_count: sumField(rows, "initiate_checkout"),
    trend_direction: "flat", day_count: rows.length, insufficient: true,
  };
}

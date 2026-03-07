// Meta Pixel vs Cafe24 Admin API 크로스 검증 서비스 — 데이터 정합성 검증 + 고도화
import { getDb } from "../db/database.js";

/**
 * 크로스 검증: Meta Pixel 데이터 vs Cafe24 실제 주문 데이터
 *
 * 3가지 데이터 소스를 비교:
 *   1. Meta API purchase_roas / action_values (Pixel 기반)
 *   2. Cafe24 Admin API 주문 (실제 결제 완료)
 *   3. UTM 파라미터 기반 매칭 (광고→주문 연결)
 *
 * 목표: 데이터 불일치 감지 + 원인 진단 + 보정된 ROAS 산출
 */
export function crossValidate(startDate, endDate) {
  const db = getDb();

  // 1. Meta 캠페인 데이터 (Pixel 기반 — DB에 저장된 값)
  const metaCampaigns = db.prepare(`
    SELECT id, name, meta_campaign_id, total_spend, revenue, purchase_count,
           roas, ctr, cpc, clicks, conversions,
           landing_page_views, content_views, add_to_cart_count, initiate_checkout_count
    FROM campaigns
    WHERE source = 'meta' AND status = 'active'
  `).all();

  // 2. Cafe24 주문 데이터 (실제 결제 — DB에 동기화된 값)
  const cafe24Orders = db.prepare(`
    SELECT order_id, order_date, total_amount, item_count, product_names,
           utm_source, utm_campaign
    FROM cafe24_orders
    WHERE order_date >= ? AND order_date <= ?
    ORDER BY order_date DESC
  `).all(startDate, endDate + "T23:59:59");

  // 3. 집계
  const cafe24Total = aggregateCafe24(cafe24Orders);
  const metaTotal = aggregateMeta(metaCampaigns);
  const utmMatching = matchByUtm(metaCampaigns, cafe24Orders);

  // 4. 불일치 진단
  const discrepancies = diagnoseDiscrepancies(metaTotal, cafe24Total, utmMatching);

  // 5. 보정된 ROAS 계산
  const correctedMetrics = computeCorrectedMetrics(metaTotal, cafe24Total, utmMatching);

  // 6. 데이터 품질 점수
  const qualityScore = computeDataQualityScore(metaTotal, cafe24Total, utmMatching, discrepancies);

  return {
    period: { start: startDate, end: endDate },
    meta_pixel: metaTotal,
    cafe24_actual: cafe24Total,
    utm_matching: utmMatching,
    discrepancies,
    corrected_metrics: correctedMetrics,
    quality_score: qualityScore,
    recommendations: generateRecommendations(discrepancies, qualityScore),
    validated_at: new Date().toISOString(),
  };
}

/**
 * Cafe24 주문 데이터 집계
 */
function aggregateCafe24(orders) {
  const metaSources = ["facebook", "fb", "meta", "ig"];
  const metaOrders = orders.filter((o) => metaSources.includes(o.utm_source));
  const nonMetaOrders = orders.filter((o) => !metaSources.includes(o.utm_source));
  const noUtmOrders = orders.filter((o) => !o.utm_source);

  // UTM 캠페인별 집계
  const byCampaign = {};
  for (const order of metaOrders) {
    const name = order.utm_campaign || "(UTM 캠페인 미지정)";
    if (!byCampaign[name]) {
      byCampaign[name] = { orders: 0, revenue: 0 };
    }
    byCampaign[name].orders += 1;
    byCampaign[name].revenue += order.total_amount;
  }

  return {
    total_orders: orders.length,
    total_revenue: sumField(orders, "total_amount"),
    meta_attributed_orders: metaOrders.length,
    meta_attributed_revenue: sumField(metaOrders, "total_amount"),
    non_meta_orders: nonMetaOrders.length,
    no_utm_orders: noUtmOrders.length,
    no_utm_rate: orders.length > 0
      ? round2((noUtmOrders.length / orders.length) * 100)
      : 0,
    by_campaign: byCampaign,
    avg_order_value: metaOrders.length > 0
      ? Math.round(sumField(metaOrders, "total_amount") / metaOrders.length)
      : 0,
  };
}

/**
 * Meta 캠페인 데이터 집계 (Pixel 기반)
 */
function aggregateMeta(campaigns) {
  const totalSpend = sumField(campaigns, "total_spend");
  const totalRevenue = sumField(campaigns, "revenue");
  const totalPurchases = sumField(campaigns, "purchase_count");
  const totalClicks = sumField(campaigns, "clicks");

  // 퍼널 집계
  const totalLanding = sumField(campaigns, "landing_page_views");
  const totalContent = sumField(campaigns, "content_views");
  const totalCart = sumField(campaigns, "add_to_cart_count");
  const totalCheckout = sumField(campaigns, "initiate_checkout_count");

  return {
    total_campaigns: campaigns.length,
    total_spend: round2(totalSpend),
    total_revenue: round2(totalRevenue),
    total_purchases: totalPurchases,
    overall_roas: totalSpend > 0 ? round2(totalRevenue / totalSpend) : 0,
    total_clicks: totalClicks,
    avg_cpa: totalPurchases > 0 ? Math.round(totalSpend / totalPurchases) : 0,
    avg_aov: totalPurchases > 0 ? Math.round(totalRevenue / totalPurchases) : 0,
    funnel: {
      landing_page_views: totalLanding,
      content_views: totalContent,
      add_to_cart: totalCart,
      initiate_checkout: totalCheckout,
      purchases: totalPurchases,
    },
    funnel_empty: totalLanding === 0 && totalContent === 0 && totalCart === 0 && totalCheckout === 0,
  };
}

/**
 * UTM 기반 캠페인 매칭 — Meta 캠페인명 vs Cafe24 utm_campaign
 */
function matchByUtm(metaCampaigns, cafe24Orders) {
  const matched = [];
  const unmatched_meta = [];
  const unmatched_cafe24 = [];

  // Cafe24 주문을 utm_campaign 기준으로 그룹핑
  const metaSources = ["facebook", "fb", "meta", "ig"];
  const cafe24ByCampaign = {};
  for (const order of cafe24Orders) {
    if (!metaSources.includes(order.utm_source)) continue;
    const utmCampaign = (order.utm_campaign || "").toLowerCase().trim();
    if (!utmCampaign) continue;
    if (!cafe24ByCampaign[utmCampaign]) {
      cafe24ByCampaign[utmCampaign] = { orders: 0, revenue: 0 };
    }
    cafe24ByCampaign[utmCampaign].orders += 1;
    cafe24ByCampaign[utmCampaign].revenue += order.total_amount;
  }

  // Meta 캠페인과 매칭
  const matchedCafe24Keys = new Set();

  for (const camp of metaCampaigns) {
    const campName = (camp.name || "").toLowerCase().trim();

    // 정확 매칭 또는 부분 매칭
    let bestMatch = null;
    let bestKey = null;
    for (const [utmKey, utmData] of Object.entries(cafe24ByCampaign)) {
      if (campName === utmKey || campName.includes(utmKey) || utmKey.includes(campName)) {
        if (!bestMatch || utmData.orders > bestMatch.orders) {
          bestMatch = utmData;
          bestKey = utmKey;
        }
      }
    }

    if (bestMatch && bestKey) {
      matchedCafe24Keys.add(bestKey);
      matched.push({
        campaign_name: camp.name,
        meta_campaign_id: camp.meta_campaign_id,
        meta_spend: round2(camp.total_spend),
        meta_revenue: round2(camp.revenue),
        meta_purchases: camp.purchase_count,
        meta_roas: camp.roas,
        cafe24_orders: bestMatch.orders,
        cafe24_revenue: round2(bestMatch.revenue),
        cafe24_roas: camp.total_spend > 0
          ? round2(bestMatch.revenue / camp.total_spend)
          : 0,
        revenue_gap: round2(camp.revenue - bestMatch.revenue),
        revenue_gap_pct: camp.revenue > 0
          ? round2(((camp.revenue - bestMatch.revenue) / camp.revenue) * 100)
          : 0,
        purchase_gap: camp.purchase_count - bestMatch.orders,
      });
    } else {
      unmatched_meta.push({
        campaign_name: camp.name,
        meta_spend: round2(camp.total_spend),
        meta_revenue: round2(camp.revenue),
        meta_purchases: camp.purchase_count,
        reason: "UTM 캠페인 매칭 실패 — Cafe24 주문에서 해당 캠페인명의 utm_campaign 없음",
      });
    }
  }

  // 매칭 안 된 Cafe24 UTM 캠페인
  for (const [utmKey, utmData] of Object.entries(cafe24ByCampaign)) {
    if (!matchedCafe24Keys.has(utmKey)) {
      unmatched_cafe24.push({
        utm_campaign: utmKey,
        orders: utmData.orders,
        revenue: round2(utmData.revenue),
        reason: "Meta 캠페인과 매칭 실패 — 캠페인명이 다르거나 삭제된 캠페인",
      });
    }
  }

  const totalMatched = matched.length;
  const totalMeta = metaCampaigns.length;

  return {
    matched,
    unmatched_meta,
    unmatched_cafe24,
    match_rate: totalMeta > 0
      ? round2((totalMatched / totalMeta) * 100)
      : 0,
    total_matched: totalMatched,
    total_meta: totalMeta,
  };
}

/**
 * 불일치 진단 — 어디서 데이터가 어긋나는지 식별
 */
function diagnoseDiscrepancies(metaTotal, cafe24Total, utmMatching) {
  const issues = [];

  // 1. Pixel 퍼널 이벤트 누락
  if (metaTotal.funnel_empty) {
    issues.push({
      type: "pixel_funnel_missing",
      severity: "critical",
      title: "Meta Pixel 퍼널 이벤트 미수집",
      detail: "landing_page_view, view_content, add_to_cart, initiate_checkout 이벤트가 모두 0입니다. Cafe24 사이트에 Meta Pixel이 정상 설치되었는지 확인하세요.",
      action: "Cafe24 관리자 → 외부 스크립트 → Meta Pixel 기본 코드 + 표준 이벤트 설치 필요",
    });
  }

  // 2. 구매 건수 불일치
  if (metaTotal.total_purchases > 0 && cafe24Total.meta_attributed_orders > 0) {
    const purchaseGap = Math.abs(metaTotal.total_purchases - cafe24Total.meta_attributed_orders);
    const gapPct = round2((purchaseGap / Math.max(metaTotal.total_purchases, cafe24Total.meta_attributed_orders)) * 100);

    if (gapPct > 30) {
      issues.push({
        type: "purchase_count_mismatch",
        severity: "warning",
        title: `구매 건수 ${gapPct}% 차이`,
        detail: `Meta Pixel: ${metaTotal.total_purchases}건 vs Cafe24: ${cafe24Total.meta_attributed_orders}건. ` +
          (metaTotal.total_purchases > cafe24Total.meta_attributed_orders
            ? "Meta Pixel이 더 많음 → 중복 카운팅 또는 취소/반품 미반영 가능성"
            : "Cafe24가 더 많음 → UTM 미설정 주문이 있거나 Pixel 누락 가능성"),
        action: "Meta Pixel 이벤트 중복 발동 확인 + UTM 파라미터 일관성 점검",
      });
    }
  }

  // 3. 매출 불일치
  if (metaTotal.total_revenue > 0 && cafe24Total.meta_attributed_revenue > 0) {
    const revGap = Math.abs(metaTotal.total_revenue - cafe24Total.meta_attributed_revenue);
    const revGapPct = round2((revGap / Math.max(metaTotal.total_revenue, cafe24Total.meta_attributed_revenue)) * 100);

    if (revGapPct > 20) {
      issues.push({
        type: "revenue_mismatch",
        severity: "warning",
        title: `매출 ${revGapPct}% 차이`,
        detail: `Meta Pixel 매출: ₩${Math.round(metaTotal.total_revenue).toLocaleString()} vs ` +
          `Cafe24 실제 매출: ₩${Math.round(cafe24Total.meta_attributed_revenue).toLocaleString()}`,
        action: "Meta Pixel purchase 이벤트의 value 파라미터가 실제 결제 금액과 일치하는지 확인",
      });
    }
  }

  // 4. UTM 누락률
  if (cafe24Total.no_utm_rate > 40) {
    issues.push({
      type: "utm_missing",
      severity: "warning",
      title: `UTM 파라미터 누락률 ${cafe24Total.no_utm_rate}%`,
      detail: `전체 ${cafe24Total.total_orders}건 중 ${cafe24Total.no_utm_orders}건에 UTM 없음. 광고→주문 매칭이 불완전합니다.`,
      action: "Meta 광고 URL에 utm_source=facebook&utm_campaign={campaign.name} 파라미터 추가",
    });
  }

  // 5. UTM 매칭률
  if (utmMatching.match_rate < 50 && utmMatching.total_meta > 0) {
    issues.push({
      type: "utm_matching_low",
      severity: "warning",
      title: `UTM 캠페인 매칭률 ${utmMatching.match_rate}%`,
      detail: `${utmMatching.total_meta}개 Meta 캠페인 중 ${utmMatching.total_matched}개만 Cafe24 주문과 매칭됨`,
      action: "Meta 캠페인 URL의 utm_campaign 값과 캠페인 이름을 동일하게 설정",
    });
  }

  // 6. Cafe24 미연결 (주문 0건)
  if (cafe24Total.total_orders === 0) {
    issues.push({
      type: "cafe24_no_data",
      severity: "critical",
      title: "Cafe24 주문 데이터 없음",
      detail: "해당 기간에 Cafe24 주문 데이터가 없습니다. Cafe24 연동이 필요하거나 동기화가 필요합니다.",
      action: "Settings 페이지에서 Cafe24 OAuth 연동을 먼저 진행하세요",
    });
  }

  // 7. Meta 매출 0인데 구매 있음 (Pixel value 미설정)
  if (metaTotal.total_purchases > 0 && metaTotal.total_revenue === 0) {
    issues.push({
      type: "pixel_value_missing",
      severity: "critical",
      title: "Meta Pixel purchase 이벤트에 value 없음",
      detail: `구매 ${metaTotal.total_purchases}건이 있지만 매출이 ₩0으로 기록됨. Pixel의 purchase 이벤트에 value 파라미터가 누락되었습니다.`,
      action: "Cafe24 Meta Pixel 설정에서 purchase 이벤트의 value를 결제 금액으로 설정",
    });
  }

  return issues;
}

/**
 * 보정된 ROAS/CPA/AOV 계산
 * Meta Pixel과 Cafe24 데이터를 혼합하여 가장 정확한 값 산출
 */
function computeCorrectedMetrics(metaTotal, cafe24Total, utmMatching) {
  const metaSpend = metaTotal.total_spend;

  // 매출 보정: Cafe24 실제 데이터가 있으면 그것을 우선 사용
  let bestRevenue = metaTotal.total_revenue;
  let revenueSource = "meta_pixel";

  if (cafe24Total.meta_attributed_revenue > 0) {
    bestRevenue = cafe24Total.meta_attributed_revenue;
    revenueSource = "cafe24_actual";
  }

  // 구매수 보정
  let bestPurchases = metaTotal.total_purchases;
  let purchaseSource = "meta_pixel";

  if (cafe24Total.meta_attributed_orders > 0) {
    bestPurchases = cafe24Total.meta_attributed_orders;
    purchaseSource = "cafe24_actual";
  }

  const correctedRoas = metaSpend > 0 ? round2(bestRevenue / metaSpend) : 0;
  const correctedCpa = bestPurchases > 0 ? Math.round(metaSpend / bestPurchases) : 0;
  const correctedAov = bestPurchases > 0 ? Math.round(bestRevenue / bestPurchases) : 0;

  return {
    corrected_roas: correctedRoas,
    roas_source: revenueSource,
    meta_roas: metaTotal.overall_roas,
    cafe24_roas: metaSpend > 0 && cafe24Total.meta_attributed_revenue > 0
      ? round2(cafe24Total.meta_attributed_revenue / metaSpend)
      : null,
    corrected_cpa: correctedCpa,
    cpa_source: purchaseSource,
    corrected_aov: correctedAov,
    aov_source: revenueSource,
    total_spend: round2(metaSpend),
    best_revenue: round2(bestRevenue),
    best_purchases: bestPurchases,
    confidence: cafe24Total.meta_attributed_orders > 0 ? "high" : "low",
    note: revenueSource === "cafe24_actual"
      ? "Cafe24 실제 결제 데이터 기반 (가장 정확)"
      : "Meta Pixel 데이터 기반 (Cafe24 데이터 미확보)",
  };
}

/**
 * 데이터 품질 점수 산출 (100점 만점)
 */
function computeDataQualityScore(metaTotal, cafe24Total, utmMatching, discrepancies) {
  let score = 100;
  const deductions = [];

  // Pixel 퍼널 누락: -30점
  if (metaTotal.funnel_empty) {
    score -= 30;
    deductions.push({ reason: "Pixel 퍼널 이벤트 미수집", points: -30 });
  }

  // Cafe24 미연결: -25점
  if (cafe24Total.total_orders === 0) {
    score -= 25;
    deductions.push({ reason: "Cafe24 주문 데이터 없음", points: -25 });
  }

  // UTM 누락률에 따라 차감
  if (cafe24Total.no_utm_rate > 60) {
    score -= 20;
    deductions.push({ reason: `UTM 누락률 ${cafe24Total.no_utm_rate}%`, points: -20 });
  } else if (cafe24Total.no_utm_rate > 30) {
    score -= 10;
    deductions.push({ reason: `UTM 누락률 ${cafe24Total.no_utm_rate}%`, points: -10 });
  }

  // UTM 매칭률
  if (utmMatching.match_rate < 30) {
    score -= 15;
    deductions.push({ reason: `UTM 매칭률 ${utmMatching.match_rate}%`, points: -15 });
  } else if (utmMatching.match_rate < 60) {
    score -= 8;
    deductions.push({ reason: `UTM 매칭률 ${utmMatching.match_rate}%`, points: -8 });
  }

  // critical 이슈 개수에 따라
  const criticalCount = discrepancies.filter((d) => d.severity === "critical").length;
  if (criticalCount > 0) {
    const pts = Math.min(criticalCount * 10, 20);
    score -= pts;
    deductions.push({ reason: `Critical 이슈 ${criticalCount}건`, points: -pts });
  }

  score = Math.max(0, score);

  let grade;
  if (score >= 80) grade = "A";
  else if (score >= 60) grade = "B";
  else if (score >= 40) grade = "C";
  else if (score >= 20) grade = "D";
  else grade = "F";

  return {
    score,
    grade,
    deductions,
    summary: getScoreSummary(grade),
  };
}

function getScoreSummary(grade) {
  const summaries = {
    A: "데이터 파이프라인이 잘 구축되어 있습니다. Pixel, UTM, Cafe24 데이터가 정확히 연동됩니다.",
    B: "대부분의 데이터가 연동되어 있지만, 일부 개선이 필요합니다.",
    C: "데이터 연동에 상당한 문제가 있습니다. ROAS 정확도가 낮을 수 있습니다.",
    D: "데이터 파이프라인이 불완전합니다. 주요 설정을 시급히 점검해야 합니다.",
    F: "데이터 연동이 거의 되어 있지 않습니다. Pixel 설치와 Cafe24 연동부터 시작하세요.",
  };
  return summaries[grade] || summaries.F;
}

/**
 * 개선 추천사항 생성
 */
function generateRecommendations(discrepancies, qualityScore) {
  const recs = [];

  // 우선순위별 정렬 (critical → warning)
  const criticalIssues = discrepancies.filter((d) => d.severity === "critical");
  const warningIssues = discrepancies.filter((d) => d.severity === "warning");

  for (const issue of criticalIssues) {
    recs.push({
      priority: "critical",
      title: issue.title,
      action: issue.action,
      expected_impact: "데이터 정확도 대폭 향상",
    });
  }

  for (const issue of warningIssues) {
    recs.push({
      priority: "warning",
      title: issue.title,
      action: issue.action,
      expected_impact: "데이터 정확도 개선",
    });
  }

  // 점수 기반 추가 추천
  if (qualityScore.score < 60) {
    recs.push({
      priority: "info",
      title: "데이터 품질 개선 로드맵",
      action: "1) Meta Pixel 표준 이벤트 설치 → 2) UTM 파라미터 설정 → 3) Cafe24 연동 → 4) 크로스 검증으로 정확도 확인",
      expected_impact: "ROAS/CPA 데이터 정확도 80%+ 달성",
    });
  }

  return recs;
}

// ─── 유틸리티 ───

function sumField(arr, field) {
  return arr.reduce((sum, item) => sum + (item[field] || 0), 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

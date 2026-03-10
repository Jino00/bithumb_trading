// Meta Marketing API 클라이언트 — OAuth 토큰 교환 + 캠페인/인사이트 조회
import fetch from "node-fetch";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const REQUEST_TIMEOUT_MS = 15000;

export function buildOAuthUrl(appId, redirectUri) {
  const scopes = "ads_read,ads_management,read_insights,pages_read_engagement,pages_show_list";
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: scopes,
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(code, appId, appSecret, redirectUri) {
  try {
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      client_secret: appSecret,
      code,
    });
    const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Token exchange failed" };
    }
    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function exchangeForLongLivedToken(shortToken, appId, appSecret) {
  try {
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Long-lived token exchange failed" };
    }
    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchMe(accessToken) {
  try {
    const res = await fetch(`${GRAPH_API_BASE}/me?fields=id,name&access_token=${accessToken}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch user info" };
    }
    return { data: await res.json(), error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchAdAccounts(accessToken) {
  try {
    const fields = "id,name,currency,timezone_name,account_status";
    const res = await fetch(
      `${GRAPH_API_BASE}/me/adaccounts?fields=${fields}&access_token=${accessToken}&limit=100`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch ad accounts" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchCampaigns(accessToken, adAccountId) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const fields = "id,name,status,daily_budget,lifetime_budget";
    const res = await fetch(
      `${GRAPH_API_BASE}/act_${accountId}/campaigns?fields=${fields}&access_token=${accessToken}&limit=500`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch campaigns" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchCampaignInsights(accessToken, campaignId) {
  try {
    const fields = "impressions,clicks,spend,actions,action_values,purchase_roas,ctr,cpc,frequency,cpm";
    const res = await fetch(
      `${GRAPH_API_BASE}/${campaignId}/insights?fields=${fields}&date_preset=last_30d&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch insights" };
    }
    const json = await res.json();
    const insights = json.data?.[0] || null;
    return { data: insights, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

const META_STATUS_MAP = {
  ACTIVE: "active",
  PAUSED: "paused",
  DELETED: "deleted",
  ARCHIVED: "archived",
};

export async function fetchAccountInsights(accessToken, adAccountId, period = "30d", { since: customSince, until: customUntil } = {}) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const fields = "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,frequency,cpm,actions,action_values,purchase_roas";

    let dateParam;
    if (customSince && customUntil) {
      // 커스텀 날짜 범위 (달력 선택)
      dateParam = `time_range=${JSON.stringify({ since: customSince, until: customUntil })}`;
    } else if (period === "15d") {
      const until = new Date().toISOString().split("T")[0];
      const since = new Date(Date.now() - 15 * 86400000).toISOString().split("T")[0];
      dateParam = `time_range=${JSON.stringify({ since, until })}`;
    } else {
      const presetMap = { "1d": "today", "7d": "last_7d", "30d": "last_30d" };
      dateParam = `date_preset=${presetMap[period] || "last_30d"}`;
    }

    const res = await fetch(
      `${GRAPH_API_BASE}/act_${accountId}/insights?fields=${fields}&${dateParam}&level=campaign&limit=500&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(30000) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch account insights" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

const PERIOD_DAYS = { "1d": 1, "7d": 7, "15d": 15, "30d": 30 };

// ─── ROAS/매출/구매 추출 헬퍼 (Cafe24 Pixel 기반 purchase_roas 우선 사용) ───

/**
 * Meta API의 purchase_roas를 우선 사용, 없으면 action_values에서 직접 계산
 * @param {object} insight - Meta API insight 객체
 * @returns {number} ROAS 값 (예: 2.94 = 294% 수익률)
 */
function extractPurchaseRoas(insight) {
  if (!insight) return 0;
  // 1순위: Meta의 purchase_roas 직접 사용 (Cafe24 Pixel 기반, 가장 정확)
  if (insight.purchase_roas && insight.purchase_roas.length > 0) {
    return parseFloat(insight.purchase_roas[0].value || "0");
  }
  // 2순위: action_values의 omni_purchase 매출 / spend로 직접 계산
  const spend = parseFloat(insight.spend || "0");
  if (spend > 0) {
    const revenue = extractPurchaseRevenue(insight);
    if (revenue > 0) return parseFloat((revenue / spend).toFixed(2));
  }
  return 0;
}

/**
 * action_values에서 실제 구매 매출(KRW) 추출
 * @param {object} insight - Meta API insight 객체
 * @returns {number} 매출 금액 (KRW)
 */
function extractPurchaseRevenue(insight) {
  if (!insight?.action_values || !Array.isArray(insight.action_values)) return 0;
  const purchaseValue = insight.action_values.find(
    (a) => a.action_type === "omni_purchase"
  );
  return purchaseValue ? parseFloat(purchaseValue.value || "0") : 0;
}

/**
 * actions에서 실제 구매 건수만 카운팅 (omni_purchase만)
 * @param {object} insight - Meta API insight 객체
 * @returns {number} 구매 건수
 */
function extractPurchaseCount(insight) {
  if (!insight?.actions || !Array.isArray(insight.actions)) return 0;
  const purchaseAction = insight.actions.find(
    (a) => a.action_type === "omni_purchase"
  );
  return purchaseAction ? parseInt(purchaseAction.value || "0", 10) : 0;
}

// ─── Cafe24 자사몰 퍼널 이벤트 추출 (Meta Pixel 기반) ───

/**
 * actions에서 특정 퍼널 이벤트 수를 추출하는 범용 헬퍼
 * omni_ 접두사 버전을 우선 사용 (크로스디바이스 포함)
 */
function extractActionCount(insight, actionType) {
  if (!insight?.actions || !Array.isArray(insight.actions)) return 0;
  // omni_ 버전 우선 (크로스디바이스 전환 포함, 더 정확)
  const omniAction = insight.actions.find(
    (a) => a.action_type === `omni_${actionType}`
  );
  if (omniAction) return parseInt(omniAction.value || "0", 10);
  // 일반 버전 폴백
  const action = insight.actions.find((a) => a.action_type === actionType);
  return action ? parseInt(action.value || "0", 10) : 0;
}

/**
 * Cafe24 자사몰 퍼널 데이터 추출 (Meta Pixel이 추적하는 Cafe24 이벤트)
 * @param {object} insight - Meta API insight 객체
 * @returns {{ landing_page_views, content_views, add_to_cart, initiate_checkout }}
 */
function extractFunnelData(insight) {
  return {
    landing_page_views: extractActionCount(insight, "landing_page_view"),
    content_views: extractActionCount(insight, "view_content"),
    add_to_cart: extractActionCount(insight, "add_to_cart"),
    initiate_checkout: extractActionCount(insight, "initiate_checkout"),
  };
}

export function mapMetaCampaignToSchema(campaign, insights, days = 30) {
  const spend = parseFloat(insights?.spend || "0");
  const impressions = parseInt(insights?.impressions || "0", 10);
  const clicks = parseInt(insights?.clicks || "0", 10);
  const conversions = extractPurchaseCount(insights);
  const roas = extractPurchaseRoas(insights);
  const revenue = extractPurchaseRevenue(insights);
  const aov = conversions > 0 ? parseFloat((revenue / conversions).toFixed(0)) : 0;
  const cpa = conversions > 0 ? parseFloat((spend / conversions).toFixed(0)) : 0;
  const funnel = extractFunnelData(insights);

  return {
    name: campaign.name || campaign.campaign_name,
    status: META_STATUS_MAP[campaign.status] || "active",
    ctr: parseFloat(insights?.ctr || "0"),
    roas,
    cpc: parseFloat(insights?.cpc || "0"),
    frequency: parseFloat(insights?.frequency || "0"),
    daily_spend: spend > 0 ? parseFloat((spend / days).toFixed(2)) : 0,
    total_spend: spend,
    impressions,
    clicks,
    conversions,
    revenue,
    aov,
    cpa,
    purchase_count: conversions,
    // Cafe24 자사몰 퍼널 이벤트 (Meta Pixel 추적)
    landing_page_views: funnel.landing_page_views,
    content_views: funnel.content_views,
    add_to_cart_count: funnel.add_to_cart,
    initiate_checkout_count: funnel.initiate_checkout,
    meta_campaign_id: campaign.id || campaign.campaign_id,
    source: "meta",
  };
}

export function mapAccountInsightToSchema(insight, period = "30d") {
  const days = PERIOD_DAYS[period] || parseInt(period, 10) || 30;
  const spend = parseFloat(insight.spend || "0");
  const impressions = parseInt(insight.impressions || "0", 10);
  const clicks = parseInt(insight.clicks || "0", 10);
  const conversions = extractPurchaseCount(insight);
  const roas = extractPurchaseRoas(insight);
  const revenue = extractPurchaseRevenue(insight);
  const aov = conversions > 0 ? parseFloat((revenue / conversions).toFixed(0)) : 0;
  const cpa = conversions > 0 ? parseFloat((spend / conversions).toFixed(0)) : 0;
  const funnel = extractFunnelData(insight);

  return {
    name: insight.campaign_name,
    status: "active",
    ctr: parseFloat(insight.ctr || "0"),
    roas,
    cpc: parseFloat(insight.cpc || "0"),
    frequency: parseFloat(insight.frequency || "0"),
    daily_spend: spend > 0 ? parseFloat((spend / days).toFixed(2)) : 0,
    total_spend: spend,
    impressions,
    clicks,
    conversions,
    revenue,
    aov,
    cpa,
    purchase_count: conversions,
    // Cafe24 자사몰 퍼널 이벤트 (Meta Pixel 추적)
    landing_page_views: funnel.landing_page_views,
    content_views: funnel.content_views,
    add_to_cart_count: funnel.add_to_cart,
    initiate_checkout_count: funnel.initiate_checkout,
    meta_campaign_id: insight.campaign_id,
    source: "meta",
  };
}

export async function fetchBusinesses(accessToken) {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/me/businesses?fields=id,name&access_token=${accessToken}&limit=100`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch businesses" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function fetchBusinessAdAccounts(accessToken, businessId) {
  try {
    const fields = "id,name,currency,timezone_name,account_status";
    const res = await fetch(
      `${GRAPH_API_BASE}/${businessId}/owned_ad_accounts?fields=${fields}&access_token=${accessToken}&limit=100`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch business ad accounts" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 캠페인 생성용 쓰기 함수 (Campaign Publish) ───

export async function fetchPages(accessToken) {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token,category&access_token=${accessToken}&limit=100`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch pages" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function createMetaCampaign(accessToken, adAccountId, params) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const body = new URLSearchParams({
      name: params.name,
      objective: params.objective || "OUTCOME_TRAFFIC",
      status: params.status || "PAUSED",
      special_ad_categories: JSON.stringify(params.special_ad_categories || []),
      is_adset_budget_sharing_enabled: params.is_adset_budget_sharing_enabled ?? false,
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/act_${accountId}/campaigns`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "createCampaign");
  } catch (err) {
    console.error("[Meta API] createCampaign exception:", err.message);
    return { data: null, error: err.message };
  }
}

export async function createMetaAdSet(accessToken, adAccountId, params) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const bodyObj = {
      name: params.name,
      campaign_id: params.campaign_id,
      daily_budget: String(params.daily_budget),
      billing_event: params.billing_event || "IMPRESSIONS",
      optimization_goal: params.optimization_goal || "LINK_CLICKS",
      bid_strategy: params.bid_strategy || "LOWEST_COST_WITHOUT_CAP",
      targeting: JSON.stringify(params.targeting),
      start_time: params.start_time,
      status: params.status || "PAUSED",
      access_token: accessToken,
    };
    if (params.promoted_object) {
      bodyObj.promoted_object = JSON.stringify(params.promoted_object);
    }
    const body = new URLSearchParams(bodyObj);
    const res = await fetch(`${GRAPH_API_BASE}/act_${accountId}/adsets`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "createAdSet");
  } catch (err) {
    console.error("[Meta API] createAdSet exception:", err.message);
    return { data: null, error: err.message };
  }
}

export async function uploadAdImage(accessToken, adAccountId, imagePath) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const fs = await import("fs");
    const { basename } = await import("path");

    // Node.js 내장 FormData + Blob 사용 (form-data npm 대신)
    const fileBuffer = fs.readFileSync(imagePath);
    const fileName = basename(imagePath);
    const form = new FormData();
    form.append("filename", new Blob([fileBuffer]), fileName);
    form.append("access_token", accessToken);

    const res = await fetch(`${GRAPH_API_BASE}/act_${accountId}/adimages`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(30000),
    });

    const text = await res.text();
    if (!text) {
      return { data: null, error: `Meta API returned empty response (status: ${res.status})` };
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { data: null, error: `Meta API returned invalid JSON (status: ${res.status}): ${text.substring(0, 200)}` };
    }

    if (!res.ok) {
      return { data: null, error: json.error?.message || "Failed to upload image" };
    }
    return { data: json, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

export async function createAdCreative(accessToken, adAccountId, params) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const linkData = {
      link: params.link,
      message: params.message,
      name: params.headline,
      description: params.description || "",
      call_to_action: {
        type: params.cta_type || "SHOP_NOW",
        value: { link: params.link },
      },
    };
    if (params.image_hash) {
      linkData.image_hash = params.image_hash;
    }
    const body = new URLSearchParams({
      name: params.name || "Auto Creative",
      object_story_spec: JSON.stringify({
        page_id: params.page_id,
        link_data: linkData,
      }),
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/act_${accountId}/adcreatives`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "createAdCreative");
  } catch (err) {
    console.error("[Meta API] createAdCreative exception:", err.message);
    return { data: null, error: err.message };
  }
}

export async function createMetaAd(accessToken, adAccountId, params) {
  try {
    const accountId = adAccountId.replace("act_", "");
    console.log(`[Meta API] createAd params: adset=${params.adset_id}, creative=${params.creative_id}`);
    const body = new URLSearchParams({
      name: params.name,
      adset_id: params.adset_id,
      creative: JSON.stringify({ creative_id: params.creative_id }),
      status: params.status || "PAUSED",
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/act_${accountId}/ads`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const result = await safeParseMetaResponse(res, "createAd");
    console.log(`[Meta API] createAd result: ${JSON.stringify(result).substring(0, 300)}`);
    return result;
  } catch (err) {
    console.error("[Meta API] createAd exception:", err.message);
    return { data: null, error: err.message };
  }
}

// ─── 캠페인/광고세트 업데이트 (일일 리뷰 자동 실행용) ───

/** 캠페인 상태 변경 (ACTIVE ↔ PAUSED) */
export async function updateCampaignStatus(accessToken, campaignId, status) {
  try {
    const body = new URLSearchParams({
      status,
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/${campaignId}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "updateCampaignStatus");
  } catch (err) {
    console.error("[Meta API] updateCampaignStatus exception:", err.message);
    return { data: null, error: err.message };
  }
}

/** 광고세트의 일 예산 변경 (Meta API 예산은 "센트" 단위: ₩30,000 → 3000000) */
export async function updateAdSetBudget(accessToken, adsetId, dailyBudgetKrw) {
  try {
    const budgetInCents = Math.round(dailyBudgetKrw * 100);
    const body = new URLSearchParams({
      daily_budget: String(budgetInCents),
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/${adsetId}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "updateAdSetBudget");
  } catch (err) {
    console.error("[Meta API] updateAdSetBudget exception:", err.message);
    return { data: null, error: err.message };
  }
}

/** 캠페인에 속한 광고세트 목록 조회 (예산 변경 + 타겟팅 분석용) */
export async function fetchAdSetsForCampaign(accessToken, campaignId) {
  try {
    const fields = "id,name,daily_budget,status,targeting";
    const res = await fetch(
      `${GRAPH_API_BASE}/${campaignId}/adsets?fields=${fields}&access_token=${accessToken}&limit=100`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch adsets" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/** 광고세트 타겟팅 변경 (관심사 타겟 → Broad 전환 등) */
export async function updateAdSetTargeting(accessToken, adsetId, targeting) {
  try {
    const body = new URLSearchParams({
      targeting: JSON.stringify(targeting),
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/${adsetId}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "updateAdSetTargeting");
  } catch (err) {
    console.error("[Meta API] updateAdSetTargeting exception:", err.message);
    return { data: null, error: err.message };
  }
}

/** 개별 광고 상태 변경 (ACTIVE ↔ PAUSED — 캠페인이 아닌 개별 ad 레벨) */
export async function updateAdStatus(accessToken, adId, status) {
  try {
    const body = new URLSearchParams({
      status,
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/${adId}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "updateAdStatus");
  } catch (err) {
    console.error("[Meta API] updateAdStatus exception:", err.message);
    return { data: null, error: err.message };
  }
}

/** 캠페인 내 광고 목록 조회 (개별 광고 성과 비교용) */
export async function fetchAdsForCampaign(accessToken, campaignId) {
  try {
    const fields = "id,name,status,effective_status";
    const res = await fetch(
      `${GRAPH_API_BASE}/${campaignId}/ads?fields=${fields}&access_token=${accessToken}&limit=100`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Failed to fetch ads" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

// ─── 비디오 업로드 + 비디오 크리에이티브 (대용량 영상 지원) ───

export async function uploadAdVideo(accessToken, adAccountId, videoPath) {
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB per chunk (대용량 영상 속도 개선)
  const VIDEO_API_BASE = "https://graph-video.facebook.com/v21.0"; // 비디오 전용 호스트 (공식문서 권장)
  try {
    const accountId = adAccountId.replace("act_", "");
    const fs = await import("fs");
    const { basename } = await import("path");
    const fileSize = fs.statSync(videoPath).size;
    const fileName = basename(videoPath);
    const url = `${VIDEO_API_BASE}/act_${accountId}/advideos`;

    console.log(`[Meta Video] Chunked upload start: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

    // Phase 1: START — 업로드 세션 시작
    const startBody = new URLSearchParams({
      upload_phase: "start",
      file_size: String(fileSize),
      access_token: accessToken,
    });
    const startRes = await fetch(url, { method: "POST", body: startBody, signal: AbortSignal.timeout(30000) });
    const startJson = await safeParseMetaResponse(startRes, "start");
    if (startJson.error) return startJson;

    const { upload_session_id, video_id } = startJson.data;
    console.log(`[Meta Video] Session started: session=${upload_session_id}, video_id=${video_id}`);

    // Phase 2: TRANSFER — 청크 단위 업로드
    let startOffset = 0;
    let chunkIndex = 0;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

    while (startOffset < fileSize) {
      const chunkEnd = Math.min(startOffset + CHUNK_SIZE, fileSize);
      const chunkBuffer = Buffer.alloc(chunkEnd - startOffset);
      const fd = fs.openSync(videoPath, "r");
      fs.readSync(fd, chunkBuffer, 0, chunkBuffer.length, startOffset);
      fs.closeSync(fd);

      chunkIndex++;
      console.log(`[Meta Video] Uploading chunk ${chunkIndex}/${totalChunks} (offset: ${startOffset})`);

      const form = new FormData();
      form.append("upload_phase", "transfer");
      form.append("upload_session_id", upload_session_id);
      form.append("start_offset", String(startOffset));
      form.append("video_file_chunk", new Blob([chunkBuffer]), fileName);
      form.append("access_token", accessToken);

      const transferRes = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(120000) }); // 2분/청크 (대용량 영상 안정성)
      const transferJson = await safeParseMetaResponse(transferRes, `transfer chunk ${chunkIndex}`);
      if (transferJson.error) return transferJson;

      startOffset = Number(transferJson.data.start_offset);
    }

    // Phase 3: FINISH — 업로드 완료
    const finishBody = new URLSearchParams({
      upload_phase: "finish",
      upload_session_id,
      access_token: accessToken,
    });
    const finishRes = await fetch(url, { method: "POST", body: finishBody, signal: AbortSignal.timeout(30000) });
    const finishJson = await safeParseMetaResponse(finishRes, "finish");
    if (finishJson.error) return finishJson;

    console.log(`[Meta Video] Upload complete! video_id: ${video_id}`);
    return { data: { id: video_id }, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * Meta 비디오 처리 상태 확인 + 완료 대기
 * 업로드 후 Meta 서버에서 인코딩이 완료되어야 크리에이티브에 사용 가능
 */
export async function waitForVideoReady(accessToken, videoId, maxWaitMs = 300000) {
  const POLL_INTERVAL = 5000; // 5초마다 확인
  const startTime = Date.now();

  console.log(`[Meta Video] Waiting for video ${videoId} to be ready (max ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await fetch(
        `${GRAPH_API_BASE}/${videoId}?fields=status&access_token=${accessToken}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      );
      const json = await safeParseMetaResponse(res, "videoStatus");
      if (json.error) {
        console.warn(`[Meta Video] Status check failed: ${json.error}`);
        await delay(POLL_INTERVAL);
        continue;
      }

      const status = json.data?.status?.video_status || json.data?.status;
      console.log(`[Meta Video] Video ${videoId} status: ${status}`);

      if (status === "ready") {
        console.log(`[Meta Video] Video ready! (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);
        return { ready: true, error: null };
      }
      if (status === "error") {
        return { ready: false, error: "Meta 비디오 인코딩 실패" };
      }
    } catch (err) {
      console.warn(`[Meta Video] Status poll error: ${err.message}`);
    }

    await delay(POLL_INTERVAL);
  }

  // 타임아웃이어도 비디오가 사용 가능할 수 있으므로 경고만
  console.warn(`[Meta Video] Timeout waiting for video ready, proceeding anyway...`);
  return { ready: false, error: null };
}

// Meta API 응답을 안전하게 파싱하는 헬퍼 (모든 Meta API 호출에서 공용)
async function safeParseMetaResponse(res, phase) {
  const text = await res.text();
  if (!text) {
    return { data: null, error: `Meta API [${phase}] empty response (status: ${res.status})` };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { data: null, error: `Meta API [${phase}] invalid JSON (${res.status}): ${text.substring(0, 200)}` };
  }
  if (!res.ok || json.error) {
    const errDetail = json.error?.error_user_msg || json.error?.error_subcode || "";
    const errMsg = json.error?.message || `Meta API [${phase}] failed (${res.status})`;
    console.error(`[Meta API] ${phase} error: ${errMsg} ${errDetail ? `(${errDetail})` : ""} | Full: ${JSON.stringify(json.error).substring(0, 500)}`);
    return { data: null, error: `${errMsg}${errDetail ? ` — ${errDetail}` : ""}` };
  }
  return { data: json, error: null };
}

export async function createVideoAdCreative(accessToken, adAccountId, params) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const videoData = {
      video_id: params.video_id,
      message: params.message,
      title: params.headline,
      link_description: params.description || "",
      call_to_action: {
        type: params.cta_type || "SHOP_NOW",
        value: { link: params.link },
      },
    };
    if (params.image_hash) {
      videoData.image_hash = params.image_hash;
    }
    const body = new URLSearchParams({
      name: params.name || "Auto Video Creative",
      object_story_spec: JSON.stringify({
        page_id: params.page_id,
        video_data: videoData,
      }),
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/act_${accountId}/adcreatives`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return await safeParseMetaResponse(res, "createVideoAdCreative");
  } catch (err) {
    console.error("[Meta API] createVideoAdCreative exception:", err.message);
    return { data: null, error: err.message };
  }
}

// ─── WMA용: 7일 일별 인사이트 + 캠페인별 그룹핑 ───

/**
 * 7일 일별 캠페인 인사이트 (time_increment=1) — WMA 계산용
 * ACTIVE 캠페인만 조회, 페이지네이션 포함
 * @returns {{ data: Array, error: string|null }}
 */
export async function fetchDailyBreakdown7d(accessToken, adAccountId) {
  try {
    const accountId = adAccountId.replace("act_", "");
    const fields = "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,frequency,cpm,actions,action_values,purchase_roas,date_start,date_stop";

    const until = new Date().toISOString().split("T")[0];
    const since = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const timeRange = JSON.stringify({ since, until });

    let allData = [];
    let url = `${GRAPH_API_BASE}/act_${accountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&time_increment=1&level=campaign&limit=500&access_token=${accessToken}`;

    while (url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        const err = await res.json();
        return { data: null, error: err.error?.message || "Failed to fetch daily breakdown" };
      }
      const json = await res.json();
      allData = allData.concat(json.data || []);

      // 페이지네이션 (7일 × ~30캠페인 ≈ 210행, 보통 1페이지)
      url = json.paging?.next || null;
      if (url) await delay(300);
    }

    return { data: allData, error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * 일별 인사이트를 캠페인별로 그룹핑 (WMA 계산 준비)
 * @param {Array} dailyInsights — fetchDailyBreakdown7d() 반환 배열
 * @returns {{ [campaign_id]: { name, days: Array } }}
 */
export function groupDailyByCampaign(dailyInsights) {
  const groups = {};
  for (const row of dailyInsights) {
    const cid = row.campaign_id;
    if (!groups[cid]) {
      groups[cid] = { name: row.campaign_name, days: [] };
    }
    const funnel = extractFunnelData(row);
    groups[cid].days.push({
      date: row.date_start,
      spend: parseFloat(row.spend || "0"),
      impressions: parseInt(row.impressions || "0", 10),
      clicks: parseInt(row.clicks || "0", 10),
      ctr: parseFloat(row.ctr || "0"),
      cpc: parseFloat(row.cpc || "0"),
      frequency: parseFloat(row.frequency || "0"),
      roas: extractPurchaseRoas(row),
      revenue: extractPurchaseRevenue(row),
      purchases: extractPurchaseCount(row),
      landing_page_views: funnel.landing_page_views,
      content_views: funnel.content_views,
      add_to_cart: funnel.add_to_cart,
      initiate_checkout: funnel.initiate_checkout,
    });
  }
  // 날짜 오름차순 정렬
  for (const cid of Object.keys(groups)) {
    groups[cid].days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return groups;
}

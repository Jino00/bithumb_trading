// Meta 캠페인 UTM 파라미터 자동 설정 서비스 — 광고→주문 어트리뷰션 추적
import fetch from "node-fetch";
import { getDb } from "../db/database.js";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const REQUEST_TIMEOUT_MS = 15000;

/**
 * 모든 Meta 캠페인의 UTM 설정 상태를 진단
 * - 각 캠페인의 광고(Ad) 레벨에서 URL 파라미터 확인
 * - UTM 누락 캠페인 목록 + 개선 가이드 반환
 */
export async function diagnoseUtmStatus() {
  const db = getDb();
  const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'").get();
  if (!cred || !cred.selected_ad_account_id) {
    return { error: "Meta 미연결 또는 광고 계정 미선택" };
  }

  const accountId = cred.selected_ad_account_id.replace("act_", "");

  // 1. 캠페인 목록 조회
  const campaigns = await fetchAllCampaigns(cred.access_token, accountId);
  if (campaigns.error) return { error: campaigns.error };

  // 2. 각 캠페인의 광고(Ad) 레벨 URL 파라미터 확인
  const results = [];
  for (const campaign of campaigns.data) {
    await sleep(300); // Rate limit

    const ads = await fetchCampaignAds(cred.access_token, campaign.id);
    const adsData = ads.data || [];

    let hasUtm = false;
    let utmDetails = [];

    for (const ad of adsData) {
      const urlTags = ad.url_tags || "";
      const trackingSpecs = ad.tracking_specs || [];
      const hasUrlTags = urlTags.includes("utm_source") || urlTags.includes("utm_campaign");

      if (hasUrlTags) {
        hasUtm = true;
        utmDetails.push({
          ad_id: ad.id,
          ad_name: ad.name,
          url_tags: urlTags,
          status: "configured",
        });
      } else {
        utmDetails.push({
          ad_id: ad.id,
          ad_name: ad.name,
          url_tags: urlTags || "(없음)",
          status: "missing",
        });
      }
    }

    results.push({
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      campaign_status: campaign.status,
      total_ads: adsData.length,
      utm_configured: hasUtm,
      ads_with_utm: utmDetails.filter((a) => a.status === "configured").length,
      ads_without_utm: utmDetails.filter((a) => a.status === "missing").length,
      ads: utmDetails,
    });
  }

  const totalCampaigns = results.length;
  const withUtm = results.filter((r) => r.utm_configured).length;
  const withoutUtm = results.filter((r) => !r.utm_configured).length;

  return {
    summary: {
      total_campaigns: totalCampaigns,
      with_utm: withUtm,
      without_utm: withoutUtm,
      coverage_pct: totalCampaigns > 0 ? Math.round((withUtm / totalCampaigns) * 100) : 0,
    },
    campaigns: results,
    recommended_utm_template: "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
  };
}

/**
 * 지정 캠페인들에 UTM 파라미터 자동 추가
 * Meta Graph API POST /{campaign_id} 로 url_tags 업데이트
 *
 * @param {string[]} campaignIds - UTM 설정할 캠페인 ID 목록 (빈 배열이면 전체)
 * @returns {{ updated, failed, skipped }}
 */
export async function applyUtmToCampaigns(campaignIds = []) {
  const db = getDb();
  const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'").get();
  if (!cred || !cred.selected_ad_account_id) {
    return { error: "Meta 미연결 또는 광고 계정 미선택" };
  }

  const accountId = cred.selected_ad_account_id.replace("act_", "");

  // 타겟 캠페인 결정
  let targetCampaigns;
  if (campaignIds.length > 0) {
    targetCampaigns = campaignIds;
  } else {
    const allCampaigns = await fetchAllCampaigns(cred.access_token, accountId);
    if (allCampaigns.error) return { error: allCampaigns.error };
    targetCampaigns = allCampaigns.data.map((c) => c.id);
  }

  const updated = [];
  const failed = [];
  const skipped = [];

  for (const campaignId of targetCampaigns) {
    await sleep(500); // Rate limit 여유

    // 캠페인의 모든 광고 조회
    const ads = await fetchCampaignAds(cred.access_token, campaignId);
    if (ads.error || !ads.data) {
      failed.push({ campaign_id: campaignId, error: ads.error || "광고 조회 실패" });
      continue;
    }

    for (const ad of ads.data) {
      const existingTags = ad.url_tags || "";

      // 이미 UTM 설정되어 있으면 스킵
      if (existingTags.includes("utm_source")) {
        skipped.push({ ad_id: ad.id, ad_name: ad.name, reason: "이미 UTM 설정됨" });
        continue;
      }

      // UTM 파라미터 설정 — Meta 동적 매크로 사용
      const utmTags = buildUtmTags(existingTags);

      await sleep(300);
      const result = await updateAdUrlTags(cred.access_token, ad.id, utmTags);

      if (result.error) {
        failed.push({ ad_id: ad.id, ad_name: ad.name, error: result.error });
      } else {
        updated.push({ ad_id: ad.id, ad_name: ad.name, url_tags: utmTags });
      }
    }
  }

  return {
    updated: updated.length,
    failed: failed.length,
    skipped: skipped.length,
    details: { updated, failed, skipped },
  };
}

/**
 * UTM 태그 문자열 생성 — Meta 동적 매크로 사용
 */
function buildUtmTags(existing) {
  const base = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}";
  if (existing && existing.trim()) {
    // 기존 태그 보존 + UTM 추가
    return `${existing}&${base}`;
  }
  return base;
}

// ─── Meta Graph API 호출 헬퍼 ───

async function fetchAllCampaigns(accessToken, accountId) {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/act_${accountId}/campaigns?fields=id,name,status&limit=500&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "캠페인 목록 조회 실패" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

async function fetchCampaignAds(accessToken, campaignId) {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${campaignId}/ads?fields=id,name,url_tags,tracking_specs,status&limit=500&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "광고 조회 실패" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

async function updateAdUrlTags(accessToken, adId, urlTags) {
  try {
    const body = new URLSearchParams({
      url_tags: urlTags,
      access_token: accessToken,
    });
    const res = await fetch(`${GRAPH_API_BASE}/${adId}`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.json();
      return { success: false, error: err.error?.message || "URL 태그 업데이트 실패" };
    }
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

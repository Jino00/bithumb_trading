// Meta Marketing API 클라이언트 — OAuth 토큰 교환 + 캠페인/인사이트 조회
import fetch from "node-fetch";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const REQUEST_TIMEOUT_MS = 15000;

export function buildOAuthUrl(appId, redirectUri) {
  const scopes = "ads_read,ads_management,read_insights";
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
    const fields = "impressions,clicks,spend,actions,ctr,cpc,frequency,cpm";
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

export async function fetchAccountInsights(accessToken, adAccountId, period = "30d") {
  try {
    const accountId = adAccountId.replace("act_", "");
    const fields = "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,frequency,cpm,actions";

    let dateParam;
    if (period === "15d") {
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

export function mapMetaCampaignToSchema(campaign, insights, days = 30) {
  const conversions = countConversions(insights?.actions);
  const spend = parseFloat(insights?.spend || "0");
  const impressions = parseInt(insights?.impressions || "0", 10);
  const clicks = parseInt(insights?.clicks || "0", 10);

  return {
    name: campaign.name || campaign.campaign_name,
    status: META_STATUS_MAP[campaign.status] || "active",
    ctr: parseFloat(insights?.ctr || "0"),
    roas: spend > 0 && conversions > 0 ? parseFloat(((conversions * 50) / spend).toFixed(2)) : 0,
    cpc: parseFloat(insights?.cpc || "0"),
    frequency: parseFloat(insights?.frequency || "0"),
    daily_spend: spend > 0 ? parseFloat((spend / days).toFixed(2)) : 0,
    total_spend: spend,
    impressions,
    clicks,
    conversions,
    meta_campaign_id: campaign.id || campaign.campaign_id,
    source: "meta",
  };
}

export function mapAccountInsightToSchema(insight, period = "30d") {
  const days = PERIOD_DAYS[period] || 30;
  const conversions = countConversions(insight.actions);
  const spend = parseFloat(insight.spend || "0");
  const impressions = parseInt(insight.impressions || "0", 10);
  const clicks = parseInt(insight.clicks || "0", 10);

  return {
    name: insight.campaign_name,
    status: "active",
    ctr: parseFloat(insight.ctr || "0"),
    roas: spend > 0 && conversions > 0 ? parseFloat(((conversions * 50) / spend).toFixed(2)) : 0,
    cpc: parseFloat(insight.cpc || "0"),
    frequency: parseFloat(insight.frequency || "0"),
    daily_spend: spend > 0 ? parseFloat((spend / days).toFixed(2)) : 0,
    total_spend: spend,
    impressions,
    clicks,
    conversions,
    meta_campaign_id: insight.campaign_id,
    source: "meta",
  };
}

function countConversions(actions) {
  if (!actions || !Array.isArray(actions)) return 0;
  const conversionTypes = ["offsite_conversion", "purchase", "lead", "complete_registration"];
  let total = 0;
  for (const action of actions) {
    if (conversionTypes.some((t) => action.action_type?.includes(t))) {
      total += parseInt(action.value || "0", 10);
    }
  }
  if (total === 0) {
    for (const action of actions) {
      total += parseInt(action.value || "0", 10);
    }
  }
  return total;
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

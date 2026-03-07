// Meta Ads OAuth 연동 + 캠페인 동기화 라우트
import { Router } from "express";
import { getDb } from "../db/database.js";
import {
  buildOAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchMe,
  fetchAdAccounts,
  fetchBusinesses,
  fetchBusinessAdAccounts,
  fetchCampaigns,
  fetchCampaignInsights,
  fetchAccountInsights,
  mapMetaCampaignToSchema,
  mapAccountInsightToSchema,
  delay,
} from "../services/meta-api.js";

const router = Router();
const FRONTEND_URL = "http://localhost:5173";

function getAppCredentials() {
  const db = getDb();
  const config = db.prepare("SELECT * FROM meta_config WHERE id = 1").get();
  return {
    appId: config?.app_id || process.env.FB_APP_ID || "",
    appSecret: config?.app_secret || process.env.FB_APP_SECRET || "",
    redirectUri: config?.redirect_uri || process.env.FB_REDIRECT_URI || "http://localhost:3001/api/meta/callback",
  };
}

// 설정 상태 확인
router.get("/config", (_req, res) => {
  try {
    const { appId, redirectUri } = getAppCredentials();
    res.json({ app_id_configured: !!appId, redirect_uri: redirectUri });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// App 자격증명 저장
router.post("/config", (req, res) => {
  try {
    const db = getDb();
    const { app_id, app_secret } = req.body;
    if (!app_id || !app_secret) {
      return res.status(400).json({ error: "App ID and App Secret are required" });
    }
    db.prepare(`
      INSERT INTO meta_config (id, app_id, app_secret, updated_at) VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET app_id=excluded.app_id, app_secret=excluded.app_secret, updated_at=datetime('now')
    `).run(app_id, app_secret);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// OAuth URL 생성
router.get("/auth-url", (_req, res) => {
  try {
    const { appId, redirectUri } = getAppCredentials();
    if (!appId) {
      return res.status(400).json({ error: "App credentials not configured. Set App ID first." });
    }
    const url = buildOAuthUrl(appId, redirectUri);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Facebook OAuth 콜백
router.get("/callback", async (req, res) => {
  try {
    const { code, error: fbError } = req.query;
    if (fbError || !code) {
      return res.redirect(`${FRONTEND_URL}?page=settings&error=auth_denied`);
    }

    const { appId, appSecret, redirectUri } = getAppCredentials();
    if (!appId || !appSecret) {
      return res.redirect(`${FRONTEND_URL}?page=settings&error=no_credentials`);
    }

    // 인증 코드 → 단기 토큰
    const shortResult = await exchangeCodeForToken(code, appId, appSecret, redirectUri);
    if (shortResult.error) {
      console.error("Short token error:", shortResult.error);
      return res.redirect(`${FRONTEND_URL}?page=settings&error=token_exchange`);
    }

    // 단기 → 장기 토큰
    const longResult = await exchangeForLongLivedToken(shortResult.data.access_token, appId, appSecret);
    const accessToken = longResult.error ? shortResult.data.access_token : longResult.data.access_token;
    const expiresIn = longResult.error ? (shortResult.data.expires_in || 3600) : (longResult.data.expires_in || 5184000);

    // 사용자 정보 조회
    const meResult = await fetchMe(accessToken);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // DB에 저장 (UPSERT)
    const db = getDb();
    db.prepare(`
      DELETE FROM meta_credentials WHERE user_id = 'default'
    `).run();
    db.prepare(`
      INSERT INTO meta_credentials (user_id, access_token, token_type, expires_at, fb_user_id, fb_user_name)
      VALUES ('default', ?, 'long_lived', ?, ?, ?)
    `).run(accessToken, expiresAt, meResult.data?.id || null, meResult.data?.name || null);

    res.redirect(`${FRONTEND_URL}?page=settings&connected=true`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`${FRONTEND_URL}?page=settings&error=callback_failed`);
  }
});

// 연결 상태 확인
router.get("/status", (_req, res) => {
  try {
    const db = getDb();
    const cred = db.prepare("SELECT * FROM meta_credentials WHERE user_id = 'default'").get();
    if (!cred) {
      return res.json({ connected: false });
    }
    const expired = cred.expires_at ? new Date(cred.expires_at) < new Date() : false;
    res.json({
      connected: !expired,
      expired,
      user_name: cred.fb_user_name,
      fb_user_id: cred.fb_user_id,
      expires_at: cred.expires_at,
      selected_ad_account_id: cred.selected_ad_account_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 연결 해제
router.post("/disconnect", (_req, res) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM meta_credentials WHERE user_id = 'default'").run();
    db.prepare("DELETE FROM meta_ad_accounts").run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 광고 계정 목록
router.get("/ad-accounts", async (_req, res) => {
  try {
    const db = getDb();
    const cred = db.prepare("SELECT access_token FROM meta_credentials WHERE user_id = 'default'").get();
    if (!cred) return res.status(401).json({ error: "Not connected to Meta" });

    const result = await fetchAdAccounts(cred.access_token);
    if (result.error) return res.status(400).json({ error: result.error });

    // 캐시에 저장 (DELETE + INSERT 방식)
    db.prepare("DELETE FROM meta_ad_accounts").run();
    const insertAccounts = db.transaction((accounts) => {
      for (const acc of accounts) {
        db.prepare(
          "INSERT INTO meta_ad_accounts (account_id, account_name, currency, timezone, status) VALUES (?, ?, ?, ?, ?)"
        ).run(acc.id, acc.name, acc.currency, acc.timezone_name, acc.account_status);
      }
    });
    insertAccounts(result.data);

    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 광고 계정 선택
router.post("/select-account", (req, res) => {
  try {
    const db = getDb();
    const { account_id } = req.body;
    if (!account_id) return res.status(400).json({ error: "account_id is required" });

    db.prepare("UPDATE meta_credentials SET selected_ad_account_id = ?, updated_at = datetime('now') WHERE user_id = 'default'").run(
      account_id
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 캠페인 동기화
router.post("/sync", async (_req, res) => {
  try {
    const db = getDb();
    const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'").get();
    if (!cred) return res.status(401).json({ error: "Not connected to Meta" });
    if (!cred.selected_ad_account_id) return res.status(400).json({ error: "No ad account selected" });

    // 캠페인 목록 가져오기
    const campResult = await fetchCampaigns(cred.access_token, cred.selected_ad_account_id);
    if (campResult.error) return res.status(400).json({ error: campResult.error });

    const synced = [];
    const errors = [];

    for (const campaign of campResult.data) {
      try {
        await delay(200); // Rate limit 보호
        const insightResult = await fetchCampaignInsights(cred.access_token, campaign.id);
        const mapped = mapMetaCampaignToSchema(campaign, insightResult.data);

        // UPSERT: meta_campaign_id로 기존 데이터 확인
        const existing = db.prepare("SELECT id FROM campaigns WHERE meta_campaign_id = ?").get(mapped.meta_campaign_id);

        if (existing) {
          db.prepare(`
            UPDATE campaigns SET name=?, status=?, ctr=?, roas=?, cpc=?, frequency=?,
              daily_spend=?, total_spend=?, impressions=?, clicks=?, conversions=?,
              source='meta', updated_at=datetime('now')
            WHERE meta_campaign_id=?
          `).run(
            mapped.name, mapped.status, mapped.ctr, mapped.roas, mapped.cpc, mapped.frequency,
            mapped.daily_spend, mapped.total_spend, mapped.impressions, mapped.clicks, mapped.conversions,
            mapped.meta_campaign_id
          );
        } else {
          db.prepare(`
            INSERT INTO campaigns (name, status, ctr, roas, cpc, frequency, daily_spend, total_spend, impressions, clicks, conversions, meta_campaign_id, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'meta')
          `).run(
            mapped.name, mapped.status, mapped.ctr, mapped.roas, mapped.cpc, mapped.frequency,
            mapped.daily_spend, mapped.total_spend, mapped.impressions, mapped.clicks, mapped.conversions,
            mapped.meta_campaign_id
          );
        }

        synced.push(mapped.name);
      } catch (err) {
        errors.push({ campaign: campaign.name, error: err.message });
      }
    }

    res.json({
      synced: synced.length,
      failed: errors.length,
      synced_campaigns: synced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 비즈니스 포트폴리오 목록
router.get("/businesses", async (_req, res) => {
  try {
    const db = getDb();
    const cred = db.prepare("SELECT access_token FROM meta_credentials WHERE user_id = 'default'").get();
    if (!cred) return res.status(401).json({ error: "Not connected to Meta" });

    const result = await fetchBusinesses(cred.access_token);
    if (result.error) return res.status(400).json({ error: result.error });

    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 비즈니스별 광고 계정 목록
router.get("/businesses/:businessId/ad-accounts", async (req, res) => {
  try {
    const db = getDb();
    const cred = db.prepare("SELECT access_token FROM meta_credentials WHERE user_id = 'default'").get();
    if (!cred) return res.status(401).json({ error: "Not connected to Meta" });

    const result = await fetchBusinessAdAccounts(cred.access_token, req.params.businessId);
    if (result.error) return res.status(400).json({ error: result.error });

    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 기간별 인사이트 조회 (1회 API 호출로 전체 캠페인 데이터)
router.get("/insights", async (req, res) => {
  try {
    const db = getDb();
    const period = req.query.period || "30d";
    const validPeriods = ["1d", "7d", "15d", "30d"];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({ error: `Invalid period. Use: ${validPeriods.join(", ")}` });
    }

    const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'").get();

    // 쿼리로 전달된 account_id가 있으면 해당 계정 사용, 없으면 DB 선택 계정 사용
    const hasAccountOverride = !!req.query.account_id;
    const adAccountId = req.query.account_id || cred?.selected_ad_account_id;

    // Meta 미연결 시 수동 캠페인만 반환
    if (!cred || !adAccountId) {
      const manualCampaigns = db.prepare("SELECT * FROM campaigns WHERE source = 'manual' OR source IS NULL").all();
      return res.json(manualCampaigns);
    }

    const result = await fetchAccountInsights(cred.access_token, adAccountId, period);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    const metaCampaigns = (result.data || []).map((insight, idx) => ({
      id: 10000 + idx,
      ...mapAccountInsightToSchema(insight, period),
      ai_verdict: null,
      ai_recommendation: null,
      ai_fix_type: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // 계정을 명시적으로 선택한 경우 Meta API 데이터만 반환 (수동 캠페인 제외)
    if (hasAccountOverride) {
      return res.json(metaCampaigns);
    }

    // 기본 계정일 때만 수동 캠페인 포함
    const manualCampaigns = db.prepare("SELECT * FROM campaigns WHERE source = 'manual' OR source IS NULL").all();
    res.json([...manualCampaigns, ...metaCampaigns]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

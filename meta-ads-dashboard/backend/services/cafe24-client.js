// Cafe24 OAuth + Admin API 클라이언트 — 인증/토큰/API 호출 담당
import { getDb } from "../db/database.js";

const CAFE24_SCOPES = [
  "mall.read_application",
  "mall.read_store",
  "mall.read_product",
  "mall.read_order",
  "mall.read_salesreport",
].join(",");

/**
 * OAuth 인증 URL 생성
 */
export function buildCafe24OAuthUrl(mallId, clientId, redirectUri) {
  const base = `https://${mallId}.cafe24api.com/api/v2/oauth/authorize`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: CAFE24_SCOPES,
    state: "cafe24_oauth",
  });
  return `${base}?${params.toString()}`;
}

/**
 * 인증코드 → 토큰 교환
 */
export async function exchangeCafe24Token(mallId, clientId, clientSecret, code, redirectUri) {
  const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Cafe24 token exchange failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,           // 보통 7200초 (2시간)
    refresh_token_expires_in: data.refresh_token_expires_in, // 보통 1209600초 (2주)
    scopes: data.scopes || CAFE24_SCOPES,
  };
}

/**
 * 리프레시 토큰으로 액세스 토큰 갱신
 */
export async function refreshCafe24Token(mallId, clientId, clientSecret, refreshToken) {
  const url = `https://${mallId}.cafe24api.com/api/v2/oauth/token`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Cafe24 token refresh failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    refresh_token_expires_in: data.refresh_token_expires_in,
  };
}

/**
 * DB에 저장된 토큰 가져오기 + 만료 시 자동 갱신
 */
export async function getValidToken() {
  const db = getDb();
  const cred = db.prepare("SELECT * FROM cafe24_credentials WHERE id = 1").get();
  if (!cred) {
    return { data: null, error: "Cafe24 미연결" };
  }

  const now = new Date();
  const expiresAt = new Date(cred.expires_at);

  // 액세스 토큰이 아직 유효한 경우 (5분 여유)
  if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
    return { data: { token: cred.access_token, mallId: cred.mall_id }, error: null };
  }

  // 리프레시 토큰 만료 확인
  const refreshExpiresAt = new Date(cred.refresh_token_expires_at);
  if (refreshExpiresAt <= now) {
    return { data: null, error: "Cafe24 리프레시 토큰이 만료되었습니다. 다시 연동해주세요." };
  }

  // 설정에서 clientId/clientSecret 가져오기
  const config = db.prepare("SELECT * FROM cafe24_config WHERE id = 1").get();
  if (!config) {
    return { data: null, error: "Cafe24 설정이 없습니다." };
  }

  // 토큰 갱신
  try {
    const refreshed = await refreshCafe24Token(
      cred.mall_id,
      config.client_id,
      config.client_secret,
      cred.refresh_token
    );

    const newExpiresAt = new Date(now.getTime() + refreshed.expires_in * 1000).toISOString();
    const newRefreshExpiresAt = refreshed.refresh_token_expires_in
      ? new Date(now.getTime() + refreshed.refresh_token_expires_in * 1000).toISOString()
      : cred.refresh_token_expires_at;

    db.prepare(`
      UPDATE cafe24_credentials
      SET access_token = ?, refresh_token = ?, expires_at = ?, refresh_token_expires_at = ?, updated_at = datetime('now')
      WHERE id = 1
    `).run(refreshed.access_token, refreshed.refresh_token, newExpiresAt, newRefreshExpiresAt);

    return { data: { token: refreshed.access_token, mallId: cred.mall_id }, error: null };
  } catch (err) {
    return { data: null, error: `토큰 갱신 실패: ${err.message}` };
  }
}

/**
 * Cafe24 Admin API GET 요청 헬퍼 — Rate Limit 처리 포함
 */
export async function cafe24AdminGet(mallId, accessToken, endpoint, params = {}) {
  const url = new URL(`https://${mallId}.cafe24api.com/api/v2/admin${endpoint}`);
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) {
      url.searchParams.set(key, String(val));
    }
  }

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Cafe24-Api-Version": "2024-03-01",
      },
    });

    // Rate Limit (초당 2회 제한)
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      return { data: null, error: `Cafe24 API error: ${res.status} ${errText}` };
    }

    const data = await res.json();
    return { data, error: null };
  }

  return { data: null, error: "Cafe24 API rate limit exceeded after retries" };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 토큰을 DB에 저장
 */
export function saveTokenToDb(mallId, tokenData) {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + tokenData.expires_in * 1000).toISOString();
  const refreshExpiresAt = tokenData.refresh_token_expires_in
    ? new Date(now.getTime() + tokenData.refresh_token_expires_in * 1000).toISOString()
    : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 기본 2주

  db.prepare(`
    INSERT OR REPLACE INTO cafe24_credentials (id, mall_id, access_token, refresh_token, expires_at, refresh_token_expires_at, scopes)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(mallId, tokenData.access_token, tokenData.refresh_token, expiresAt, refreshExpiresAt, tokenData.scopes || CAFE24_SCOPES);
}

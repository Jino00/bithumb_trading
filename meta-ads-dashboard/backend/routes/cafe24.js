// Cafe24 연동 라우트 — OAuth 인증 + 주문 데이터 + 매출 요약
import { Router } from "express";
import { getDb } from "../db/database.js";
import {
  buildCafe24OAuthUrl,
  exchangeCafe24Token,
  saveTokenToDb,
  getValidToken,
} from "../services/cafe24-client.js";
import {
  fetchCafe24Orders,
  fetchCafe24SalesSummary,
  fetchCafe24Products,
  fetchMetaAttributedOrders,
} from "../services/cafe24-data.js";

const router = Router();

// ─── 설정 관리 ───

/** Cafe24 설정 저장 (Mall ID, Client ID, Client Secret) */
router.post("/config", (req, res) => {
  try {
    const { mall_id, client_id, client_secret } = req.body;
    if (!mall_id || !client_id || !client_secret) {
      return res.status(400).json({ error: "mall_id, client_id, client_secret 모두 필요합니다." });
    }

    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO cafe24_config (id, mall_id, client_id, client_secret, redirect_uri)
      VALUES (1, ?, ?, ?, ?)
    `).run(mall_id.trim(), client_id.trim(), client_secret.trim(), "http://localhost:3001/api/cafe24/callback");

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Cafe24 설정 조회 */
router.get("/config", (_req, res) => {
  try {
    const db = getDb();
    const config = db.prepare("SELECT * FROM cafe24_config WHERE id = 1").get();
    res.json({
      configured: !!config,
      mall_id: config?.mall_id || null,
      client_id_set: !!config?.client_id,
      redirect_uri: config?.redirect_uri || "http://localhost:3001/api/cafe24/callback",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OAuth 인증 ───

/** OAuth 인증 URL 생성 */
router.get("/auth-url", (_req, res) => {
  try {
    const db = getDb();
    const config = db.prepare("SELECT * FROM cafe24_config WHERE id = 1").get();
    if (!config) {
      return res.status(400).json({ error: "Cafe24 설정을 먼저 해주세요." });
    }

    const url = buildCafe24OAuthUrl(config.mall_id, config.client_id, config.redirect_uri);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** OAuth 콜백 처리 */
router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.status(400).send("인증 코드가 없습니다.");
    }

    const db = getDb();
    const config = db.prepare("SELECT * FROM cafe24_config WHERE id = 1").get();
    if (!config) {
      return res.status(400).send("Cafe24 설정이 없습니다.");
    }

    const tokenData = await exchangeCafe24Token(
      config.mall_id,
      config.client_id,
      config.client_secret,
      code,
      config.redirect_uri
    );

    saveTokenToDb(config.mall_id, tokenData);

    // 프론트엔드 Settings 페이지로 리다이렉트
    res.redirect("http://localhost:5173/?page=settings&cafe24=connected");
  } catch (err) {
    console.error("Cafe24 callback error:", err);
    res.redirect(`http://localhost:5173/?page=settings&cafe24=error&message=${encodeURIComponent(err.message)}`);
  }
});

// ─── 연결 상태 ───

/** 연결 상태 확인 */
router.get("/status", (_req, res) => {
  try {
    const db = getDb();
    const cred = db.prepare("SELECT * FROM cafe24_credentials WHERE id = 1").get();

    if (!cred) {
      return res.json({ connected: false });
    }

    const now = new Date();
    const expiresAt = new Date(cred.expires_at);
    const refreshExpiresAt = new Date(cred.refresh_token_expires_at);

    res.json({
      connected: true,
      mall_id: cred.mall_id,
      token_expires_at: cred.expires_at,
      token_valid: expiresAt > now,
      refresh_valid: refreshExpiresAt > now,
      refresh_expires_at: cred.refresh_token_expires_at,
      scopes: cred.scopes,
      updated_at: cred.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 연결 해제 */
router.post("/disconnect", (_req, res) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM cafe24_credentials WHERE id = 1").run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 데이터 조회 ───

/** 주문 목록 (기간 필터) */
router.get("/orders", async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const endDate = end_date || new Date().toISOString().substring(0, 10);
    const startDate = start_date || getDateNDaysAgo(30);

    const { data, error } = await fetchCafe24Orders(startDate, endDate);
    if (error) return res.status(400).json({ error });

    res.json({ orders: data, count: data.length, period: { start: startDate, end: endDate } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 매출 요약 */
router.get("/sales-summary", async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const endDate = end_date || new Date().toISOString().substring(0, 10);
    const startDate = start_date || getDateNDaysAgo(30);

    const { data, error } = await fetchCafe24SalesSummary(startDate, endDate);
    if (error) return res.status(400).json({ error });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Cafe24 상품 목록 */
router.get("/products", async (_req, res) => {
  try {
    const { data, error } = await fetchCafe24Products();
    if (error) return res.status(400).json({ error });

    res.json({ products: data, count: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Meta 광고 귀인 주문 (UTM 기반) */
router.get("/meta-orders", async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const endDate = end_date || new Date().toISOString().substring(0, 10);
    const startDate = start_date || getDateNDaysAgo(30);

    const { data, error } = await fetchMetaAttributedOrders(startDate, endDate);
    if (error) return res.status(400).json({ error });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 주문 데이터를 DB에 동기화 */
router.post("/sync", async (req, res) => {
  try {
    const { start_date, end_date } = req.body;
    const endDate = end_date || new Date().toISOString().substring(0, 10);
    const startDate = start_date || getDateNDaysAgo(30);

    const { data: orders, error } = await fetchCafe24Orders(startDate, endDate);
    if (error) return res.status(400).json({ error });

    const db = getDb();
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO cafe24_orders
        (order_id, order_date, total_amount, item_count, product_names, payment_method, utm_source, utm_campaign)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const syncAll = db.transaction((items) => {
      for (const order of items) {
        if (!order) continue;
        upsert.run(
          order.order_id,
          order.order_date,
          order.total_amount,
          order.item_count,
          order.product_names,
          order.payment_method,
          order.utm_source,
          order.utm_campaign
        );
      }
    });

    syncAll(orders);

    res.json({
      synced: orders.length,
      period: { start: startDate, end: endDate },
      meta_attributed: orders.filter(
        (o) => o && (o.utm_source === "facebook" || o.utm_source === "fb" || o.utm_source === "meta" || o.utm_source === "ig")
      ).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

export default router;

// Cafe24 일일 자동 동기화 잡 — 주문 데이터 수집 + DB 저장 + 크로스 검증 트리거
import { getDb } from "../db/database.js";
import { getValidToken } from "./cafe24-client.js";
import { fetchCafe24Orders, fetchMetaAttributedOrders } from "./cafe24-data.js";
import { crossValidate } from "./data-cross-validator.js";

/**
 * 일일 Cafe24 주문 동기화 잡
 * - Cafe24 미연결이면 스킵
 * - 최근 7일 주문 데이터를 가져와서 DB에 upsert
 * - Meta 귀인 주문을 따로 집계
 * - 크로스 검증 실행 (Meta Pixel vs Cafe24 실제 데이터)
 */
export async function syncCafe24OrdersJob() {
  // 1. Cafe24 연결 상태 확인
  const { data: auth, error: authErr } = await getValidToken();
  if (authErr) {
    return { skipped: true, reason: authErr };
  }

  // 2. 동기화 기간 설정 (최근 7일 — 결제 확정 지연 고려)
  const endDate = new Date().toISOString().substring(0, 10);
  const startDate = getDateNDaysAgo(7);

  // 3. 주문 데이터 가져오기
  const { data: orders, error: fetchErr } = await fetchCafe24Orders(startDate, endDate);
  if (fetchErr) {
    return { skipped: true, reason: `주문 조회 실패: ${fetchErr}` };
  }

  // 4. DB에 upsert
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

  // 5. Meta 귀인 주문 집계
  const metaAttributed = orders.filter(
    (o) => o && (o.utm_source === "facebook" || o.utm_source === "fb" || o.utm_source === "meta" || o.utm_source === "ig")
  );

  // 6. 크로스 검증 실행 (Meta Pixel 데이터 vs Cafe24 실제 데이터)
  let crossValidation = null;
  try {
    crossValidation = crossValidate(startDate, endDate);
  } catch (err) {
    console.error("[Cafe24SyncJob] Cross-validation failed:", err.message);
  }

  return {
    skipped: false,
    synced: orders.length,
    period: { start: startDate, end: endDate },
    meta_attributed: metaAttributed.length,
    total_revenue: orders.reduce((sum, o) => sum + (o?.total_amount || 0), 0),
    meta_revenue: metaAttributed.reduce((sum, o) => sum + (o?.total_amount || 0), 0),
    cross_validation: crossValidation,
    synced_at: new Date().toISOString(),
  };
}

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

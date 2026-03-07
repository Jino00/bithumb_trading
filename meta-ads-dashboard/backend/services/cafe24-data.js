// Cafe24 데이터 서비스 — 주문/매출/상품 데이터 조회 및 가공
import { cafe24AdminGet, getValidToken } from "./cafe24-client.js";

/**
 * Cafe24 주문 목록 조회 (결제완료 기준)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 */
export async function fetchCafe24Orders(startDate, endDate) {
  const { data: auth, error: authErr } = await getValidToken();
  if (authErr) return { data: null, error: authErr };

  const allOrders = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data, error } = await cafe24AdminGet(auth.mallId, auth.token, "/orders", {
      start_date: startDate,
      end_date: endDate,
      order_status: "N20,N30,N40", // 결제완료,배송준비,배송중
      limit,
      offset,
      embed: "items",
    });

    if (error) return { data: null, error };

    const orders = data?.orders || [];
    if (orders.length === 0) break;

    for (const order of orders) {
      allOrders.push(mapCafe24Order(order));
    }

    if (orders.length < limit) break;
    offset += limit;

    // Rate limit 방지 (초당 2회 제한)
    await sleep(600);
  }

  return { data: allOrders, error: null };
}

/**
 * 주문 상세 조회
 */
export async function fetchCafe24OrderDetail(orderId) {
  const { data: auth, error: authErr } = await getValidToken();
  if (authErr) return { data: null, error: authErr };

  const { data, error } = await cafe24AdminGet(auth.mallId, auth.token, `/orders/${orderId}`, {
    embed: "items",
  });

  if (error) return { data: null, error };

  return { data: mapCafe24Order(data?.order), error: null };
}

/**
 * Cafe24 상품 목록 조회
 */
export async function fetchCafe24Products() {
  const { data: auth, error: authErr } = await getValidToken();
  if (authErr) return { data: null, error: authErr };

  const allProducts = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data, error } = await cafe24AdminGet(auth.mallId, auth.token, "/products", {
      limit,
      offset,
      display: "T", // 진열 중인 상품만
    });

    if (error) return { data: null, error };

    const products = data?.products || [];
    if (products.length === 0) break;

    for (const product of products) {
      allProducts.push({
        product_no: product.product_no,
        product_name: product.product_name,
        price: parseFloat(product.price || "0"),
        category: product.category_no,
        selling: product.selling === "T",
        display: product.display === "T",
      });
    }

    if (products.length < limit) break;
    offset += limit;
    await sleep(600);
  }

  return { data: allProducts, error: null };
}

/**
 * 기간 매출 요약 (주문 데이터 기반 자체 집계)
 */
export async function fetchCafe24SalesSummary(startDate, endDate) {
  const { data: orders, error } = await fetchCafe24Orders(startDate, endDate);
  if (error) return { data: null, error };

  const summary = {
    period: { start: startDate, end: endDate },
    total_orders: orders.length,
    total_revenue: 0,
    total_items: 0,
    avg_order_value: 0,
    payment_methods: {},
    utm_sources: {},
    daily_revenue: {},
  };

  for (const order of orders) {
    summary.total_revenue += order.total_amount;
    summary.total_items += order.item_count;

    // 결제수단 집계
    const method = order.payment_method || "unknown";
    summary.payment_methods[method] = (summary.payment_methods[method] || 0) + 1;

    // UTM 소스 집계 (Meta 광고 추적용)
    if (order.utm_source) {
      const src = order.utm_source;
      summary.utm_sources[src] = (summary.utm_sources[src] || 0) + 1;
    }

    // 일별 매출
    const day = order.order_date.substring(0, 10);
    if (!summary.daily_revenue[day]) {
      summary.daily_revenue[day] = { revenue: 0, orders: 0 };
    }
    summary.daily_revenue[day].revenue += order.total_amount;
    summary.daily_revenue[day].orders += 1;
  }

  summary.avg_order_value = orders.length > 0
    ? Math.round(summary.total_revenue / orders.length)
    : 0;

  return { data: summary, error: null };
}

/**
 * Meta 광고 → Cafe24 전환 매칭
 * UTM 파라미터 기반으로 어떤 광고에서 유입된 주문인지 파악
 */
export async function fetchMetaAttributedOrders(startDate, endDate) {
  const { data: orders, error } = await fetchCafe24Orders(startDate, endDate);
  if (error) return { data: null, error };

  const metaOrders = orders.filter(
    (o) => o.utm_source === "facebook" || o.utm_source === "fb" || o.utm_source === "meta" || o.utm_source === "ig"
  );

  const byCampaign = {};
  for (const order of metaOrders) {
    const campaignName = order.utm_campaign || "unknown";
    if (!byCampaign[campaignName]) {
      byCampaign[campaignName] = {
        campaign_name: campaignName,
        orders: 0,
        revenue: 0,
        items: 0,
        avg_order_value: 0,
      };
    }
    byCampaign[campaignName].orders += 1;
    byCampaign[campaignName].revenue += order.total_amount;
    byCampaign[campaignName].items += order.item_count;
  }

  // AOV 계산
  for (const key of Object.keys(byCampaign)) {
    const c = byCampaign[key];
    c.avg_order_value = c.orders > 0 ? Math.round(c.revenue / c.orders) : 0;
  }

  return {
    data: {
      total_meta_orders: metaOrders.length,
      total_meta_revenue: metaOrders.reduce((s, o) => s + o.total_amount, 0),
      by_campaign: Object.values(byCampaign),
      all_orders: orders.length,
      meta_attribution_rate: orders.length > 0
        ? ((metaOrders.length / orders.length) * 100).toFixed(1) + "%"
        : "0%",
    },
    error: null,
  };
}

/**
 * Cafe24 주문 → 표준 스키마 매핑
 */
function mapCafe24Order(order) {
  if (!order) return null;

  const items = (order.items || []).map((item) => ({
    product_no: item.product_no,
    product_name: item.product_name,
    quantity: parseInt(item.quantity || "1", 10),
    price: parseFloat(item.product_price || "0"),
    option_value: item.option_value || null,
  }));

  // 결제 금액 추출 — Cafe24 API 응답 형식에 맞게
  const totalAmount = parseFloat(
    order.payment_amount
    || order.actual_order_amount?.payment_amount
    || order.initial_order_amount?.payment_amount
    || "0"
  );

  // 결제수단 — 배열 또는 문자열
  const paymentMethod = Array.isArray(order.payment_method_name)
    ? order.payment_method_name.join(", ")
    : (order.payment_method_name || order.payment_gateway_name || null);

  // UTM 파라미터 추출 (order_place_id 또는 별도 필드에서)
  const utmSource = extractUtmParam(order, "source");
  const utmMedium = extractUtmParam(order, "medium");
  const utmCampaign = extractUtmParam(order, "campaign");

  // 주문 유입 경로 (order_place_name)
  const orderPlaceName = order.order_place_name || null;
  const orderPlaceId = order.order_place_id || null;

  return {
    order_id: order.order_id,
    order_date: order.order_date || order.created_date,
    order_status: order.order_status,
    total_amount: totalAmount,
    item_count: items.length,
    items,
    product_names: items.map((i) => i.product_name).join(", "),
    payment_method: paymentMethod,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    order_place_name: orderPlaceName,
    order_place_id: orderPlaceId,
    buyer_name: order.buyer_name || null,
    buyer_email: order.buyer_email || null,
  };
}

/**
 * 주문에서 UTM 파라미터 추출 (Cafe24는 inflow 정보를 다양한 방식으로 저장)
 */
function extractUtmParam(order, param) {
  // Cafe24의 유입경로 추적 필드에서 UTM 추출
  if (order[`utm_${param}`]) return order[`utm_${param}`];

  // additional_info 또는 extra_info에서 추출
  const extra = order.additional_info || order.extra_info || "";
  const match = extra.match(new RegExp(`utm_${param}=([^&]+)`));
  if (match) return decodeURIComponent(match[1]);

  // order_place_name으로 소스 추정
  if (param === "source" && order.order_place_name) {
    const place = order.order_place_name.toLowerCase();
    if (place.includes("facebook") || place.includes("meta")) return "facebook";
    if (place.includes("instagram")) return "ig";
    if (place.includes("naver")) return "naver";
    if (place.includes("google")) return "google";
  }

  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

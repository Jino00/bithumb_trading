// Meta Pixel 진단 + Cafe24 설치 가이드 서비스 — Pixel 상태 확인 + 설치 코드 생성
import fetch from "node-fetch";
import { getDb } from "../db/database.js";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Meta Pixel 종합 진단
 * - 광고 계정에 연결된 Pixel 조회
 * - Pixel 이벤트 수신 상태 확인
 * - 캠페인 데이터에서 퍼널 이벤트 수집 여부 확인
 * - Cafe24 설치 가이드 생성
 */
export async function diagnosePixel() {
  const db = getDb();
  const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'").get();

  const result = {
    pixel_info: null,
    event_status: null,
    funnel_check: null,
    cafe24_guide: null,
    overall_status: "unknown",
    issues: [],
    actions: [],
  };

  // 1. Meta 연결 상태 확인
  if (!cred) {
    result.overall_status = "disconnected";
    result.issues.push({ severity: "critical", message: "Meta 계정이 연결되지 않았습니다." });
    result.actions.push("Settings 페이지에서 Meta OAuth 연동을 먼저 진행하세요.");
    return result;
  }

  const accountId = cred.selected_ad_account_id?.replace("act_", "");
  if (!accountId) {
    result.overall_status = "no_account";
    result.issues.push({ severity: "critical", message: "광고 계정이 선택되지 않았습니다." });
    result.actions.push("Settings에서 광고 계정을 선택하세요.");
    return result;
  }

  // 2. Pixel 정보 조회
  try {
    const pixelData = await fetchAdAccountPixels(cred.access_token, accountId);
    if (pixelData.error) {
      result.pixel_info = { error: pixelData.error };
      result.issues.push({ severity: "warning", message: `Pixel 조회 실패: ${pixelData.error}` });
    } else {
      const pixels = pixelData.data || [];
      result.pixel_info = {
        pixel_count: pixels.length,
        pixels: pixels.map((p) => ({
          id: p.id,
          name: p.name,
          creation_time: p.creation_time,
          last_fired_time: p.last_fired_time,
          is_active: !!p.last_fired_time,
        })),
      };

      if (pixels.length === 0) {
        result.issues.push({
          severity: "critical",
          message: "광고 계정에 연결된 Meta Pixel이 없습니다.",
        });
        result.actions.push("Meta Events Manager에서 Pixel을 생성하세요: https://business.facebook.com/events_manager");
      } else {
        // Pixel이 있지만 최근에 이벤트를 안 보낸 경우
        const activePixels = pixels.filter((p) => p.last_fired_time);
        if (activePixels.length === 0) {
          result.issues.push({
            severity: "critical",
            message: "Pixel이 존재하지만 이벤트를 수신하지 못하고 있습니다. Pixel 코드가 사이트에 설치되지 않았을 수 있습니다.",
          });
        }
      }
    }
  } catch (err) {
    result.pixel_info = { error: err.message };
  }

  // 3. 캠페인 데이터에서 퍼널 이벤트 수집 여부 확인
  const campaigns = db.prepare(`
    SELECT name, clicks, purchase_count, landing_page_views, content_views,
           add_to_cart_count, initiate_checkout_count
    FROM campaigns WHERE source = 'meta'
  `).all();

  const totalClicks = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalPurchases = campaigns.reduce((s, c) => s + (c.purchase_count || 0), 0);
  const totalLanding = campaigns.reduce((s, c) => s + (c.landing_page_views || 0), 0);
  const totalContent = campaigns.reduce((s, c) => s + (c.content_views || 0), 0);
  const totalCart = campaigns.reduce((s, c) => s + (c.add_to_cart_count || 0), 0);
  const totalCheckout = campaigns.reduce((s, c) => s + (c.initiate_checkout_count || 0), 0);

  const funnelEmpty = totalLanding === 0 && totalContent === 0 && totalCart === 0 && totalCheckout === 0;

  result.funnel_check = {
    campaigns_checked: campaigns.length,
    total_clicks: totalClicks,
    total_purchases: totalPurchases,
    funnel_events: {
      landing_page_view: totalLanding,
      view_content: totalContent,
      add_to_cart: totalCart,
      initiate_checkout: totalCheckout,
    },
    funnel_empty: funnelEmpty,
    has_purchases_but_no_funnel: totalPurchases > 0 && funnelEmpty,
  };

  if (funnelEmpty && totalClicks > 0) {
    result.issues.push({
      severity: "critical",
      message: `클릭 ${totalClicks.toLocaleString()}건이 있지만 퍼널 이벤트(ViewContent, AddToCart 등)가 0건입니다. Pixel 표준 이벤트가 설치되지 않았습니다.`,
    });
    result.actions.push("Cafe24 관리자 패널에서 Meta Pixel 표준 이벤트를 설치하세요 (아래 가이드 참고).");
  }

  if (totalPurchases > 0 && funnelEmpty) {
    result.issues.push({
      severity: "warning",
      message: "구매(Purchase) 이벤트는 작동하지만 중간 퍼널이 비어있습니다. Purchase만 설정되고 ViewContent/AddToCart/InitiateCheckout은 미설정된 상태입니다.",
    });
  }

  // 4. Cafe24 설치 가이드 생성
  const pixelId = result.pixel_info?.pixels?.[0]?.id || "YOUR_PIXEL_ID";
  result.cafe24_guide = generateCafe24PixelGuide(pixelId);

  // 5. 전체 상태 판정
  if (result.issues.some((i) => i.severity === "critical")) {
    result.overall_status = "critical";
  } else if (result.issues.some((i) => i.severity === "warning")) {
    result.overall_status = "warning";
  } else {
    result.overall_status = "healthy";
  }

  // 6. 이벤트 상태 진단
  result.event_status = {
    purchase: totalPurchases > 0 ? "active" : "inactive",
    view_content: totalContent > 0 ? "active" : "inactive",
    add_to_cart: totalCart > 0 ? "active" : "inactive",
    initiate_checkout: totalCheckout > 0 ? "active" : "inactive",
    landing_page_view: totalLanding > 0 ? "active" : "inactive",
  };

  return result;
}

/**
 * Cafe24 사이트에 Meta Pixel 설치하는 구체적인 가이드 생성
 */
function generateCafe24PixelGuide(pixelId) {
  return {
    overview: "Cafe24 쇼핑몰에 Meta Pixel을 설치하여 ViewContent, AddToCart, InitiateCheckout, Purchase 이벤트를 추적합니다.",
    steps: [
      {
        step: 1,
        title: "Cafe24 관리자 로그인",
        description: "Cafe24 쇼핑몰 관리자 패널에 접속합니다.",
        url: "https://YOUR_MALL_ID.cafe24.com/disp/admin",
      },
      {
        step: 2,
        title: "외부 스크립트 관리 페이지",
        description: "쇼핑몰 설정 → 기본 설정 → 외부 서비스 연동 → Meta (Facebook) Pixel 설정으로 이동합니다.",
        path: "관리자 → 쇼핑몰 설정 → 외부 서비스 연동 → Facebook Pixel",
      },
      {
        step: 3,
        title: "Pixel ID 입력",
        description: `Meta Pixel ID를 입력합니다: ${pixelId}`,
        pixel_id: pixelId,
      },
      {
        step: 4,
        title: "표준 이벤트 활성화",
        description: "다음 이벤트를 모두 활성화합니다",
        events: [
          { event: "PageView", page: "전체 페이지", description: "기본 페이지 뷰 추적" },
          { event: "ViewContent", page: "상품 상세 페이지", description: "상품 조회 추적" },
          { event: "AddToCart", page: "장바구니 추가", description: "장바구니 추가 추적" },
          { event: "InitiateCheckout", page: "주문서 작성", description: "결제 시작 추적" },
          { event: "Purchase", page: "주문 완료", description: "구매 완료 추적 (value 포함)" },
        ],
      },
      {
        step: 5,
        title: "Purchase 이벤트 value 설정 확인",
        description: "Purchase 이벤트의 value 파라미터가 실제 결제 금액(KRW)으로 설정되어 있는지 확인합니다. 이 값이 없으면 ROAS 계산이 불가합니다.",
        important: true,
      },
      {
        step: 6,
        title: "설치 확인",
        description: "Meta Pixel Helper 크롬 확장프로그램으로 이벤트가 정상 발동되는지 테스트합니다.",
        tool_url: "https://chrome.google.com/webstore/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc",
      },
    ],
    alternative_method: {
      title: "직접 스크립트 삽입 (Cafe24 기본 Pixel 연동이 안 될 경우)",
      description: "Cafe24 관리자 → 쇼핑몰 설정 → 기본 설정 → 검색엔진 최적화(SEO) → 하단 공통 스크립트에 직접 삽입",
      base_code: `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`,
      event_codes: {
        view_content: `fbq('track', 'ViewContent', {
  content_name: '상품명',
  content_ids: ['상품번호'],
  content_type: 'product',
  value: 상품가격,
  currency: 'KRW'
});`,
        add_to_cart: `fbq('track', 'AddToCart', {
  content_ids: ['상품번호'],
  content_type: 'product',
  value: 상품가격,
  currency: 'KRW'
});`,
        initiate_checkout: `fbq('track', 'InitiateCheckout', {
  value: 총결제금액,
  currency: 'KRW',
  num_items: 상품수
});`,
        purchase: `fbq('track', 'Purchase', {
  content_ids: ['상품번호1', '상품번호2'],
  content_type: 'product',
  value: 실제결제금액,
  currency: 'KRW',
  num_items: 구매상품수
});`,
      },
    },
  };
}

// ─── Meta Graph API 헬퍼 ───

async function fetchAdAccountPixels(accessToken, accountId) {
  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/act_${accountId}/adspixels?fields=id,name,creation_time,last_fired_time&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      const err = await res.json();
      return { data: null, error: err.error?.message || "Pixel 조회 실패" };
    }
    const json = await res.json();
    return { data: json.data || [], error: null };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

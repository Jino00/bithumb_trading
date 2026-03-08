// 캠페인 복합진단 엔진 — 개별 지표 채점 + 퍼널 복합 패턴 분석 + 동적 벤치마크 + 학습 기반 추천
// Meta purchase_roas(Cafe24 Pixel) + 자사몰 퍼널 데이터(landing→view→cart→checkout→purchase)를
// 조합하여 어디서 문제가 발생하는지 정확히 진단하고, 구체적 개선 액션을 제안한다.
// 트렌드 인텔리전스의 동적 벤치마크 + 학습 데이터를 결합하여 데이터 기반 추천을 제공한다.
// ※ 학습 반영 (v2): blendThreshold()로 하드코딩 기준 → 동적 벤치마크 기준 점진적 전환
import { getBenchmarks, getSmartRecommendations } from "./trend-intelligence.js";
import { calcCampaignProfitability, calcProfitabilitySummary, roundN } from "./biz-metrics.js";

// ─── 학습 기반 동적 기준 유틸 ───

/**
 * 하드코딩 기준과 학습된 벤치마크 기준을 데이터 성숙도에 따라 혼합
 * 데이터가 부족한 초기에는 하드코딩 100%, 데이터가 쌓일수록 학습 기준 비율 증가
 *
 * @param {number} hardcoded — 기존 고정값 (예: 2000)
 * @param {number|null|undefined} learned — 벤치마크에서 가져온 값 (예: benchmarks.cpc.p75)
 * @param {number} sampleCount — 벤치마크 산출에 사용된 데이터 수
 * @param {number} minSamples — 학습 기준을 100% 신뢰하기 위한 최소 샘플 수 (기본: 30)
 * @returns {number} 혼합된 기준값
 */
export function blendThreshold(hardcoded, learned, sampleCount, minSamples = 30) {
  if (learned == null || !isFinite(learned) || sampleCount < 7) return hardcoded;
  const weight = Math.min(sampleCount / minSamples, 1.0);
  return hardcoded * (1 - weight) + learned * weight;
}

/**
 * 단일 캠페인 판정 — 개별 지표 채점 + 복합 퍼널 진단
 * @param {object} campaign - { roas, ctr, cpc, frequency, cpa, aov, revenue, total_spend,
 *   purchase_count, clicks, landing_page_views, content_views, add_to_cart_count, initiate_checkout_count }
 * @param {object|null} benchmarks - getBenchmarks() 반환값의 metrics 객체 (학습 기반 동적 기준)
 * @returns {{ verdict, severity, reasons[], recommendations[], score, funnel_diagnosis }}
 */
export function judgeCampaign(campaign, benchmarks = null) {
  const {
    roas = 0, ctr = 0, cpc = 0, frequency = 0, cpa = 0,
    total_spend = 0, purchase_count = 0,
    cost_price = 0, revenue = 0, aov = 0,
  } = campaign;
  const reasons = [];
  const recommendations = [];
  let score = 50;

  // ─── 1단계: 개별 지표 채점 (벤치마크 기반 동적 기준) ───
  score = scoreRoas(roas, total_spend, score, reasons, recommendations, benchmarks);
  score = scoreCtr(ctr, score, reasons, recommendations, benchmarks);
  score = scoreCpc(cpc, score, reasons, recommendations, benchmarks);
  score = scoreFrequency(frequency, score, reasons, recommendations, benchmarks);
  score = scoreCpa(cpa, score, reasons, recommendations, benchmarks);
  score = scoreNoPurchase(purchase_count, total_spend, score, reasons, recommendations);

  // ─── 1.5단계: 원가 기반 수익성 진단 ───
  const profitability = scoreProfitability(
    { cost_price, revenue, total_spend, purchase_count, aov, roas },
    score, reasons, recommendations
  );
  score = profitability.score;

  // ─── 2단계: 복합 퍼널 진단 (Cafe24 자사몰 행동 분석, 벤치마크 기반) ───
  const funnelDiagnosis = diagnoseFunnel(campaign, benchmarks);

  // 퍼널 진단 결과를 reasons/recommendations에 병합
  for (const diag of funnelDiagnosis) {
    reasons.push(`[${diag.stage}] ${diag.diagnosis}`);
    for (const rec of diag.actions) {
      if (!recommendations.includes(rec)) {
        recommendations.push(rec);
      }
    }
    // 퍼널 병목은 점수에도 영향
    if (diag.severity === "critical") score -= 10;
    else if (diag.severity === "warning") score -= 5;
  }

  // ─── 3단계: 최종 판정 ───
  const clampedScore = Math.max(0, Math.min(100, score));
  const { verdict, severity } = getVerdict(clampedScore, roas);

  return {
    verdict,
    severity,
    score: clampedScore,
    reasons,
    recommendations: recommendations.length > 0 ? recommendations : ["현행 유지"],
    funnel_diagnosis: funnelDiagnosis,
    profitability: profitability.data,
  };
}

// ─── 원가 기반 수익성 채점 (계산은 biz-metrics.js SSOT 사용) ───
function scoreProfitability({ cost_price, revenue, total_spend, purchase_count, aov, roas }, score, reasons, recommendations) {
  const p = calcCampaignProfitability({
    costPrice: cost_price,
    purchases: purchase_count || 0,
    revenue,
    adSpend: total_spend,
    aov,
  });

  // snake_case 변환 (기존 API 호환)
  const data = {
    cost_price: cost_price || 0,
    cogs: p.cogs,
    gross_profit: p.grossProfit,
    net_profit: p.netProfit,
    gross_margin: p.grossMargin,
    net_margin: p.netMargin,
    true_roi: p.trueRoi,
    break_even_roas: p.breakEvenRoas,
  };

  if (!p.hasCostData) {
    return { score, data };
  }

  // 순이익 기반 채점 (채점/추천 로직은 judge 전용)
  if (p.netProfit > 0) {
    if (p.trueRoi >= 50) {
      score += 10;
      reasons.push(`💰 순이익 +₩${Math.round(p.netProfit).toLocaleString()} (ROI ${p.trueRoi}%) — 수익성 우수`);
    } else {
      score += 5;
      reasons.push(`💰 순이익 +₩${Math.round(p.netProfit).toLocaleString()} (ROI ${p.trueRoi}%) — 흑자이나 마진 개선 필요`);
      recommendations.push(`AOV(₩${Math.round(aov).toLocaleString()}) 올리기: 세트 상품, 업셀 제안으로 객단가 향상`);
    }
  } else if ((purchase_count || 0) > 0) {
    score -= 10;
    reasons.push(`🔴 원가+광고비 반영 순손실 ₩${Math.round(Math.abs(p.netProfit)).toLocaleString()} — ROAS ${roas.toFixed(2)}x이지만 실제로는 적자`);
    recommendations.push(`손익분기 ROAS ${p.breakEvenRoas}x 이상 필요 — CPA 낮추거나 AOV 올려야 함`);
    recommendations.push(`원가 ₩${cost_price.toLocaleString()} 대비 CPA ₩${Math.round(total_spend / purchase_count).toLocaleString()} 검토`);
  }

  return { score, data };
}

// ─── 퍼널 복합진단: 지표 조합으로 병목 지점 + 원인 식별 ───

/**
 * Cafe24 자사몰 퍼널 데이터 + Meta 광고 지표를 조합하여
 * 광고→랜딩→상품조회→장바구니→결제→구매 각 단계의 병목을 진단
 *
 * @param {object} campaign
 * @returns {Array<{ stage, diagnosis, severity, evidence, actions[], funnel_rates }>}
 */
function diagnoseFunnel(campaign, benchmarks = null) {
  const {
    clicks = 0, ctr = 0, cpc = 0, roas = 0, frequency = 0, cpa = 0,
    landing_page_views = 0, content_views = 0,
    add_to_cart_count = 0, initiate_checkout_count = 0,
    purchase_count = 0, total_spend = 0,
  } = campaign;

  const diagnoses = [];

  // 퍼널 전환율 계산
  const rates = computeFunnelRates(clicks, landing_page_views, content_views,
    add_to_cart_count, initiate_checkout_count, purchase_count);

  // 동적 기준: 벤치마크 데이터가 있으면 p25/p75 사용, 없으면 하드코딩 fallback
  const sc = benchmarks?.ctr?.sample_count || 0;
  const ctrLowThreshold = blendThreshold(1, benchmarks?.ctr?.p25, sc);
  const cpcHighThreshold = blendThreshold(2000, benchmarks?.cpc?.p75, sc);
  const freqHighThreshold = blendThreshold(3, benchmarks?.frequency?.p75, sc);

  // 데이터 부족 시 퍼널 진단 건너뛰기 (클릭이 너무 적으면 통계적으로 무의미)
  if (clicks < 10) {
    return [{
      stage: "데이터 부족",
      diagnosis: `클릭 ${clicks}건 — 퍼널 분석에 충분한 데이터가 없습니다`,
      severity: "info",
      evidence: `clicks: ${clicks}`,
      actions: ["데이터가 더 쌓일 때까지 현행 유지"],
      funnel_rates: rates,
    }];
  }

  // ─── 패턴 1: 광고 소재 문제 (CTR 낮음) ───
  if (ctr < ctrLowThreshold) {
    diagnoses.push({
      stage: "광고 소재",
      diagnosis: `CTR ${ctr.toFixed(2)}% — 광고가 타겟에게 매력적이지 않음`,
      severity: "critical",
      evidence: `CTR ${ctr.toFixed(2)}% (기준: ${roundN(ctrLowThreshold)}%+), CPC ₩${Math.round(cpc).toLocaleString()}`,
      actions: [
        "광고 크리에이티브 전면 교체 (훅/첫 3초 임팩트 강화)",
        "타겟 오디언스와 소재 메시지 일치도 점검",
        cpc > cpcHighThreshold ? `CPC 과다 (₩${Math.round(cpc).toLocaleString()} > 기준 ₩${Math.round(cpcHighThreshold).toLocaleString()}) — 타겟 범위 확대로 경쟁 완화` : null,
      ].filter(Boolean),
      funnel_rates: rates,
    });
  }

  // ─── 패턴 2: 타겟팅 문제 (CPC 높고 CTR도 낮음) ───
  if (cpc > cpcHighThreshold && ctr < 1.5) {
    diagnoses.push({
      stage: "타겟팅",
      diagnosis: `CPC ₩${Math.round(cpc).toLocaleString()} + CTR ${ctr.toFixed(2)}% — 타겟 불일치`,
      severity: "warning",
      evidence: `비싼 클릭비용(기준: ₩${Math.round(cpcHighThreshold).toLocaleString()})인데 반응도 저조 = 잘못된 오디언스에 노출 중`,
      actions: [
        "타겟 오디언스 재설계 (관심사/행동 기반 세분화)",
        "Lookalike 오디언스 소스 변경 (구매자 기반 → 장바구니 기반)",
        "Broad 타겟으로 전환하여 Meta 알고리즘에 최적화 위임",
      ],
      funnel_rates: rates,
    });
  }

  // ─── 패턴 3: 광고 피로감 (Frequency 높음 + CTR 하락 의심) ───
  if (frequency > freqHighThreshold && ctr < 2) {
    diagnoses.push({
      stage: "광고 피로",
      diagnosis: `Frequency ${frequency.toFixed(1)} + CTR ${ctr.toFixed(2)}% — 같은 유저에게 반복 노출`,
      severity: frequency > 5 ? "critical" : "warning",
      evidence: `동일 유저 평균 ${frequency.toFixed(1)}회 노출(기준: ${roundN(freqHighThreshold)}회) → 소재 피로감 → CTR 하락`,
      actions: [
        "크리에이티브 즉시 교체 (새 이미지/영상 + 카피)",
        "오디언스 확장으로 새로운 유저 풀 확보",
        frequency > 5 ? "Frequency Cap 설정 (주당 2~3회 제한)" : null,
      ].filter(Boolean),
      funnel_rates: rates,
    });
  }

  // ─── 퍼널 진단 (Cafe24 자사몰 내 고객 행동 분석) ───
  // 랜딩페이지 데이터가 있을 때만 진행
  if (landing_page_views > 0 || content_views > 0 || add_to_cart_count > 0) {
    diagnoseLandingPage(rates, clicks, landing_page_views, diagnoses);
    diagnoseProductPage(rates, landing_page_views, content_views, add_to_cart_count, diagnoses);
    diagnoseCartAbandonment(rates, add_to_cart_count, initiate_checkout_count, diagnoses);
    diagnoseCheckoutFriction(rates, initiate_checkout_count, purchase_count, diagnoses);
  }

  // ─── 패턴: CTR 좋은데 ROAS 낮음 = 자사몰 내 문제 (복합진단 핵심) ───
  if (ctr >= 1.5 && roas < 1 && total_spend > 30000) {
    // 퍼널 데이터가 없어도 이 패턴은 진단 가능
    if (diagnoses.length === 0 || !diagnoses.some(d => d.stage.includes("랜딩") || d.stage.includes("상품") || d.stage.includes("장바구니") || d.stage.includes("결제"))) {
      diagnoses.push({
        stage: "자사몰 전환",
        diagnosis: `CTR ${ctr.toFixed(2)}%(양호) but ROAS ${roas.toFixed(2)}x(적자) — 광고는 잘 되지만 자사몰에서 전환 실패`,
        severity: "critical",
        evidence: `클릭은 발생하나 구매 전환이 부족 → 랜딩페이지/상품페이지/결제 과정 점검 필요`,
        actions: [
          "랜딩 페이지 로딩 속도 확인 (3초 이내 목표)",
          "광고 소재와 랜딩 페이지 메시지 일치도 점검",
          "상품 상세페이지 개선 (리뷰 표시, 상세 이미지, 가격 명확화)",
          "결제 과정 간소화 (게스트 결제, 다양한 결제수단)",
          add_to_cart_count === 0 ? "Meta Pixel add_to_cart 이벤트 발화 확인" : null,
        ].filter(Boolean),
        funnel_rates: rates,
      });
    }
  }

  // ─── 패턴: AOV 문제 (구매는 있지만 객단가가 낮아 ROAS 부진) ───
  if (purchase_count > 0 && roas < 1.5 && cpa > 0) {
    const aov = campaign.aov || 0;
    if (aov > 0 && aov < cpa * 1.5) {
      diagnoses.push({
        stage: "객단가(AOV)",
        diagnosis: `AOV ₩${Math.round(aov).toLocaleString()} vs CPA ₩${Math.round(cpa).toLocaleString()} — 객단가 대비 획득비용이 높음`,
        severity: "warning",
        evidence: `구매는 발생하지만 객단가가 낮아 수익성 부족 (AOV/CPA 비율: ${(aov / cpa).toFixed(1)}x)`,
        actions: [
          "묶음 상품/세트 구성으로 AOV 올리기",
          "최소 구매금액 무료배송 정책 (예: ₩30,000 이상 무배)",
          "장바구니 페이지에서 관련 상품 추천 (크로스셀)",
          "업셀 팝업 적용 (결제 직전 프리미엄 옵션 제안)",
        ],
        funnel_rates: rates,
      });
    }
  }

  // 진단 결과가 없으면 '양호' 반환
  if (diagnoses.length === 0) {
    diagnoses.push({
      stage: "퍼널 전체",
      diagnosis: "특이 병목 없음 — 전체 퍼널 정상 작동",
      severity: "good",
      evidence: `CTR ${ctr.toFixed(2)}%, ROAS ${roas.toFixed(2)}x`,
      actions: ["현행 유지 + 점진적 스케일링"],
      funnel_rates: rates,
    });
  }

  return diagnoses;
}

// ─── 퍼널 각 단계별 세부 진단 함수 ───

/**
 * 랜딩 페이지 진단: 클릭 → 랜딩 전환율
 * 클릭했는데 랜딩 페이지 도착이 저조하면 = 페이지 로딩/매칭 문제
 */
function diagnoseLandingPage(rates, clicks, landingViews, diagnoses) {
  if (clicks === 0 || landingViews === 0) return;

  const rate = rates.click_to_landing;
  if (rate < 50) {
    diagnoses.push({
      stage: "랜딩 페이지 도달",
      diagnosis: `클릭→랜딩 ${rate.toFixed(0)}% — 클릭 대비 랜딩 도착률 낮음`,
      severity: "critical",
      evidence: `${clicks}클릭 중 ${landingViews}명만 랜딩 도착 (${rate.toFixed(0)}%)`,
      actions: [
        "랜딩 페이지 로딩 속도 점검 (Google PageSpeed Insights)",
        "모바일 최적화 확인 (광고 트래픽 대부분 모바일)",
        "리다이렉트 체인 제거 (광고 URL → 최종 URL 직접 연결)",
        "팝업/인터스티셜이 페이지 로딩을 방해하는지 확인",
      ],
      funnel_rates: rates,
    });
  } else if (rate < 70) {
    diagnoses.push({
      stage: "랜딩 페이지 도달",
      diagnosis: `클릭→랜딩 ${rate.toFixed(0)}% — 개선 여지 있음`,
      severity: "warning",
      evidence: `${clicks}클릭 중 ${landingViews}명 도착 (${rate.toFixed(0)}%)`,
      actions: [
        "페이지 로딩 시간 3초 이내로 최적화",
        "이미지 압축 + 지연 로딩(Lazy Load) 적용",
      ],
      funnel_rates: rates,
    });
  }
}

/**
 * 상품 페이지 진단: 랜딩 → 상품조회 → 장바구니 담기
 * 사람들이 보고는 있는데 장바구니에 안 담으면 = 상품 매력도/가격 문제
 */
function diagnoseProductPage(rates, landingViews, contentViews, addToCart, diagnoses) {
  // 상품 조회 → 장바구니 전환율 (핵심 지표)
  if (contentViews > 0) {
    const viewToCartRate = rates.view_to_cart;
    if (viewToCartRate < 5) {
      diagnoses.push({
        stage: "상품 페이지 → 장바구니",
        diagnosis: `상품조회→장바구니 ${viewToCartRate.toFixed(1)}% — 상품에 관심은 있으나 담지 않음`,
        severity: viewToCartRate < 2 ? "critical" : "warning",
        evidence: `${contentViews}명 상품 조회 → ${addToCart}명 장바구니 (${viewToCartRate.toFixed(1)}%)`,
        actions: [
          "상품 상세 이미지 보강 (착용샷, 크기 비교, 디테일컷)",
          "고객 리뷰 상단 배치 (구매 확신 강화)",
          "가격 매력도 점검 (경쟁사 대비 가격, 할인 강조)",
          "명확한 CTA 버튼 (장바구니 담기 버튼 크기/위치 최적화)",
          viewToCartRate < 2 ? "광고 소재와 실제 상품 간 괴리 확인 (기대 불일치)" : null,
        ].filter(Boolean),
        funnel_rates: rates,
      });
    }
  }

  // 랜딩 → 상품조회 전환율
  if (landingViews > 0 && contentViews > 0) {
    const landToViewRate = rates.landing_to_view;
    if (landToViewRate < 30) {
      diagnoses.push({
        stage: "랜딩 → 상품 조회",
        diagnosis: `랜딩→상품조회 ${landToViewRate.toFixed(0)}% — 랜딩에서 상품까지 이동하지 않음`,
        severity: "warning",
        evidence: `${landingViews}명 랜딩 → ${contentViews}명 상품조회 (${landToViewRate.toFixed(0)}%)`,
        actions: [
          "랜딩 페이지에 상품 바로가기 링크/버튼 추가",
          "광고와 랜딩 페이지 내용 일치시키기 (광고 상품이 바로 보이도록)",
          "랜딩 페이지 네비게이션 단순화",
        ],
        funnel_rates: rates,
      });
    }
  }
}

/**
 * 장바구니 이탈 진단: 장바구니 담기 → 결제 시작
 * 담았는데 결제를 안 한다면 = 결제 프로세스/배송비/신뢰 문제
 */
function diagnoseCartAbandonment(rates, addToCart, initiateCheckout, diagnoses) {
  if (addToCart === 0) return;

  const rate = rates.cart_to_checkout;
  if (rate < 30) {
    diagnoses.push({
      stage: "장바구니 → 결제시도",
      diagnosis: `장바구니→결제 ${rate.toFixed(0)}% — 장바구니 이탈률 높음`,
      severity: rate < 15 ? "critical" : "warning",
      evidence: `${addToCart}명 장바구니 담기 → ${initiateCheckout}명 결제시도 (${rate.toFixed(0)}%)`,
      actions: [
        "배송비 정책 점검 (무료배송 기준 명시, 예상 배송비 조기 표시)",
        "장바구니 페이지에 보안 마크/결제 안전 표시 추가",
        "장바구니 이탈 리타게팅 광고 설정 (24시간 내 리마인드)",
        "게스트 체크아웃(비회원 결제) 지원 여부 확인",
        rate < 15 ? "장바구니 페이지 UX 전면 점검 (불필요한 단계 제거)" : null,
      ].filter(Boolean),
      funnel_rates: rates,
    });
  } else if (rate < 50) {
    diagnoses.push({
      stage: "장바구니 → 결제시도",
      diagnosis: `장바구니→결제 ${rate.toFixed(0)}% — 개선 여지 있음`,
      severity: "info",
      evidence: `${addToCart}명 → ${initiateCheckout}명 (${rate.toFixed(0)}%)`,
      actions: [
        "장바구니 리마인드 알림 (카카오톡/SMS) 활용",
        "한정 시간 할인 쿠폰으로 결제 유도",
      ],
      funnel_rates: rates,
    });
  }
}

/**
 * 결제 마찰 진단: 결제 시작 → 구매 완료
 * 결제를 시작했는데 완료하지 못하면 = 결제수단/시스템/가격 문제
 */
function diagnoseCheckoutFriction(rates, initiateCheckout, purchases, diagnoses) {
  if (initiateCheckout === 0) return;

  const rate = rates.checkout_to_purchase;
  if (rate < 40) {
    diagnoses.push({
      stage: "결제시도 → 구매완료",
      diagnosis: `결제→구매 ${rate.toFixed(0)}% — 결제 과정에서 이탈 발생`,
      severity: rate < 20 ? "critical" : "warning",
      evidence: `${initiateCheckout}명 결제시도 → ${purchases}명 구매완료 (${rate.toFixed(0)}%)`,
      actions: [
        "결제수단 다양화 (카카오페이, 네이버페이, 토스페이 등 간편결제)",
        "결제 페이지 오류/장애 모니터링 확인",
        "결제 단계 수 최소화 (3단계 이내)",
        rate < 20 ? "PG사(결제 대행) 안정성 점검 — 결제 실패 로그 확인" : null,
        "모바일 결제 UX 점검 (작은 버튼, 입력 필드 개선)",
      ].filter(Boolean),
      funnel_rates: rates,
    });
  }
}

// ─── 퍼널 전환율 계산 헬퍼 ───

/**
 * 각 퍼널 단계의 전환율을 계산
 * @returns {{ click_to_landing, landing_to_view, view_to_cart, cart_to_checkout, checkout_to_purchase }}
 */
function computeFunnelRates(clicks, landingViews, contentViews, addToCart, initiateCheckout, purchases) {
  return {
    click_to_landing: clicks > 0 ? (landingViews / clicks) * 100 : 0,
    landing_to_view: landingViews > 0 ? (contentViews / landingViews) * 100 : 0,
    view_to_cart: contentViews > 0 ? (addToCart / contentViews) * 100 : 0,
    cart_to_checkout: addToCart > 0 ? (initiateCheckout / addToCart) * 100 : 0,
    checkout_to_purchase: initiateCheckout > 0 ? (purchases / initiateCheckout) * 100 : 0,
    // 전체 퍼널 전환율
    click_to_purchase: clicks > 0 ? (purchases / clicks) * 100 : 0,
    click_to_cart: clicks > 0 ? (addToCart / clicks) * 100 : 0,
  };
}

// ─── 개별 지표 채점 함수 (기존 로직 분리) ───

function scoreRoas(roas, totalSpend, score, reasons, recommendations, benchmarks = null) {
  const sc = benchmarks?.roas?.sample_count || 0;
  // 동적 기준: 벤치마크 p90/p75/median/p25 → 하드코딩 3.0/2.0/1.0/0.5 대체
  const excellent = blendThreshold(3.0, benchmarks?.roas?.p90, sc);
  const good = blendThreshold(2.0, benchmarks?.roas?.p75, sc);
  const breakEven = blendThreshold(1.0, benchmarks?.roas?.median, sc);
  const danger = blendThreshold(0.5, benchmarks?.roas?.p25, sc);

  if (roas >= excellent) {
    score += 30;
    reasons.push(`ROAS ${roas.toFixed(2)}x — 우수 (기준: ${roundN(excellent)}x+)`);
    recommendations.push("예산 20~30% 증액 검토 (스케일링 단계)");
  } else if (roas >= good) {
    score += 20;
    reasons.push(`ROAS ${roas.toFixed(2)}x — 양호 (기준: ${roundN(good)}x+)`);
    recommendations.push("현행 유지 + 크리에이티브 테스트로 점진적 개선");
  } else if (roas >= breakEven) {
    score += 5;
    reasons.push(`ROAS ${roas.toFixed(2)}x — 손익분기 (기준: ${roundN(breakEven)}x+)`);
    recommendations.push("AOV 올리기 (묶음 상품, 업셀) 또는 CPA 낮추기 (타겟 최적화)");
  } else if (roas > 0 && roas < breakEven) {
    score -= 20;
    reasons.push(`ROAS ${roas.toFixed(2)}x — 적자 (광고비 > 매출)`);
    recommendations.push("크리에이티브 전면 교체 + 타겟 오디언스 재검토 필요");
  } else if (roas === 0 && totalSpend > 0) {
    score -= 30;
    reasons.push("ROAS 0x — 매출 없음 (전환 추적 확인 필요)");
    recommendations.push("Pixel 설치/이벤트 발화 확인, 전환이 0이면 즉시 정지 검토");
  }

  if (roas < danger && totalSpend > 50000) {
    score -= 15;
    reasons.push(`지출 ₩${Math.round(totalSpend).toLocaleString()} 대비 ROAS ${roas.toFixed(2)}x — 즉시 정지 권장`);
    recommendations.push("캠페인 일시정지 후 크리에이티브/타겟 전면 재설계");
  }

  return score;
}

function scoreCtr(ctr, score, reasons, recommendations, benchmarks = null) {
  const sc = benchmarks?.ctr?.sample_count || 0;
  const excellent = blendThreshold(3.0, benchmarks?.ctr?.p90, sc);
  const good = blendThreshold(1.5, benchmarks?.ctr?.p75, sc);
  const low = blendThreshold(1.0, benchmarks?.ctr?.p25, sc);

  if (ctr >= excellent) {
    score += 10;
    reasons.push(`CTR ${ctr.toFixed(2)}% — 우수 (기준: ${roundN(excellent)}%+)`);
  } else if (ctr >= good) {
    score += 5;
    reasons.push(`CTR ${ctr.toFixed(2)}% — 양호 (기준: ${roundN(good)}%+)`);
  } else if (ctr > 0 && ctr < low) {
    score -= 10;
    reasons.push(`CTR ${ctr.toFixed(2)}% — 낮음 (기준: ${roundN(low)}% 미만)`);
    recommendations.push("광고 크리에이티브 교체: 훅(Hook) 강화, 첫 3초 임팩트 개선");
  }
  return score;
}

function scoreCpc(cpc, score, reasons, recommendations, benchmarks = null) {
  const sc = benchmarks?.cpc?.sample_count || 0;
  // CPC는 낮을수록 좋으므로 p25가 '우수' 기준, p75가 '높음' 기준
  const excellent = blendThreshold(700, benchmarks?.cpc?.p25, sc);
  const high = blendThreshold(2000, benchmarks?.cpc?.p75, sc);

  if (cpc > 0 && cpc <= excellent) {
    score += 8;
    reasons.push(`CPC ₩${Math.round(cpc).toLocaleString()} — 우수 (기준: ₩${Math.round(excellent).toLocaleString()} 이하)`);
  } else if (cpc > high) {
    score -= 8;
    reasons.push(`CPC ₩${Math.round(cpc).toLocaleString()} — 높음 (기준: ₩${Math.round(high).toLocaleString()} 초과)`);
    recommendations.push("광고 관련성 점수 개선 또는 타겟 확대로 CPC 낮추기");
  }
  return score;
}

function scoreFrequency(frequency, score, reasons, recommendations, benchmarks = null) {
  const sc = benchmarks?.frequency?.sample_count || 0;
  // Frequency는 낮을수록 좋으므로 p75가 '위험' 기준, median이 '양호' 기준
  const fatigueThreshold = blendThreshold(3.0, benchmarks?.frequency?.p75, sc);
  const optimalThreshold = blendThreshold(2.0, benchmarks?.frequency?.median, sc);

  if (frequency > fatigueThreshold) {
    score -= 10;
    reasons.push(`Frequency ${frequency.toFixed(1)} — Ad Fatigue 위험 (기준: ${roundN(fatigueThreshold)}+)`);
    recommendations.push("크리에이티브 교체 또는 오디언스 확장 필요 (같은 유저에게 너무 자주 노출)");
  } else if (frequency <= optimalThreshold) {
    score += 5;
    reasons.push(`Frequency ${frequency.toFixed(1)} — 최적 (기준: ${roundN(optimalThreshold)} 이하)`);
  }
  return score;
}

function scoreCpa(cpa, score, reasons, recommendations, benchmarks = null) {
  const sc = benchmarks?.cpa?.sample_count || 0;
  // CPA는 낮을수록 좋으므로 p25가 '우수' 기준, p75가 '높음' 기준
  const excellent = blendThreshold(15000, benchmarks?.cpa?.p25, sc);
  const high = blendThreshold(40000, benchmarks?.cpa?.p75, sc);

  if (cpa > 0 && cpa <= excellent) {
    score += 8;
    reasons.push(`CPA ₩${Math.round(cpa).toLocaleString()} — 우수 (기준: ₩${Math.round(excellent).toLocaleString()} 이하)`);
  } else if (cpa > high) {
    score -= 10;
    reasons.push(`CPA ₩${Math.round(cpa).toLocaleString()} — 높음 (기준: ₩${Math.round(high).toLocaleString()} 초과)`);
    recommendations.push("전환 최적화 타겟으로 변경 또는 랜딩 페이지 개선");
  }
  return score;
}

function scoreNoPurchase(purchaseCount, totalSpend, score, reasons, recommendations) {
  if (purchaseCount === 0 && totalSpend > 50000) {
    score -= 15;
    if (!reasons.some((r) => r.includes("매출 없음"))) {
      reasons.push(`지출 ₩${Math.round(totalSpend).toLocaleString()}인데 구매 0건`);
    }
    recommendations.push("즉시 정지 후 Pixel 이벤트 및 제품 페이지 점검");
  }
  return score;
}

// ─── 최종 판정 결정 ───

function getVerdict(score, roas) {
  if (roas >= 3) return { verdict: "SCALE", severity: "excellent" };
  if (roas < 0.5 && roas > 0) return { verdict: "PAUSE", severity: "critical" };
  if (roas === 0) return { verdict: "PAUSE", severity: "critical" };

  if (score >= 70) return { verdict: "MAINTAIN", severity: "good" };
  if (score >= 50) return { verdict: "MODIFY", severity: "warning" };
  if (score >= 30) return { verdict: "MODIFY", severity: "urgent" };
  return { verdict: "PAUSE", severity: "critical" };
}

// ─── 일괄 판정 + 전체 요약 ───

/**
 * 여러 캠페인 일괄 판정 + 전체 요약 + 퍼널 진단
 * @param {object[]} campaigns
 * @param {string} period — 벤치마크 기간 ("1d"|"7d"|"15d"|"30d")
 * @returns {{ judgments: object[], summary: object }}
 */
export function judgeAllCampaigns(campaigns, period = "30d") {
  // ─── 동적 벤치마크 로드 (선택된 기간 기준) ───
  let benchmarkData = null;
  try {
    benchmarkData = getBenchmarks(period);
    if (Object.keys(benchmarkData.metrics).length === 0) benchmarkData = null;
  } catch { /* 벤치마크 데이터 아직 없으면 건너뛰기 */ }

  // 벤치마크 메트릭을 판정 함수에 전달하여 동적 기준 적용
  const bm = benchmarkData?.metrics || null;

  const judgments = campaigns.map((c) => {
    const judgment = {
      campaign_id: c.id || c.meta_campaign_id,
      campaign_name: c.name,
      ...judgeCampaign(c, bm),
      metrics: {
        roas: c.roas || 0,
        ctr: c.ctr || 0,
        cpc: c.cpc || 0,
        frequency: c.frequency || 0,
        spend: c.total_spend || 0,
        revenue: c.revenue || 0,
        purchases: c.purchase_count || 0,
        cpa: c.cpa || 0,
        aov: c.aov || 0,
      },
      funnel: {
        clicks: c.clicks || 0,
        landing_page_views: c.landing_page_views || 0,
        content_views: c.content_views || 0,
        add_to_cart: c.add_to_cart_count || 0,
        initiate_checkout: c.initiate_checkout_count || 0,
        purchases: c.purchase_count || 0,
      },
    };

    // ─── 벤치마크 대비 위치 추가 (동적 벤치마크) ───
    if (benchmarkData) {
      judgment.benchmark_comparison = computeBenchmarkComparison(c, benchmarkData);
    }

    // ─── 학습 기반 스마트 추천 추가 ───
    try {
      if (c.id) {
        const smartRecs = getSmartRecommendations(c.id);
        if (smartRecs.length > 0 && smartRecs[0].type !== "info") {
          judgment.smart_recommendations = smartRecs;
        }
      }
    } catch { /* 학습 데이터 부족 시 건너뛰기 */ }

    return judgment;
  });

  // 전체 요약 통계 — 수익성은 biz-metrics.js SSOT 사용
  const profitItems = judgments.map((j) => ({
    revenue: j.metrics.revenue,
    adSpend: j.metrics.spend,
    cogs: j.profitability?.cogs || 0,
    isProfitable: j.profitability?.net_profit > 0,
  }));
  const profitSummary = calcProfitabilitySummary(profitItems);

  const totalSpend = profitSummary.totalAdSpend;
  const totalRevenue = profitSummary.totalRevenue;
  const totalPurchases = campaigns.reduce((s, c) => s + (c.purchase_count || 0), 0);
  const overallRoas = totalSpend > 0 ? roundN(totalRevenue / totalSpend, 2) : 0;

  // 전체 퍼널 집계
  const totalClicks = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const totalLandingViews = campaigns.reduce((s, c) => s + (c.landing_page_views || 0), 0);
  const totalContentViews = campaigns.reduce((s, c) => s + (c.content_views || 0), 0);
  const totalAddToCart = campaigns.reduce((s, c) => s + (c.add_to_cart_count || 0), 0);
  const totalCheckout = campaigns.reduce((s, c) => s + (c.initiate_checkout_count || 0), 0);

  const verdictCounts = { SCALE: 0, MAINTAIN: 0, MODIFY: 0, PAUSE: 0 };
  for (const j of judgments) {
    verdictCounts[j.verdict] = (verdictCounts[j.verdict] || 0) + 1;
  }

  // 퍼널 병목 요약 (모든 캠페인의 진단 결과 중 critical/warning 집계)
  const bottleneckCounts = {};
  for (const j of judgments) {
    for (const diag of j.funnel_diagnosis || []) {
      if (diag.severity === "critical" || diag.severity === "warning") {
        const stage = diag.stage;
        bottleneckCounts[stage] = (bottleneckCounts[stage] || 0) + 1;
      }
    }
  }

  const summary = {
    total_campaigns: campaigns.length,
    total_spend: totalSpend,
    total_revenue: totalRevenue,
    total_purchases: totalPurchases,
    overall_roas: overallRoas,
    total_cogs: profitSummary.totalCogs,
    total_net_profit: profitSummary.totalNetProfit,
    profit_loss: profitSummary.totalNetProfit,
    is_profitable: profitSummary.isProfitable,
    profitable_count: profitSummary.profitableCount,
    avg_cpa: totalPurchases > 0 ? Math.round(totalSpend / totalPurchases) : 0,
    avg_aov: totalPurchases > 0 ? Math.round(totalRevenue / totalPurchases) : 0,
    verdict_distribution: verdictCounts,
    // 전체 퍼널 요약
    overall_funnel: {
      clicks: totalClicks,
      landing_page_views: totalLandingViews,
      content_views: totalContentViews,
      add_to_cart: totalAddToCart,
      initiate_checkout: totalCheckout,
      purchases: totalPurchases,
      rates: computeFunnelRates(totalClicks, totalLandingViews, totalContentViews,
        totalAddToCart, totalCheckout, totalPurchases),
    },
    // 가장 빈번한 병목 지점
    top_bottlenecks: Object.entries(bottleneckCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([stage, count]) => ({ stage, campaigns_affected: count })),
    top_performer: judgments.reduce((best, j) => (j.metrics.roas > (best?.metrics?.roas || 0) ? j : best), null),
    worst_performer: judgments.reduce((worst, j) => {
      if (j.metrics.spend > 0 && (worst === null || j.metrics.roas < worst.metrics.roas)) return j;
      return worst;
    }, null),
    // ─── 동적 벤치마크 요약 ───
    has_benchmarks: !!benchmarkData,
    benchmark_period: benchmarkData ? benchmarkData.period : null,
    benchmark_summary: benchmarkData ? formatBenchmarkSummary(benchmarkData) : null,
  };

  return { judgments, summary };
}

// ─── 동적 벤치마크 대비 캠페인 위치 계산 ───

/**
 * 각 광고 지표가 우리 전체 데이터 대비 어느 위치에 있는지 계산
 * @param {object} campaign
 * @param {object} benchmarkData - getBenchmarks() 반환값
 * @returns {object} 메트릭별 { value, avg, median, position, vs_avg_pct }
 */
function computeBenchmarkComparison(campaign, benchmarkData) {
  const metrics = benchmarkData.metrics;
  const comparison = {};

  const metricFields = {
    roas: campaign.roas || 0,
    ctr: campaign.ctr || 0,
    cpc: campaign.cpc || 0,
    frequency: campaign.frequency || 0,
    cpa: campaign.cpa || 0,
    aov: campaign.aov || 0,
  };

  for (const [name, value] of Object.entries(metricFields)) {
    const bench = metrics[name];
    if (!bench || bench.sample_count === 0) continue;

    let position;
    if (value >= bench.p90) position = "상위 10% (우수)";
    else if (value >= bench.p75) position = "상위 25% (양호)";
    else if (value >= bench.median) position = "평균 이상";
    else if (value >= bench.p25) position = "평균 이하";
    else position = "하위 25% (개선 필요)";

    // CPC, CPA, frequency는 낮을수록 좋으므로 position 반전
    if (["cpc", "cpa", "frequency"].includes(name)) {
      if (value <= bench.p25) position = "상위 25% (우수 — 낮을수록 좋음)";
      else if (value <= bench.median) position = "평균 이상 (중앙값 이하)";
      else if (value <= bench.p75) position = "평균 이하 (중앙값 이상)";
      else position = "하위 25% (개선 필요 — 높음)";
    }

    comparison[name] = {
      value: roundN(value),
      avg: roundN(bench.avg),
      median: roundN(bench.median),
      p75: roundN(bench.p75),
      position,
      vs_avg_pct: bench.avg > 0 ? Math.round(((value - bench.avg) / bench.avg) * 100) : 0,
    };
  }

  return comparison;
}

/**
 * 벤치마크 요약 — 전체 캠페인의 핵심 기준값
 */
function formatBenchmarkSummary(benchmarkData) {
  const m = benchmarkData.metrics;
  const fmt = (metric, suffix = "") => {
    const b = m[metric];
    if (!b) return null;
    return {
      avg: roundN(b.avg),
      median: roundN(b.median),
      p75: roundN(b.p75),
      p90: roundN(b.p90),
      sample_count: b.sample_count,
      suffix,
    };
  };

  return {
    roas: fmt("roas", "x"),
    ctr: fmt("ctr", "%"),
    cpc: fmt("cpc", "₩"),
    frequency: fmt("frequency", "회"),
    cpa: fmt("cpa", "₩"),
    aov: fmt("aov", "₩"),
  };
}

// round2 삭제됨 — biz-metrics.js의 roundN() 사용

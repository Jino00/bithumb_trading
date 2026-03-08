// 비즈니스 지표 계산 — 수익성, 반올림 등 모든 재무 계산의 단일 출처 (SSOT)
// ⚠️ 재무 계산이 필요하면 반드시 이 파일의 함수를 사용한다. 다른 파일에 직접 공식 작성 금지.

/**
 * 소수점 n자리 반올림 (기본 2자리)
 * @param {number} value
 * @param {number} [decimals=2]
 * @returns {number}
 */
export function roundN(value, decimals = 2) {
  if (value == null || isNaN(value) || !isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * 단일 캠페인 수익성 계산
 * @param {{ costPrice: number, purchases: number, revenue: number, adSpend: number, aov: number }} input
 * @returns {{ cogs: number, grossProfit: number, netProfit: number, grossMargin: number, netMargin: number, trueRoi: number, breakEvenRoas: number, isProfitable: boolean }}
 */
export function calcCampaignProfitability({ costPrice = 0, purchases = 0, revenue = 0, adSpend = 0, aov = 0 } = {}) {
  // 원가 데이터가 없으면 빈 결과
  if (!costPrice || costPrice <= 0) {
    return {
      cogs: 0,
      grossProfit: 0,
      netProfit: 0,
      grossMargin: 0,
      netMargin: 0,
      trueRoi: 0,
      breakEvenRoas: 0,
      isProfitable: false,
      hasCostData: false,
    };
  }

  const cogs = costPrice * purchases;
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - adSpend; // 매출 - 원가 - 광고비
  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
  const trueRoi = adSpend > 0 ? (netProfit / adSpend) * 100 : 0;
  const breakEvenRoas = aov > 0 && costPrice > 0 ? aov / (aov - costPrice) : 0;

  return {
    cogs,
    grossProfit,
    netProfit: Math.round(netProfit),
    grossMargin: roundN(grossMargin, 1),
    netMargin: roundN(netMargin, 1),
    trueRoi: roundN(trueRoi, 1),
    breakEvenRoas: roundN(breakEvenRoas, 2),
    isProfitable: netProfit > 0,
    hasCostData: true,
  };
}

/**
 * 복수 캠페인 수익성 집계
 * @param {Array<{ revenue?: number, adSpend?: number, cogs?: number, netProfit?: number, isProfitable?: boolean, hasCostData?: boolean }>} items
 *   — calcCampaignProfitability 결과 + 원본 campaign 데이터
 * @returns {{ totalRevenue: number, totalCogs: number, totalAdSpend: number, totalNetProfit: number, overallTrueRoi: number, overallNetMargin: number, profitableCount: number, totalCampaigns: number, isProfitable: boolean }}
 */
export function calcProfitabilitySummary(items) {
  if (!items || items.length === 0) {
    return {
      totalRevenue: 0,
      totalCogs: 0,
      totalAdSpend: 0,
      totalNetProfit: 0,
      overallTrueRoi: 0,
      overallNetMargin: 0,
      profitableCount: 0,
      totalCampaigns: 0,
      isProfitable: false,
    };
  }

  const totalRevenue = items.reduce((s, i) => s + (i.revenue || 0), 0);
  const totalCogs = items.reduce((s, i) => s + (i.cogs || 0), 0);
  const totalAdSpend = items.reduce((s, i) => s + (i.adSpend || 0), 0);
  const totalNetProfit = totalRevenue - totalCogs - totalAdSpend;
  const overallTrueRoi = totalAdSpend > 0 ? (totalNetProfit / totalAdSpend) * 100 : 0;
  const overallNetMargin = totalRevenue > 0 ? (totalNetProfit / totalRevenue) * 100 : 0;
  const profitableCount = items.filter((i) => i.isProfitable).length;

  return {
    totalRevenue,
    totalCogs,
    totalAdSpend,
    totalNetProfit: Math.round(totalNetProfit),
    overallTrueRoi: roundN(overallTrueRoi, 1),
    overallNetMargin: roundN(overallNetMargin, 1),
    profitableCount,
    totalCampaigns: items.length,
    isProfitable: totalNetProfit >= 0,
  };
}

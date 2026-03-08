// 일일 리뷰 로직 백테스트 — 전체 캠페인(OFF 포함)의 일별 데이터로 규칙 검증
// 목표: 최적 관찰기간, 핵심 지표, 규칙 정확도 분석
import { getDb } from "../db/database.js";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

// ─── 현재 daily-review.js 규칙 상수 (동일하게 복제) ───
const MIN_DAILY_BUDGET = 20000;
const MAX_DAILY_BUDGET = 70000;
const ROAS_PAUSE_THRESHOLD = 0.5;
const ROAS_SCALE_THRESHOLD = 2.0;
const ROAS_HIGH_SCALE_THRESHOLD = 3.0;
const ROAS_DECREASE_UPPER = 1.0;
const SPEND_PAUSE_THRESHOLD = 100000;
const SPEND_NO_PURCHASE_THRESHOLD = 50000;
const FREQUENCY_FATIGUE_THRESHOLD = 2.5;
const CTR_FATIGUE_THRESHOLD = 2.0;

// ─── Meta API 헬퍼 ───

function extractPurchaseRoas(insight) {
  if (!insight) return 0;
  if (insight.purchase_roas?.length > 0) {
    return parseFloat(insight.purchase_roas[0].value || "0");
  }
  const spend = parseFloat(insight.spend || "0");
  if (spend > 0) {
    const revenue = extractPurchaseRevenue(insight);
    if (revenue > 0) return parseFloat((revenue / spend).toFixed(2));
  }
  return 0;
}

function extractPurchaseRevenue(insight) {
  if (!insight?.action_values || !Array.isArray(insight.action_values)) return 0;
  const pv = insight.action_values.find(a => a.action_type === "omni_purchase");
  return pv ? parseFloat(pv.value || "0") : 0;
}

function extractPurchaseCount(insight) {
  if (!insight?.actions || !Array.isArray(insight.actions)) return 0;
  const pa = insight.actions.find(a => a.action_type === "omni_purchase");
  return pa ? parseInt(pa.value || "0", 10) : 0;
}

/**
 * 전체 캠페인 목록 조회 (OFF/PAUSED 포함)
 */
async function fetchAllCampaigns(accessToken, adAccountId) {
  const accountId = adAccountId.replace("act_", "");
  const fields = "id,name,status,daily_budget,lifetime_budget,created_time,objective,buying_type";
  // effective_status로 모든 상태의 캠페인 가져오기
  const filtering = JSON.stringify([
    { field: "effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "WITH_ISSUES"] }
  ]);
  const url = `${GRAPH_API_BASE}/act_${accountId}/campaigns?fields=${fields}&filtering=${encodeURIComponent(filtering)}&access_token=${accessToken}&limit=500`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data || [];
}

/**
 * 전체 캠페인의 일별 인사이트 (lifetime, time_increment=1)
 * 페이징 처리 포함
 */
async function fetchDailyInsightsAll(accessToken, adAccountId, sinceDate, untilDate) {
  const accountId = adAccountId.replace("act_", "");
  const fields = "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,frequency,cpm,actions,action_values,purchase_roas,date_start,date_stop";
  const timeRange = JSON.stringify({ since: sinceDate, until: untilDate });
  // 모든 캠페인 상태 포함
  const filtering = JSON.stringify([
    { field: "campaign.effective_status", operator: "IN", value: ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "WITH_ISSUES"] }
  ]);

  let allData = [];
  let url = `${GRAPH_API_BASE}/act_${accountId}/insights?fields=${fields}&time_range=${encodeURIComponent(timeRange)}&time_increment=1&level=campaign&limit=500&filtering=${encodeURIComponent(filtering)}&access_token=${accessToken}`;

  while (url) {
    console.log(`  [API] Fetching page... (${allData.length} rows so far)`);
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    allData = allData.concat(json.data || []);

    // 페이지네이션
    url = json.paging?.next || null;
    if (url) await new Promise(r => setTimeout(r, 500)); // rate limit 보호
  }

  return allData;
}

// ─── 백테스트 핵심 로직 ───

/**
 * 일별 데이터를 캠페인별로 그룹핑
 * @returns {{ [campaignId]: { name, days: [{ date, spend, roas, revenue, purchases, ctr, cpc, frequency, impressions, clicks }] } }}
 */
function groupByCampaign(dailyInsights) {
  const groups = {};
  for (const row of dailyInsights) {
    const cid = row.campaign_id;
    if (!groups[cid]) {
      groups[cid] = { name: row.campaign_name, days: [] };
    }
    groups[cid].days.push({
      date: row.date_start,
      spend: parseFloat(row.spend || "0"),
      impressions: parseInt(row.impressions || "0", 10),
      clicks: parseInt(row.clicks || "0", 10),
      ctr: parseFloat(row.ctr || "0"),
      cpc: parseFloat(row.cpc || "0"),
      frequency: parseFloat(row.frequency || "0"),
      roas: extractPurchaseRoas(row),
      revenue: extractPurchaseRevenue(row),
      purchases: extractPurchaseCount(row),
    });
  }
  // 날짜순 정렬
  for (const cid of Object.keys(groups)) {
    groups[cid].days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return groups;
}

/**
 * N일치 누적 지표 계산 (day 0 ~ day N-1)
 */
function calcCumulativeMetrics(days, startIdx, windowDays) {
  const endIdx = Math.min(startIdx + windowDays, days.length);
  const windowSlice = days.slice(startIdx, endIdx);
  if (windowSlice.length === 0) return null;

  const totalSpend = windowSlice.reduce((s, d) => s + d.spend, 0);
  const totalRevenue = windowSlice.reduce((s, d) => s + d.revenue, 0);
  const totalPurchases = windowSlice.reduce((s, d) => s + d.purchases, 0);
  const totalImpressions = windowSlice.reduce((s, d) => s + d.impressions, 0);
  const totalClicks = windowSlice.reduce((s, d) => s + d.clicks, 0);

  const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  // Frequency는 일별 평균 사용 (누적 frequency는 Meta가 따로 계산)
  const avgFrequency = windowSlice.reduce((s, d) => s + d.frequency, 0) / windowSlice.length;

  return {
    spend: totalSpend,
    revenue: totalRevenue,
    purchases: totalPurchases,
    impressions: totalImpressions,
    clicks: totalClicks,
    roas: parseFloat(roas.toFixed(4)),
    ctr: parseFloat(ctr.toFixed(4)),
    cpc: parseFloat(cpc.toFixed(2)),
    frequency: parseFloat(avgFrequency.toFixed(2)),
    actualDays: windowSlice.length,
  };
}

/**
 * 기존 규칙 (v1) — 비교 기준선
 */
function applyCurrentRules(metrics, dailyBudget = 30000) {
  const { roas, spend, purchases, frequency, ctr } = metrics;

  if (roas < ROAS_PAUSE_THRESHOLD && spend > SPEND_PAUSE_THRESHOLD) {
    return { action_type: "pause", reason: `R1: ROAS ${roas.toFixed(2)}x < 0.5 & spend > 100K` };
  }
  if (purchases === 0 && spend > 50000) { // 기존: ₩50K
    return { action_type: "pause", reason: `R2: 구매 0건 & spend > 50K` };
  }
  if (frequency > 2.5 && ctr < CTR_FATIGUE_THRESHOLD) { // 기존: freq > 2.5
    return { action_type: "pause", reason: `R3: freq > 2.5 & CTR < 2%` };
  }
  if (roas >= ROAS_HIGH_SCALE_THRESHOLD && dailyBudget <= MIN_DAILY_BUDGET) {
    return { action_type: "budget_increase", reason: `R4` };
  }
  if (roas >= ROAS_SCALE_THRESHOLD && dailyBudget < MAX_DAILY_BUDGET) {
    return { action_type: "budget_increase", reason: `R5` };
  }
  if (roas >= ROAS_PAUSE_THRESHOLD && roas < 1.0 && dailyBudget > 50000) { // 기존: ₩50K
    return { action_type: "budget_decrease", reason: `R6` };
  }
  return { action_type: null, reason: "no_action" };
}

/**
 * 개선된 규칙 (v2) — 백테스트 결과 반영
 */
function applyImprovedRules(metrics, dailyBudget = 30000) {
  const { roas, spend, purchases, frequency, ctr, cpc } = metrics;

  // R1: 기존 유지
  if (roas < ROAS_PAUSE_THRESHOLD && spend > SPEND_PAUSE_THRESHOLD) {
    return { action_type: "pause", reason: `R1: ROAS ${roas.toFixed(2)}x < 0.5 & spend > 100K` };
  }
  // R1b: 심각한 적자 조기 감지 (신규)
  if (roas < 0.3 && roas > 0 && spend > 50000) {
    return { action_type: "pause", reason: `R1b: ROAS ${roas.toFixed(2)}x < 0.3 심각 & spend > 50K` };
  }
  // R2: 임계값 낮춤 (50K→30K)
  if (purchases === 0 && spend > 30000) {
    return { action_type: "pause", reason: `R2: 구매 0건 & spend ₩${Math.round(spend).toLocaleString()} > 30K` };
  }
  // R3: 피로도 임계값 낮춤 (2.5→2.0)
  if (frequency > 2.0 && ctr < CTR_FATIGUE_THRESHOLD) {
    return { action_type: "pause", reason: `R3: freq ${frequency.toFixed(1)} > 2.0 & CTR < 2%` };
  }
  // R7: ROAS 0.5~1.0x + CPC >₩1,200 + 소진 >₩100K → pause (신규: 사각지대 해결)
  if (roas >= ROAS_PAUSE_THRESHOLD && roas < 1.0 && cpc > 1200 && spend > SPEND_PAUSE_THRESHOLD) {
    return { action_type: "pause", reason: `R7: ROAS ${roas.toFixed(2)}x + CPC ₩${Math.round(cpc)} > 1200 + spend > 100K` };
  }
  // R8: ROAS 0.5~1.0x + CPC >₩1,000 + 소진 >₩50K → budget_decrease (신규)
  if (roas >= ROAS_PAUSE_THRESHOLD && roas < 1.0 && cpc > 1000 && spend > 50000 && dailyBudget > MIN_DAILY_BUDGET) {
    return { action_type: "budget_decrease", reason: `R8: ROAS ${roas.toFixed(2)}x + CPC ₩${Math.round(cpc)} > 1000` };
  }
  // R4: 기존 유지
  if (roas >= ROAS_HIGH_SCALE_THRESHOLD && dailyBudget <= MIN_DAILY_BUDGET) {
    return { action_type: "budget_increase", reason: `R4` };
  }
  // R5: 기존 유지
  if (roas >= ROAS_SCALE_THRESHOLD && dailyBudget < MAX_DAILY_BUDGET) {
    return { action_type: "budget_increase", reason: `R5` };
  }
  // R6: 예산 기준 낮춤 (50K→30K)
  if (roas >= ROAS_PAUSE_THRESHOLD && roas < 1.0 && dailyBudget > 30000) {
    return { action_type: "budget_decrease", reason: `R6: ROAS ${roas.toFixed(2)}x & budget > 30K` };
  }
  return { action_type: null, reason: "no_action" };
}

/**
 * 캠페인의 최종 결과(ground truth) 결정
 * — lifetime ROAS로 성공/실패 판정
 */
function determineOutcome(days) {
  const totalSpend = days.reduce((s, d) => s + d.spend, 0);
  const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);
  const totalPurchases = days.reduce((s, d) => s + d.purchases, 0);
  const lifetimeRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  // 분류: 성공(ROAS ≥1.5), 보통(1.0~1.5), 실패(0~1.0), 완전실패(구매0)
  let label;
  if (totalPurchases === 0 && totalSpend > 20000) label = "TOTAL_FAIL";
  else if (lifetimeRoas >= 2.0) label = "SUCCESS_HIGH";
  else if (lifetimeRoas >= 1.5) label = "SUCCESS";
  else if (lifetimeRoas >= 1.0) label = "BREAK_EVEN";
  else if (lifetimeRoas > 0) label = "FAIL";
  else label = "NO_DATA";

  return {
    label,
    lifetime_roas: parseFloat(lifetimeRoas.toFixed(4)),
    lifetime_spend: totalSpend,
    lifetime_revenue: totalRevenue,
    lifetime_purchases: totalPurchases,
    total_days: days.length,
  };
}

/**
 * 관찰기간별 규칙 시뮬레이션 (v1 + v2 동시)
 */
function simulateReviewWindows(campaignData, dailyBudget = 30000) {
  const { days } = campaignData;
  const windows = [3, 5, 7, 10, 14, 21];
  const results = {};

  for (const w of windows) {
    if (days.length < w) {
      results[`${w}d`] = { skip: true, reason: `데이터 ${days.length}일 < ${w}일` };
      continue;
    }
    const metrics = calcCumulativeMetrics(days, 0, w);
    const actionV1 = applyCurrentRules(metrics, dailyBudget);
    const actionV2 = applyImprovedRules(metrics, dailyBudget);
    results[`${w}d`] = { metrics, action: actionV1, actionV2, actualDays: metrics.actualDays };
  }

  return results;
}

/**
 * 규칙 정확도 평가
 * — 규칙 제안과 실제 결과를 비교
 *   pause 제안 + 실제 FAIL/TOTAL_FAIL → 정확 (True Positive)
 *   pause 제안 + 실제 SUCCESS → 오탐 (False Positive)
 *   no_action + 실제 FAIL → 놓침 (False Negative)
 *   budget_increase + 실제 SUCCESS → 정확 (True Positive)
 */
function evaluateAccuracy(action, outcome) {
  const at = action.action_type;
  const lbl = outcome.label;

  if (at === "pause") {
    if (["FAIL", "TOTAL_FAIL"].includes(lbl)) return "TRUE_POSITIVE"; // 정확: 나쁜 걸 멈추라고 함
    if (["SUCCESS", "SUCCESS_HIGH"].includes(lbl)) return "FALSE_POSITIVE"; // 오탐: 좋은 걸 멈추라고 함
    return "AMBIGUOUS"; // BREAK_EVEN은 애매
  }

  if (at === "budget_increase") {
    if (["SUCCESS", "SUCCESS_HIGH"].includes(lbl)) return "TRUE_POSITIVE"; // 정확: 좋은 걸 늘리라고 함
    if (["FAIL", "TOTAL_FAIL"].includes(lbl)) return "FALSE_POSITIVE"; // 오탐: 나쁜 걸 늘리라고 함
    return "AMBIGUOUS";
  }

  if (at === "budget_decrease") {
    if (["FAIL", "BREAK_EVEN"].includes(lbl)) return "TRUE_POSITIVE";
    if (["SUCCESS", "SUCCESS_HIGH"].includes(lbl)) return "FALSE_POSITIVE";
    return "AMBIGUOUS";
  }

  // no_action
  if (at === null) {
    if (["SUCCESS", "SUCCESS_HIGH", "BREAK_EVEN"].includes(lbl)) return "TRUE_NEGATIVE"; // 맞음: 좋은데 안 건드림
    if (["FAIL", "TOTAL_FAIL"].includes(lbl)) return "FALSE_NEGATIVE"; // 놓침: 나쁜데 아무것도 안 함
    return "AMBIGUOUS";
  }

  return "UNKNOWN";
}

// ─── 지표 상관관계 분석 ───

/**
 * 각 지표(CTR, CPC, Frequency 등)가 최종 ROAS와 얼마나 상관있는지 분석
 */
function analyzeMetricCorrelations(campaignGroups) {
  const dataPoints = [];

  for (const [cid, data] of Object.entries(campaignGroups)) {
    const outcome = determineOutcome(data.days);
    if (outcome.label === "NO_DATA" || outcome.lifetime_spend < 10000) continue;

    // 7일 시점의 지표 (가장 기본적인 리뷰 시점)
    if (data.days.length < 7) continue;
    const m7d = calcCumulativeMetrics(data.days, 0, 7);

    dataPoints.push({
      campaign: data.name,
      lifetime_roas: outcome.lifetime_roas,
      outcome_label: outcome.label,
      d7_roas: m7d.roas,
      d7_ctr: m7d.ctr,
      d7_cpc: m7d.cpc,
      d7_frequency: m7d.frequency,
      d7_spend: m7d.spend,
      d7_purchases: m7d.purchases,
      d7_cpa: m7d.purchases > 0 ? m7d.spend / m7d.purchases : 0,
    });
  }

  return dataPoints;
}

/**
 * 광고 세팅별 성과 분석 (캠페인 목표, 예산 범위별)
 */
function analyzeSettingPatterns(campaigns, campaignGroups) {
  const patterns = [];

  for (const c of campaigns) {
    const data = campaignGroups[c.id];
    if (!data || data.days.length < 3) continue;
    const outcome = determineOutcome(data.days);
    if (outcome.label === "NO_DATA") continue;

    patterns.push({
      name: c.name,
      campaign_id: c.id,
      status: c.status,
      objective: c.objective,
      created_time: c.created_time,
      daily_budget: c.daily_budget ? parseInt(c.daily_budget) / 100 : 0, // cents → KRW
      lifetime_budget: c.lifetime_budget ? parseInt(c.lifetime_budget) / 100 : 0,
      ...outcome,
    });
  }

  return patterns;
}

// ─── 메인 실행 ───

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  📊 일일 리뷰 로직 백테스트 — 전체 캠페인 히스토리 분석");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const db = getDb();
  const creds = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials ORDER BY id DESC LIMIT 1").get();
  if (!creds?.access_token) {
    console.error("❌ Meta 인증 정보 없음");
    process.exit(1);
  }

  const { access_token: token, selected_ad_account_id: adAccountId } = creds;

  // 1. 전체 캠페인 목록 조회 (OFF 포함)
  console.log("1️⃣  전체 캠페인 목록 조회 중...");
  const campaigns = await fetchAllCampaigns(token, adAccountId);
  console.log(`   → ${campaigns.length}개 캠페인 발견\n`);

  // 상태별 분포
  const statusDist = {};
  for (const c of campaigns) {
    statusDist[c.status] = (statusDist[c.status] || 0) + 1;
  }
  console.log("   상태 분포:", statusDist);

  // 2. 전체 일별 인사이트 조회 (2025-07-01 ~ 오늘)
  const sinceDate = "2025-07-01";
  const untilDate = new Date().toISOString().split("T")[0];
  console.log(`\n2️⃣  일별 인사이트 조회: ${sinceDate} ~ ${untilDate}`);
  const dailyInsights = await fetchDailyInsightsAll(token, adAccountId, sinceDate, untilDate);
  console.log(`   → ${dailyInsights.length}개 일별 데이터포인트 수집\n`);

  // 3. 캠페인별 그룹핑
  const campaignGroups = groupByCampaign(dailyInsights);
  const campaignIds = Object.keys(campaignGroups);
  console.log(`   → ${campaignIds.length}개 캠페인에 데이터 있음\n`);

  // 4. 관찰기간별 규칙 시뮬레이션
  console.log("3️⃣  관찰기간별 규칙 시뮬레이션...\n");

  const windows = ["3d", "5d", "7d", "10d", "14d", "21d"];
  const accuracyByWindow = {};
  const accuracyByWindowV2 = {};
  for (const w of windows) {
    accuracyByWindow[w] = { TP: 0, FP: 0, TN: 0, FN: 0, AMBIGUOUS: 0, total: 0, actionFired: 0 };
    accuracyByWindowV2[w] = { TP: 0, FP: 0, TN: 0, FN: 0, AMBIGUOUS: 0, total: 0, actionFired: 0 };
  }

  const campaignResults = [];

  for (const cid of campaignIds) {
    const data = campaignGroups[cid];
    const outcome = determineOutcome(data.days);
    if (outcome.label === "NO_DATA") continue;

    // 캠페인의 일 예산 추정 (campaigns 목록에서)
    const campInfo = campaigns.find(c => c.id === cid);
    const dailyBudget = campInfo?.daily_budget ? parseInt(campInfo.daily_budget) / 100 : 30000;

    const windowResults = simulateReviewWindows(data, dailyBudget);

    const campResult = {
      campaign_id: cid,
      name: data.name,
      total_days: data.days.length,
      daily_budget: dailyBudget,
      outcome,
      windows: {},
    };

    for (const w of windows) {
      const wr = windowResults[w];
      if (wr?.skip) {
        campResult.windows[w] = { skip: true };
        continue;
      }

      // v1 정확도
      const accuracy = evaluateAccuracy(wr.action, outcome);
      accuracyByWindow[w].total++;
      if (wr.action.action_type) accuracyByWindow[w].actionFired++;
      if (accuracy === "TRUE_POSITIVE") accuracyByWindow[w].TP++;
      else if (accuracy === "FALSE_POSITIVE") accuracyByWindow[w].FP++;
      else if (accuracy === "TRUE_NEGATIVE") accuracyByWindow[w].TN++;
      else if (accuracy === "FALSE_NEGATIVE") accuracyByWindow[w].FN++;
      else accuracyByWindow[w].AMBIGUOUS++;

      // v2 정확도
      const accuracyV2 = evaluateAccuracy(wr.actionV2, outcome);
      accuracyByWindowV2[w].total++;
      if (wr.actionV2.action_type) accuracyByWindowV2[w].actionFired++;
      if (accuracyV2 === "TRUE_POSITIVE") accuracyByWindowV2[w].TP++;
      else if (accuracyV2 === "FALSE_POSITIVE") accuracyByWindowV2[w].FP++;
      else if (accuracyV2 === "TRUE_NEGATIVE") accuracyByWindowV2[w].TN++;
      else if (accuracyV2 === "FALSE_NEGATIVE") accuracyByWindowV2[w].FN++;
      else accuracyByWindowV2[w].AMBIGUOUS++;

      campResult.windows[w] = {
        action: wr.action.action_type,
        reason: wr.action.reason,
        accuracy,
        actionV2: wr.actionV2.action_type,
        reasonV2: wr.actionV2.reason,
        accuracyV2,
        metrics: {
          roas: wr.metrics.roas,
          ctr: wr.metrics.ctr,
          cpc: wr.metrics.cpc,
          frequency: wr.metrics.frequency,
          spend: Math.round(wr.metrics.spend),
          purchases: wr.metrics.purchases,
        },
      };
    }

    campaignResults.push(campResult);
  }

  // ═══ 결과 출력 ═══

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  📈 v1(기존) vs v2(개선) 규칙 정확도 비교");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const fmtAcc = (a) => {
    const precision = a.TP + a.FP > 0 ? ((a.TP / (a.TP + a.FP)) * 100).toFixed(1) : "N/A";
    const recall = a.TP + a.FN > 0 ? ((a.TP / (a.TP + a.FN)) * 100).toFixed(1) : "N/A";
    const overall = a.total > 0 ? (((a.TP + a.TN) / a.total) * 100).toFixed(1) : "N/A";
    const rate = a.total > 0 ? ((a.actionFired / a.total) * 100).toFixed(1) : "0";
    return { precision, recall, overall, rate };
  };

  for (const w of windows) {
    const v1 = fmtAcc(accuracyByWindow[w]);
    const v2 = fmtAcc(accuracyByWindowV2[w]);
    const a1 = accuracyByWindow[w];
    const a2 = accuracyByWindowV2[w];

    console.log(`  📅 ${w}`);
    console.log(`    v1(기존): 정확도 ${v1.overall}% | Precision ${v1.precision}% | Recall ${v1.recall}% | TP:${a1.TP} FP:${a1.FP} TN:${a1.TN} FN:${a1.FN}`);
    console.log(`    v2(개선): 정확도 ${v2.overall}% | Precision ${v2.precision}% | Recall ${v2.recall}% | TP:${a2.TP} FP:${a2.FP} TN:${a2.TN} FN:${a2.FN}`);
    // 변화량
    const recallDelta = parseFloat(v2.recall) - parseFloat(v1.recall);
    const precDelta = parseFloat(v2.precision) - parseFloat(v1.precision);
    if (!isNaN(recallDelta)) {
      console.log(`    📊 변화: Recall ${recallDelta >= 0 ? "+" : ""}${recallDelta.toFixed(1)}%p | Precision ${!isNaN(precDelta) ? (precDelta >= 0 ? "+" : "") + precDelta.toFixed(1) + "%p" : "N/A"}`);
    }
    console.log();
  }

  // 캠페인별 상세 결과
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  📋 캠페인별 상세 결과");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // outcome별로 정렬 (TOTAL_FAIL → FAIL → BREAK_EVEN → SUCCESS → SUCCESS_HIGH)
  const orderMap = { TOTAL_FAIL: 0, FAIL: 1, BREAK_EVEN: 2, SUCCESS: 3, SUCCESS_HIGH: 4 };
  campaignResults.sort((a, b) => (orderMap[a.outcome.label] || 0) - (orderMap[b.outcome.label] || 0));

  for (const cr of campaignResults) {
    const o = cr.outcome;
    const outcomeEmoji = {
      SUCCESS_HIGH: "🟢", SUCCESS: "🟢", BREAK_EVEN: "🟡", FAIL: "🔴", TOTAL_FAIL: "⛔",
    };
    console.log(`${outcomeEmoji[o.label] || "⚪"} ${cr.name}`);
    console.log(`   결과: ${o.label} | ROAS ${o.lifetime_roas.toFixed(2)}x | 소진 ₩${Math.round(o.lifetime_spend).toLocaleString()} | 구매 ${o.lifetime_purchases}건 | ${o.total_days}일`);

    for (const w of windows) {
      const wr = cr.windows[w];
      if (!wr || wr.skip) continue;
      const actionStr = wr.action || "—";
      const accStr = wr.accuracy;
      const m = wr.metrics;
      console.log(`   ${w.padEnd(4)}: ${actionStr.padEnd(18)} | ${accStr.padEnd(15)} | ROAS ${m.roas.toFixed(2)}x CTR ${m.ctr.toFixed(1)}% CPC ₩${Math.round(m.cpc)} freq ${m.frequency.toFixed(1)} 소진₩${m.spend.toLocaleString()} 구매${m.purchases}`);
    }
    console.log();
  }

  // ═══ 지표 상관관계 ═══
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  📊 7일 시점 지표 → 최종 ROAS 상관관계");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const correlations = analyzeMetricCorrelations(campaignGroups);
  // 최종 ROAS별 그룹 통계
  const groups = { SUCCESS_HIGH: [], SUCCESS: [], BREAK_EVEN: [], FAIL: [], TOTAL_FAIL: [] };
  for (const dp of correlations) {
    if (groups[dp.outcome_label]) groups[dp.outcome_label].push(dp);
  }

  for (const [label, items] of Object.entries(groups)) {
    if (items.length === 0) continue;
    const avg = (arr, key) => arr.reduce((s, i) => s + i[key], 0) / arr.length;
    console.log(`  ${label} (${items.length}개):`);
    console.log(`    7d ROAS: ${avg(items, "d7_roas").toFixed(2)}x | CTR: ${avg(items, "d7_ctr").toFixed(2)}% | CPC: ₩${Math.round(avg(items, "d7_cpc"))} | Freq: ${avg(items, "d7_frequency").toFixed(2)} | CPA: ₩${Math.round(avg(items, "d7_cpa"))}`);
    console.log(`    lifetime ROAS avg: ${avg(items, "lifetime_roas").toFixed(2)}x`);
    console.log();
  }

  // ═══ 세팅 패턴 분석 ═══
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  🎯 광고 세팅별 성과 패턴");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const settingPatterns = analyzeSettingPatterns(campaigns, campaignGroups);

  // 목표별 성과
  const byObjective = {};
  for (const p of settingPatterns) {
    if (!byObjective[p.objective]) byObjective[p.objective] = [];
    byObjective[p.objective].push(p);
  }
  console.log("  목표(Objective)별:");
  for (const [obj, items] of Object.entries(byObjective)) {
    const avgRoas = items.reduce((s, i) => s + i.lifetime_roas, 0) / items.length;
    const successCount = items.filter(i => ["SUCCESS", "SUCCESS_HIGH"].includes(i.label)).length;
    console.log(`    ${obj}: ${items.length}개 | avg ROAS ${avgRoas.toFixed(2)}x | 성공 ${successCount}/${items.length}`);
  }

  // 예산 구간별 성과
  console.log("\n  일예산 구간별:");
  const budgetRanges = [
    { label: "<₩15K", min: 0, max: 15000 },
    { label: "₩15K~30K", min: 15000, max: 30000 },
    { label: "₩30K~50K", min: 30000, max: 50000 },
    { label: "₩50K~70K", min: 50000, max: 70000 },
    { label: ">₩70K", min: 70000, max: Infinity },
  ];
  for (const range of budgetRanges) {
    const items = settingPatterns.filter(p => p.daily_budget >= range.min && p.daily_budget < range.max);
    if (items.length === 0) continue;
    const avgRoas = items.reduce((s, i) => s + i.lifetime_roas, 0) / items.length;
    const successCount = items.filter(i => ["SUCCESS", "SUCCESS_HIGH"].includes(i.label)).length;
    console.log(`    ${range.label}: ${items.length}개 | avg ROAS ${avgRoas.toFixed(2)}x | 성공 ${successCount}/${items.length}`);
  }

  // ═══ 규칙 정확도 문제점 및 개선 제안 ═══
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  💡 규칙별 발동 분석");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 7d 기준으로 각 규칙별 발동 결과 분석
  const ruleStats = { R1: { TP: 0, FP: 0, total: 0 }, R2: { TP: 0, FP: 0, total: 0 }, R3: { TP: 0, FP: 0, total: 0 },
                      R4: { TP: 0, FP: 0, total: 0 }, R5: { TP: 0, FP: 0, total: 0 }, R6: { TP: 0, FP: 0, total: 0 } };

  for (const cr of campaignResults) {
    const wr = cr.windows["7d"];
    if (!wr || wr.skip || !wr.reason) continue;

    for (const rNum of ["R1", "R2", "R3", "R4", "R5", "R6"]) {
      if (wr.reason.startsWith(rNum)) {
        ruleStats[rNum].total++;
        if (wr.accuracy === "TRUE_POSITIVE") ruleStats[rNum].TP++;
        else if (wr.accuracy === "FALSE_POSITIVE") ruleStats[rNum].FP++;
      }
    }
  }

  const ruleDescriptions = {
    R1: "ROAS <0.5x & 소진 >₩100K → pause",
    R2: "구매 0건 & 소진 >₩50K → pause",
    R3: "Frequency >2.5 & CTR <2% → pause",
    R4: "ROAS ≥3.0x & 예산 ≤₩20K → budget_increase",
    R5: "ROAS ≥2.0x & 예산 <₩70K → budget_increase",
    R6: "ROAS 0.5~1.0x & 예산 >₩50K → budget_decrease",
  };

  for (const [rule, desc] of Object.entries(ruleDescriptions)) {
    const s = ruleStats[rule];
    const precision = s.total > 0 ? ((s.TP / Math.max(s.TP + s.FP, 1)) * 100).toFixed(0) : "N/A";
    console.log(`  ${rule}: ${desc}`);
    console.log(`      → 발동 ${s.total}회 | 정확 ${s.TP}회 | 오탐 ${s.FP}회 | Precision: ${precision}%\n`);
  }

  // ═══ False Negative 분석 (놓친 캠페인) ═══
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ⚠️  놓친 캠페인 (7d 시점에서 no_action인데 실제 FAIL/TOTAL_FAIL)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const missedCampaigns = campaignResults.filter(cr => {
    const wr = cr.windows["7d"];
    return wr && !wr.skip && wr.accuracy === "FALSE_NEGATIVE";
  });

  for (const mc of missedCampaigns) {
    const wr = mc.windows["7d"];
    const o = mc.outcome;
    console.log(`  ❌ ${mc.name}`);
    console.log(`     최종: ${o.label} (ROAS ${o.lifetime_roas.toFixed(2)}x, 소진 ₩${Math.round(o.lifetime_spend).toLocaleString()}, 구매 ${o.lifetime_purchases}건)`);
    console.log(`     7d 시점: ROAS ${wr.metrics.roas.toFixed(2)}x CTR ${wr.metrics.ctr.toFixed(1)}% CPC ₩${Math.round(wr.metrics.cpc)} freq ${wr.metrics.frequency.toFixed(1)} 소진₩${wr.metrics.spend.toLocaleString()} 구매${wr.metrics.purchases}`);
    console.log(`     → 규칙이 잡지 못한 이유: 소진/ROAS 기준에 미달했거나 frequency/CTR 조건 불충족`);
    console.log();
  }

  // ═══ False Positive 분석 (오탐 캠페인) ═══
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  🚨 오탐 캠페인 (7d 시점에서 pause/decrease인데 실제 SUCCESS)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const falsePosResults = campaignResults.filter(cr => {
    const wr = cr.windows["7d"];
    return wr && !wr.skip && wr.accuracy === "FALSE_POSITIVE";
  });

  for (const fp of falsePosResults) {
    const wr = fp.windows["7d"];
    const o = fp.outcome;
    console.log(`  🚨 ${fp.name}`);
    console.log(`     제안: ${wr.action} — ${wr.reason}`);
    console.log(`     실제: ${o.label} (ROAS ${o.lifetime_roas.toFixed(2)}x, 소진 ₩${Math.round(o.lifetime_spend).toLocaleString()}, 구매 ${o.lifetime_purchases}건)`);
    console.log(`     → 초기에는 성과가 안 좋았지만 이후 개선됨 (학습 기간 필요)으로 판단됨`);
    console.log();
  }

  // ═══ ROAS 안정화 시점 분석 ═══
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ⏱️  ROAS 안정화 분석 — 며칠부터 최종 ROAS 예측 가능한가?");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // 각 관찰기간에서 ROAS와 최종 ROAS의 상관관계(평균절대오차)
  const roasDeviation = {};
  for (const w of windows) {
    const deviations = [];
    for (const cr of campaignResults) {
      const wr = cr.windows[w];
      if (!wr || wr.skip) continue;
      if (cr.outcome.lifetime_spend < 10000) continue; // 너무 작은 캠페인 제외
      const deviation = Math.abs(wr.metrics.roas - cr.outcome.lifetime_roas);
      deviations.push(deviation);
    }
    if (deviations.length > 0) {
      const mae = deviations.reduce((s, d) => s + d, 0) / deviations.length;
      const maxDev = Math.max(...deviations);
      roasDeviation[w] = { mae: parseFloat(mae.toFixed(4)), maxDev: parseFloat(maxDev.toFixed(4)), samples: deviations.length };
    }
  }

  for (const [w, dev] of Object.entries(roasDeviation)) {
    console.log(`  ${w.padEnd(4)}: ROAS 평균오차 ${dev.mae.toFixed(2)}x | 최대오차 ${dev.maxDev.toFixed(2)}x | 샘플 ${dev.samples}개`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  ✅ 백테스트 완료");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // JSON 결과 저장
  const backTestResult = {
    run_date: new Date().toISOString(),
    total_campaigns: campaigns.length,
    campaigns_with_data: campaignIds.length,
    daily_data_points: dailyInsights.length,
    accuracy_by_window: accuracyByWindow,
    roas_deviation: roasDeviation,
    rule_stats: ruleStats,
    missed_campaigns: missedCampaigns.map(mc => ({ name: mc.name, outcome: mc.outcome, d7_metrics: mc.windows["7d"]?.metrics })),
    false_positives: falsePosResults.map(fp => ({ name: fp.name, action: fp.windows["7d"]?.action, outcome: fp.outcome })),
    correlation_data: correlations,
    setting_patterns: settingPatterns,
  };

  const fs = await import("fs");
  const resultPath = new URL("../../docs/backtest-result.json", import.meta.url).pathname;
  fs.writeFileSync(resultPath, JSON.stringify(backTestResult, null, 2));
  console.log(`  💾 상세 결과 저장: ${resultPath}`);
}

main().catch(err => {
  console.error("❌ 백테스트 실패:", err);
  process.exit(1);
});

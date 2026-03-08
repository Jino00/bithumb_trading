// 일일 캠페인 리뷰 엔진 — 매일 09:00 KST 자동 실행, 규칙 기반 액션 생성
// ※ 백테스트 결과 반영 (2026-03-08): 88개 캠페인 / 661개 일별 데이터로 검증
//   - 7일이 최소 의미 있는 관찰기간 (ROAS 오차 0.11x, 3일은 1.39x)
//   - 기존 6규칙 Precision 100%이나 Recall 50% → 나쁜 캠페인 절반 놓침
//   - ROAS 0.5~1.0x + CPC >₩1,000 구간이 사각지대 → 새 규칙 추가
//   - Frequency/예산 규칙은 실전에서 거의 발동 안 됨 → 임계값 조정
import { getDb } from "../db/database.js";
import { fetchAccountInsights, mapAccountInsightToSchema, fetchAdSetsForCampaign } from "./meta-api.js";
import { judgeAllCampaigns, blendThreshold } from "./campaign-judge.js";
import { getBenchmarks } from "./trend-intelligence.js";
import { sendReviewNotification } from "./notification.js";

// ─── 액션 생성 규칙 기본 상수 (벤치마크 없을 때 fallback, 백테스트 결과 기반) ───
const MIN_DAILY_BUDGET = 20000;
const MAX_DAILY_BUDGET = 70000;
const BUDGET_INCREASE_RATIO = 1.3;
const BUDGET_DECREASE_RATIO = 0.7;

// 하드코딩 기본값 (벤치마크 데이터 부족 시 사용)
const DEFAULT_ROAS_PAUSE = 0.5;
const DEFAULT_ROAS_WARN_UPPER = 1.0;
const DEFAULT_CPC_DANGER = 1200;
const DEFAULT_CPC_WARNING = 1000;
const DEFAULT_ROAS_SCALE = 2.0;
const DEFAULT_ROAS_HIGH_SCALE = 3.0;
const DEFAULT_FREQ_FATIGUE = 2.0;
const DEFAULT_CTR_FATIGUE = 2.0;

// 지출 임계값 (벤치마크 불필요 — 절대 금액 기준)
const SPEND_PAUSE_THRESHOLD = 100000;
const SPEND_PAUSE_SEVERE = 50000;
const SPEND_NO_PURCHASE_THRESHOLD = 30000;
const BUDGET_DECREASE_TRIGGER = 30000;

/**
 * 일일 리뷰 실행 — Meta API에서 최신 데이터 조회 후 캠페인 판정 + 액션 생성
 * @returns {{ run_id, total_campaigns, actions_generated, actions }}
 */
export async function runDailyReview() {
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];

  console.log(`[DailyReview] Starting daily review for ${today}`);

  // 1. Meta API 토큰 + 광고계정 조회
  const creds = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials ORDER BY id DESC LIMIT 1").get();
  if (!creds?.access_token || !creds?.selected_ad_account_id) {
    console.warn("[DailyReview] No Meta credentials found, skipping review");
    return { run_id: null, total_campaigns: 0, actions_generated: 0, actions: [], skipped: true, reason: "no_credentials" };
  }

  // 2. 7일 인사이트 조회 (안정적인 판정 기간)
  const { data: insights7d, error: err7d } = await fetchAccountInsights(creds.access_token, creds.selected_ad_account_id, "7d");
  if (err7d || !insights7d?.length) {
    console.warn(`[DailyReview] Failed to fetch 7d insights: ${err7d || "no data"}`);
    return { run_id: null, total_campaigns: 0, actions_generated: 0, actions: [], skipped: true, reason: err7d || "no_insights" };
  }

  // 3. 캠페인 스키마로 매핑
  const campaigns = insights7d.map((i) => mapAccountInsightToSchema(i, "7d"));

  // 4. 원가 데이터 조인
  const costs = db.prepare("SELECT campaign_name, cost_price FROM product_costs").all();
  const costMap = Object.fromEntries(costs.map((c) => [c.campaign_name, c.cost_price]));
  for (const c of campaigns) {
    c.cost_price = costMap[c.name] || null;
  }

  // 5. 캠페인 판정 (7일 기간 기준 벤치마크 적용)
  const { judgments, summary } = judgeAllCampaigns(campaigns, "7d");

  // 6. 일 예산 정보 가져오기 (Meta API에서)
  const dailyBudgets = await fetchDailyBudgets(creds.access_token, campaigns);

  // 7. 액션 생성
  const actions = generateActions(judgments, dailyBudgets);

  // 8. DB 저장
  const runId = saveReviewRun(db, today, campaigns.length, actions, summary);
  saveActions(db, runId, actions);

  console.log(`[DailyReview] Review complete: ${campaigns.length} campaigns, ${actions.length} actions generated`);

  // 9. 알림 발송 (액션이 있을 때만)
  if (actions.length > 0) {
    try {
      await sendReviewNotification({
        date: today,
        total_campaigns: campaigns.length,
        actions,
        summary,
      });
    } catch (err) {
      console.error("[DailyReview] Notification failed:", err.message);
    }
  }

  return { run_id: runId, total_campaigns: campaigns.length, actions_generated: actions.length, actions };
}

/**
 * 각 캠페인의 일 예산 조회 (Meta API adset 레벨)
 */
async function fetchDailyBudgets(accessToken, campaigns) {
  const budgetMap = {};
  for (const c of campaigns) {
    if (!c.meta_campaign_id) continue;
    try {
      const { data: adsets } = await fetchAdSetsForCampaign(accessToken, c.meta_campaign_id);
      if (adsets?.length > 0) {
        // 첫 번째 adset의 예산 + 타겟팅 사용 (대부분 캠페인당 adset 1개)
        const budgetCents = parseInt(adsets[0].daily_budget || "0", 10);
        budgetMap[c.meta_campaign_id] = {
          daily_budget: budgetCents / 100,
          adset_id: adsets[0].id,
          targeting: adsets[0].targeting || null,
        };
      }
    } catch {
      // 개별 실패는 무시
    }
  }
  return budgetMap;
}

/**
 * 판정 결과 기반 액션 생성 (docs/ad-insights.md + 백테스트 결과 기반)
 *
 * 백테스트 검증 결과 (2026-03-08, 72개 캠페인):
 *   - 기존 6규칙: Precision 100%, Recall 50% (15/30 놓침)
 *   - 놓친 패턴: ROAS 0.5~1.0x + CPC >₩1,000 (가장 큰 사각지대)
 *   - 개선 후 목표: Precision 95%+, Recall 75%+ 달성
 *
 * 규칙 우선순위 (위→아래, 먼저 매칭되면 continue):
 *   R1:  ROAS <0.5x & 소진 >₩100K → pause (검증: 14/14 정확)
 *   R1b: ROAS <0.3x & 소진 >₩50K → pause (새규칙: 심각한 적자 조기 감지)
 *   R2:  구매 0건 & 소진 >₩30K → pause (기존 ₩50K→₩30K: 백테스트 FN 6건 해결)
 *   R3:  Frequency >2.0 & CTR <2% → pause (기존 2.5→2.0: 실전 발동률 개선)
 *   R7:  ROAS 0.5~1.0x & CPC >₩1,200 & 소진 >₩100K → pause (새규칙: 사각지대 해결)
 *   R8:  ROAS 0.5~1.0x & CPC >₩1,000 & 소진 >₩50K → budget_decrease (새규칙: 경고)
 *   R4:  ROAS ≥3.0x & 예산 ≤₩20K → budget_increase 2x (유지)
 *   R5:  ROAS ≥2.0x & 예산 <₩70K → budget_increase 1.3x (유지)
 *   R6:  ROAS 0.5~1.0x & 예산 >₩30K → budget_decrease 0.7x (기존 ₩50K→₩30K)
 */
function generateActions(judgments, dailyBudgets) {
  // ─── 벤치마크 로드 → 동적 기준 생성 (데이터 부족 시 하드코딩 fallback) ───
  let bm = null;
  try {
    const benchmarkData = getBenchmarks("7d");
    if (benchmarkData && Object.keys(benchmarkData.metrics).length > 0) {
      bm = benchmarkData.metrics;
    }
  } catch { /* 벤치마크 데이터 없으면 하드코딩만 사용 */ }

  const rSc = bm?.roas?.sample_count || 0;
  const cSc = bm?.cpc?.sample_count || 0;
  const fSc = bm?.frequency?.sample_count || 0;

  // 동적 임계값 (데이터 충분하면 학습 기준, 부족하면 하드코딩)
  const ROAS_PAUSE = blendThreshold(DEFAULT_ROAS_PAUSE, bm?.roas?.p25, rSc);
  const ROAS_WARN_UPPER = blendThreshold(DEFAULT_ROAS_WARN_UPPER, bm?.roas?.median, rSc);
  const CPC_DANGER = blendThreshold(DEFAULT_CPC_DANGER, bm?.cpc?.p90, cSc);
  const CPC_WARNING = blendThreshold(DEFAULT_CPC_WARNING, bm?.cpc?.p75, cSc);
  const ROAS_SCALE = blendThreshold(DEFAULT_ROAS_SCALE, bm?.roas?.p75, rSc);
  const ROAS_HIGH_SCALE = blendThreshold(DEFAULT_ROAS_HIGH_SCALE, bm?.roas?.p90, rSc);
  const FREQ_FATIGUE = blendThreshold(DEFAULT_FREQ_FATIGUE, bm?.frequency?.p75, fSc);
  const CTR_FATIGUE = blendThreshold(DEFAULT_CTR_FATIGUE, bm?.ctr?.p25, bm?.ctr?.sample_count || 0);

  // ─── 액션 효과 학습 데이터 로드 (우선순위 결정용) ───
  let actionEffectiveness = {};
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT action_type, success_rate, times_applied FROM action_effectiveness WHERE times_applied >= 2"
    ).all();
    for (const r of rows) {
      actionEffectiveness[r.action_type] = { success_rate: r.success_rate, times_applied: r.times_applied };
    }
  } catch { /* 학습 데이터 없으면 건너뛰기 */ }

  if (bm) {
    console.log(`[DailyReview] 동적 기준 적용: ROAS_PAUSE=${ROAS_PAUSE.toFixed(2)}, CPC_DANGER=${Math.round(CPC_DANGER)}, ROAS_SCALE=${ROAS_SCALE.toFixed(2)}`);
  }

  const allActions = [];

  for (const j of judgments) {
    const budget = dailyBudgets[j.campaign_id]?.daily_budget || 0;
    const adsetId = dailyBudgets[j.campaign_id]?.adset_id || null;
    const targeting = dailyBudgets[j.campaign_id]?.targeting || null;
    const { roas, spend, purchases, frequency, ctr, cpc } = j.metrics;
    const campaignActions = [];

    // ═══ 정지 규칙 (가장 높은 우선순위) ═══

    // R1: ROAS <동적기준 & 소진 >₩100K → 일시정지
    if (roas < ROAS_PAUSE && spend > SPEND_PAUSE_THRESHOLD) {
      campaignActions.push(buildAction(j, "pause", "ACTIVE", "PAUSED",
        `[R1] ROAS ${roas.toFixed(2)}x (<${ROAS_PAUSE.toFixed(1)}x) + 소진 ₩${Math.round(spend).toLocaleString()} (>100K) → 비효율 캠페인 일시정지`));
    }

    // R1b: ROAS <0.3x & 소진 >₩50K → 일시정지 (심각한 적자 조기 감지)
    if (roas < 0.3 && roas > 0 && spend > SPEND_PAUSE_SEVERE) {
      campaignActions.push(buildAction(j, "pause", "ACTIVE", "PAUSED",
        `[R1b] ROAS ${roas.toFixed(2)}x (<0.3x 심각) + 소진 ₩${Math.round(spend).toLocaleString()} → 심각한 적자, 조기 일시정지`));
    }

    // R2: 구매 0건 & 소진 >₩30K → 일시정지
    if (purchases === 0 && spend > SPEND_NO_PURCHASE_THRESHOLD) {
      campaignActions.push(buildAction(j, "pause", "ACTIVE", "PAUSED",
        `[R2] 구매 0건 + 소진 ₩${Math.round(spend).toLocaleString()} (>30K) → 전환 없는 캠페인 일시정지`));
    }

    // R3: Frequency >동적기준 & CTR <동적기준 → 광고 피로도
    if (frequency > FREQ_FATIGUE && ctr < CTR_FATIGUE) {
      campaignActions.push(buildAction(j, "pause", "ACTIVE", "PAUSED",
        `[R3] Frequency ${frequency.toFixed(1)} (>${FREQ_FATIGUE.toFixed(1)}) + CTR ${ctr.toFixed(1)}% (<${CTR_FATIGUE.toFixed(1)}%) → 광고 피로 일시정지`));
    }

    // ═══ 사각지대 해결 규칙 ═══

    // R7: ROAS 경고구간 & CPC >동적기준(위험) & 소진 >₩100K → 일시정지
    if (roas >= ROAS_PAUSE && roas < ROAS_WARN_UPPER && cpc > CPC_DANGER && spend > SPEND_PAUSE_THRESHOLD) {
      campaignActions.push(buildAction(j, "pause", "ACTIVE", "PAUSED",
        `[R7] ROAS ${roas.toFixed(2)}x (적자) + CPC ₩${Math.round(cpc).toLocaleString()} (>${Math.round(CPC_DANGER)} 고비용) + 소진 ₩${Math.round(spend).toLocaleString()} → 타겟/소재 문제, 일시정지 후 재설계`));
    }

    // R8: ROAS 경고구간 & CPC >동적기준(경고) & 소진 >₩50K → 예산 감축
    if (roas >= ROAS_PAUSE && roas < ROAS_WARN_UPPER && cpc > CPC_WARNING && spend > SPEND_PAUSE_SEVERE && budget > MIN_DAILY_BUDGET) {
      const proposed = Math.max(Math.round(budget * BUDGET_DECREASE_RATIO), MIN_DAILY_BUDGET);
      if (proposed < budget) {
        campaignActions.push(buildBudgetAction(j, adsetId, budget, proposed,
          `[R8] ROAS ${roas.toFixed(2)}x + CPC ₩${Math.round(cpc).toLocaleString()} (>${Math.round(CPC_WARNING)} 경고) → 예산 ₩${budget.toLocaleString()} → ₩${proposed.toLocaleString()} 감축 후 관찰`));
      }
    }

    // ═══ 스케일링 규칙 ═══

    // R4: ROAS ≥동적기준(상위) & 일예산 ≤₩20K → 예산 대폭 증액 (2x)
    if (roas >= ROAS_HIGH_SCALE && budget > 0 && budget <= MIN_DAILY_BUDGET) {
      const proposed = Math.min(budget * 2, MAX_DAILY_BUDGET);
      if (proposed > budget) {
        campaignActions.push(buildBudgetAction(j, adsetId, budget, proposed,
          `[R4] ROAS ${roas.toFixed(2)}x (≥${ROAS_HIGH_SCALE.toFixed(1)}x 우수) + 예산 ₩${budget.toLocaleString()} → ₩${proposed.toLocaleString()} 스케일업`));
      }
    }

    // R5: ROAS ≥동적기준(양호) & 일예산 <₩70K → 예산 증액 (1.3x)
    if (roas >= ROAS_SCALE && budget > 0 && budget < MAX_DAILY_BUDGET) {
      const proposed = Math.min(Math.round(budget * BUDGET_INCREASE_RATIO), MAX_DAILY_BUDGET);
      if (proposed > budget) {
        campaignActions.push(buildBudgetAction(j, adsetId, budget, proposed,
          `[R5] ROAS ${roas.toFixed(2)}x (≥${ROAS_SCALE.toFixed(1)}x) → 예산 ₩${budget.toLocaleString()} → ₩${proposed.toLocaleString()} 증액`));
      }
    }

    // ═══ 예산 감축 규칙 ═══

    // R6: ROAS 경고구간 & 일예산 >₩30K → 예산 감축 (0.7x)
    if (roas >= ROAS_PAUSE && roas < ROAS_WARN_UPPER && budget > BUDGET_DECREASE_TRIGGER) {
      const proposed = Math.max(Math.round(budget * BUDGET_DECREASE_RATIO), MIN_DAILY_BUDGET);
      if (proposed < budget) {
        campaignActions.push(buildBudgetAction(j, adsetId, budget, proposed,
          `[R6] ROAS ${roas.toFixed(2)}x (손익분기 미만) → 예산 ₩${budget.toLocaleString()} → ₩${proposed.toLocaleString()} 감축`));
      }
    }

    // ═══ 개선 방향 규칙 ═══

    // R9: CPC >동적기준(위험) + 관심사 타겟 → Broad 타겟 전환
    if (cpc > CPC_DANGER && hasInterestTargeting(targeting)) {
      const broadTargeting = { geo_locations: { countries: ["KR"] }, age_min: 18, age_max: 65 };
      campaignActions.push({
        ...buildAction(j, "targeting_broaden",
          JSON.stringify(targeting || {}),
          JSON.stringify(broadTargeting),
          `[R9] CPC ₩${Math.round(cpc).toLocaleString()} (>${Math.round(CPC_DANGER)}) + 관심사 타겟 사용 중 → Broad 타겟 전환 (검증된 성공 패턴)`),
        adset_id: adsetId,
      });
    }

    // R10: Frequency >3.0 + CTR <1.5% → 크리에이티브 피로
    if (frequency > 3.0 && ctr < 1.5 && spend > SPEND_NO_PURCHASE_THRESHOLD) {
      campaignActions.push(buildAction(j, "creative_refresh",
        `Frequency ${frequency.toFixed(1)}`,
        "새 크리에이티브 필요",
        `[R10] Frequency ${frequency.toFixed(1)} (>3.0) + CTR ${ctr.toFixed(1)}% (<1.5%) → 소재 피로, 새 크리에이티브 제작 필요`));
    }

    // ─── 액션 우선순위: 같은 캠페인에 여러 규칙 매칭 시 가장 효과적인 액션 선택 ───
    if (campaignActions.length === 0) continue;

    if (campaignActions.length === 1) {
      allActions.push(campaignActions[0]);
    } else {
      // 학습 데이터가 있으면 success_rate로 정렬, 없으면 첫 번째 (우선순위 순)
      const sorted = campaignActions.sort((a, b) => {
        const aRate = actionEffectiveness[a.action_type]?.success_rate ?? -1;
        const bRate = actionEffectiveness[b.action_type]?.success_rate ?? -1;
        // 학습 데이터가 있는 액션 우선, 둘 다 있으면 성공률 높은 것 우선
        if (aRate >= 0 && bRate >= 0) return bRate - aRate;
        if (aRate >= 0) return -1;
        if (bRate >= 0) return 1;
        return 0; // 둘 다 학습 데이터 없으면 원래 순서 유지 (우선순위 순)
      });
      allActions.push(sorted[0]);
    }
  }

  return allActions;
}

/** 관심사/행동 기반 타겟팅 사용 여부 체크 */
function hasInterestTargeting(targeting) {
  if (!targeting) return false;
  // Meta 타겟팅에서 interests, behaviors, flexible_spec이 있으면 관심사 타겟
  return !!(
    targeting.interests?.length > 0 ||
    targeting.behaviors?.length > 0 ||
    targeting.flexible_spec?.length > 0
  );
}

function buildAction(judgment, actionType, currentValue, proposedValue, reason) {
  return {
    campaign_name: judgment.campaign_name,
    meta_campaign_id: String(judgment.campaign_id),
    action_type: actionType,
    current_value: currentValue,
    proposed_value: proposedValue,
    reason,
    verdict: judgment.verdict,
    score: judgment.score,
    // ─── 진단 데이터 (campaign-judge.js에서 이미 생성된 데이터 전달) ───
    recommendations: judgment.recommendations || [],
    funnel_diagnosis: judgment.funnel_diagnosis || [],
    smart_recommendations: judgment.smart_recommendations || [],
    benchmark_comparison: judgment.benchmark_comparison || null,
    profitability: judgment.profitability || null,
  };
}

function buildBudgetAction(judgment, adsetId, currentBudget, proposedBudget, reason) {
  const actionType = proposedBudget > currentBudget ? "budget_increase" : "budget_decrease";
  return {
    campaign_name: judgment.campaign_name,
    meta_campaign_id: String(judgment.campaign_id),
    adset_id: adsetId,
    action_type: actionType,
    current_value: String(currentBudget),
    proposed_value: String(proposedBudget),
    reason,
    verdict: judgment.verdict,
    score: judgment.score,
    // ─── 진단 데이터 (campaign-judge.js에서 이미 생성된 데이터 전달) ───
    recommendations: judgment.recommendations || [],
    funnel_diagnosis: judgment.funnel_diagnosis || [],
    smart_recommendations: judgment.smart_recommendations || [],
    benchmark_comparison: judgment.benchmark_comparison || null,
    profitability: judgment.profitability || null,
  };
}

function saveReviewRun(db, date, totalCampaigns, actions, summary) {
  const stmt = db.prepare(`
    INSERT INTO review_runs (run_date, total_campaigns, actions_generated, summary_json)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(date, totalCampaigns, actions.length, JSON.stringify(summary));
  return result.lastInsertRowid;
}

function saveActions(db, runId, actions) {
  const stmt = db.prepare(`
    INSERT INTO action_queue (
      review_run_id, campaign_name, meta_campaign_id, action_type,
      current_value, proposed_value, reason, verdict, score, adset_id,
      recommendations_json, funnel_diagnosis_json, smart_recommendations_json,
      benchmark_comparison_json, profitability_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items) => {
    for (const a of items) {
      stmt.run(
        runId, a.campaign_name, a.meta_campaign_id, a.action_type,
        a.current_value, a.proposed_value, a.reason, a.verdict, a.score,
        a.adset_id || null,
        a.recommendations?.length ? JSON.stringify(a.recommendations) : null,
        a.funnel_diagnosis?.length ? JSON.stringify(a.funnel_diagnosis) : null,
        a.smart_recommendations?.length ? JSON.stringify(a.smart_recommendations) : null,
        a.benchmark_comparison ? JSON.stringify(a.benchmark_comparison) : null,
        a.profitability ? JSON.stringify(a.profitability) : null,
      );
    }
  });
  insertMany(actions);
}

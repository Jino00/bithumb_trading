// 일시정지 캠페인 자동 개선 파이프라인 — 쿨링 → 진단 → 예산/타겟 수정 → 재개 → 측정
import { getDb } from "../db/database.js";
import {
  updateCampaignStatus,
  updateAdSetBudget,
  fetchAdSetsForCampaign,
  updateAdSetTargeting,
} from "./meta-api.js";
import { sendViaOpenClaw } from "./notification.js";
import { getStrategyModifiers } from "./trend-bridge.js";
import { upsertLesson } from "./postmortem-service.js";

// ─── 근본 원인 분류 (daily-review 규칙 코드 → 구조화) ───

const ROOT_CAUSE_MAP = {
  R1:  { code: "roas_low",          cooling: 3 },
  R1b: { code: "roas_low",          cooling: 3 },
  R2:  { code: "zero_purchases",    cooling: 7 },
  R3:  { code: "frequency_fatigue", cooling: -1 },  // -1 = 수동만
  R7:  { code: "roas_low_cpc_high", cooling: 3 },
};

// 기본 전략 매핑 (학습 데이터가 없을 때)
const DEFAULT_STRATEGIES = {
  roas_low:          { first: ["budget_decrease_70"],                 second: null },
  roas_low_cpc_high: { first: ["budget_decrease_70"],                 second: ["targeting_broaden", "budget_decrease_70"] },
  cpc_high:          { first: ["targeting_broaden", "budget_decrease_70"], second: ["budget_decrease_70"] },
  zero_purchases:    { first: ["budget_decrease_50"],                 second: null },
  frequency_fatigue: { first: null,                                   second: null },  // 자동 불가
};

const MAX_ATTEMPTS = 2;
const MAX_TRACKING_DAYS = 30;
const MIN_DAYS_FOR_ACTION = 3;  // verdict_phase 기반: 예비판정 3일+, 조기감지는 day 1부터

// ─── 공개 함수 ───

/**
 * 일시정지된 캠페인을 자동 개선 추적 대상으로 등록
 * @param {object} action — action_queue 레코드
 * @param {number|null} reviewRunId — 일일 리뷰 run ID (null이면 수동 정지 → 자동 재개 금지)
 */
export function registerPausedCampaign(action, reviewRunId = null) {
  const db = getDb();

  // 이미 등록된 active 레코드가 있으면 중복 등록 방지
  const existing = db.prepare(
    "SELECT id FROM paused_campaign_improvements WHERE meta_campaign_id = ? AND status NOT IN ('resolved', 'manual_review')"
  ).get(action.meta_campaign_id);
  if (existing) return existing;

  const rootCause = parseRootCause(action.reason);
  const cooling = rootCause.cooling;

  // frequency_fatigue → 자동 개선 불가, 바로 manual_review
  if (cooling < 0) {
    const result = db.prepare(`
      INSERT INTO paused_campaign_improvements
        (campaign_id, meta_campaign_id, campaign_name, root_cause, pause_reason,
         pause_rule_code, original_budget, adset_id, review_run_id,
         cooling_days, status, max_attempts, strategy_1st, strategy_2nd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_review', ?, ?, ?)
    `).run(
      getCampaignInternalId(db, action.meta_campaign_id),
      action.meta_campaign_id, action.campaign_name,
      rootCause.code, action.reason, rootCause.ruleCode,
      Number(action.current_value) || 0, action.adset_id || null,
      reviewRunId, 0, MAX_ATTEMPTS, null, null
    );
    return { id: result.lastInsertRowid, status: "manual_review" };
  }

  const strategies = pickStrategies(db, rootCause.code);

  const result = db.prepare(`
    INSERT INTO paused_campaign_improvements
      (campaign_id, meta_campaign_id, campaign_name, root_cause, pause_reason,
       pause_rule_code, original_budget, adset_id, review_run_id,
       cooling_days, status, max_attempts, strategy_1st, strategy_2nd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cooling', ?, ?, ?)
  `).run(
    getCampaignInternalId(db, action.meta_campaign_id),
    action.meta_campaign_id, action.campaign_name,
    rootCause.code, action.reason, rootCause.ruleCode,
    Number(action.current_value) || 0, action.adset_id || null,
    reviewRunId, cooling,
    MAX_ATTEMPTS,
    strategies.first ? JSON.stringify(strategies.first) : null,
    strategies.second ? JSON.stringify(strategies.second) : null
  );

  return { id: result.lastInsertRowid, status: "cooling", cooling_days: cooling };
}

/**
 * 매일 10:00 KST 실행 — 자동 개선 파이프라인 메인 루프
 */
export async function runAutoImprovement() {
  const db = getDb();
  const results = { measured: [], improved: [], retried: [], manual: [], errors: [] };

  // Phase 1: 이전 시도 측정 (attempt 후 7일 경과한 것)
  await measurePreviousAttempts(db, results);

  // Phase 2: 쿨링 끝난 캠페인 처리
  await processEligibleCampaigns(db, results);

  // 결과 알림
  if (results.improved.length + results.retried.length + results.manual.length + results.errors.length > 0) {
    try {
      const message = formatImprovementReport(results);
      await sendViaOpenClaw(message);
    } catch (err) {
      console.error("[AutoImprove] Notification failed:", err.message);
    }
  }

  console.log(
    `[AutoImprove] Done — measured:${results.measured.length}, improved:${results.improved.length}, retried:${results.retried.length}, manual:${results.manual.length}, errors:${results.errors.length}`
  );

  return results;
}

/**
 * 자동 개선 추적 현황 조회
 */
export function getAutoImprovements(statusFilter = null) {
  const db = getDb();
  let sql = "SELECT * FROM paused_campaign_improvements";
  const params = [];
  if (statusFilter) {
    sql += " WHERE status = ?";
    params.push(statusFilter);
  }
  sql += " ORDER BY created_at DESC";
  return db.prepare(sql).all(...params);
}

/**
 * 개별 자동 개선 상세 조회
 */
export function getAutoImprovementDetail(id) {
  const db = getDb();
  return db.prepare("SELECT * FROM paused_campaign_improvements WHERE id = ?").get(id);
}

// ─── Phase 1: 이전 시도 측정 (verdict_phase 기반 3단계 대응) ───

async function measurePreviousAttempts(db, results) {
  // snapshot-service의 실시간 누적 측정이 verdict_phase를 자동 갱신하므로
  // 여기서는 verdict_phase를 읽어서 3단계로 대응한다
  const candidates = db.prepare(`
    SELECT p.*, il.id AS log_id, il.data_points, il.verdict_phase, il.result_verdict
    FROM paused_campaign_improvements p
    LEFT JOIN improvement_log il
      ON il.campaign_id = p.campaign_id
      AND il.created_at >= p.last_attempt_at
      AND il.verdict_phase IS NOT NULL
    WHERE p.status = 'attempted'
    ORDER BY p.last_attempt_at ASC
  `).all();

  for (const rec of candidates) {
    try {
      const campaign = db.prepare("SELECT roas FROM campaigns WHERE id = ?").get(rec.campaign_id);
      if (!campaign) continue;

      // 3단계 대응: verdict_phase에 따라 즉시 조치 여부 결정
      if (rec.verdict_phase === "final") {
        // 최종 확정 → 즉시 evaluateAndAct
        results.measured.push({ campaign: rec.campaign_name, verdict: rec.result_verdict, phase: "final" });
        evaluateAndAct(db, rec, campaign.roas, results);

      } else if (rec.verdict_phase === "early_signal") {
        // 조기 감지 (과거 패턴 80%+ 신뢰도) → 즉시 조치 가능
        results.measured.push({ campaign: rec.campaign_name, verdict: rec.result_verdict, phase: "early_signal" });
        evaluateAndAct(db, rec, campaign.roas, results);

      } else if (rec.verdict_phase === "preliminary" && (rec.data_points || 0) >= MIN_DAYS_FOR_ACTION) {
        // 예비 판정 (day 3+) + 강한 신호 → 조치 가능
        if (rec.result_verdict === "improved" || rec.result_verdict === "worsened") {
          results.measured.push({ campaign: rec.campaign_name, verdict: rec.result_verdict, phase: "preliminary" });
          evaluateAndAct(db, rec, campaign.roas, results);
        }
      }
      // pending이면 아직 데이터 축적 중 → 아무 것도 안 함
    } catch (err) {
      console.error(`[AutoImprove] Measure failed for ${rec.campaign_name}:`, err.message);
      results.errors.push({ campaign: rec.campaign_name, phase: "measure", error: err.message });
    }
  }
}

function evaluateAndAct(db, rec, currentRoas, results) {
  const improved = currentRoas > 1.0;  // ROAS > 1.0 = 수익 전환

  // 성장형 학습: 자동 개선 결과를 교훈으로 기록
  recordAutoImprovementLesson(db, rec, currentRoas, improved);

  if (improved) {
    // 개선됨 → resolved
    db.prepare("UPDATE paused_campaign_improvements SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(rec.id);
    results.improved.push({ campaign: rec.campaign_name, roas: currentRoas });
  } else if (rec.attempt_count < rec.max_attempts) {
    // 악화/변동 없음 + 시도 여유 있음 → 다시 정지 + 2차 시도 예약
    db.prepare("UPDATE paused_campaign_improvements SET status = 'cooling', updated_at = datetime('now') WHERE id = ?")
      .run(rec.id);
    results.retried.push({ campaign: rec.campaign_name, attempt: rec.attempt_count + 1 });
  } else {
    // 최대 시도 초과 → manual_review
    db.prepare("UPDATE paused_campaign_improvements SET status = 'manual_review', updated_at = datetime('now') WHERE id = ?")
      .run(rec.id);
    results.manual.push({ campaign: rec.campaign_name, reason: `${rec.max_attempts}회 시도 후 미개선` });
  }
}

/**
 * 성장형 학습: 자동 개선 시도 결과를 교훈으로 자동 기록
 */
function recordAutoImprovementLesson(db, rec, currentRoas, improved) {
  try {
    const strategyJson = rec.attempt_count === 0 ? rec.strategy_1st : rec.strategy_2nd;
    const strategy = strategyJson ? JSON.parse(strategyJson).join(" + ") : "unknown";
    const lessonType = improved ? "what_worked" : "what_failed";
    const description = improved
      ? `자동 개선 ${strategy} 적용 → ROAS ${currentRoas.toFixed(2)}x로 회복 (${rec.root_cause})`
      : `자동 개선 ${strategy} 적용 → ROAS ${currentRoas.toFixed(2)}x, 미개선 (${rec.root_cause})`;

    upsertLesson(db, {
      root_cause: rec.root_cause,
      lesson_type: lessonType,
      description,
      evidence_json: JSON.stringify({
        action_type: `auto_improve_attempt${rec.attempt_count + 1}`,
        strategy,
        campaign_name: rec.campaign_name,
        current_roas: currentRoas,
        attempt: rec.attempt_count + 1,
      }),
      campaign_count: 1,
      confidence: "low",
    });

    console.log(`[Learning] 자동 개선 교훈: ${lessonType} — ${description}`);
  } catch (err) {
    console.warn("[Learning] recordAutoImprovementLesson failed:", err.message);
  }
}

// ─── Phase 2: 쿨링 끝난 캠페인 처리 ───

async function processEligibleCampaigns(db, results) {
  // 쿨링 기간이 끝난 캠페인 ('cooling' 상태 + created_at 또는 updated_at + cooling_days 경과)
  const candidates = db.prepare(`
    SELECT * FROM paused_campaign_improvements
    WHERE status = 'cooling'
      AND review_run_id IS NOT NULL
      AND datetime(updated_at, '+' || cooling_days || ' days') <= datetime('now')
  `).all();

  if (candidates.length === 0) return;

  // Meta 인증 정보
  const creds = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials ORDER BY id DESC LIMIT 1").get();
  if (!creds?.access_token) {
    console.warn("[AutoImprove] No Meta credentials — skipping campaign improvements");
    return;
  }

  for (const rec of candidates) {
    try {
      await executeImprovement(db, creds, rec, results);
    } catch (err) {
      console.error(`[AutoImprove] Improvement failed for ${rec.campaign_name}:`, err.message);
      results.errors.push({ campaign: rec.campaign_name, phase: "execute", error: err.message });
    }
  }
}

async function executeImprovement(db, creds, rec, results) {
  const attempt = rec.attempt_count + 1;
  const strategyJson = attempt === 1 ? rec.strategy_1st : rec.strategy_2nd;

  if (!strategyJson) {
    // 전략 없음 → manual_review
    db.prepare("UPDATE paused_campaign_improvements SET status = 'manual_review', updated_at = datetime('now') WHERE id = ?")
      .run(rec.id);
    results.manual.push({ campaign: rec.campaign_name, reason: `${attempt}차 전략 없음` });
    return;
  }

  const steps = JSON.parse(strategyJson);

  // AdSet ID 확보
  let adsetId = rec.adset_id;
  if (!adsetId) {
    const { data: adsets } = await fetchAdSetsForCampaign(creds.access_token, rec.meta_campaign_id);
    if (!adsets?.length) {
      throw new Error("No adsets found for campaign");
    }
    adsetId = adsets[0].id;
    // 다음번을 위해 저장
    db.prepare("UPDATE paused_campaign_improvements SET adset_id = ? WHERE id = ?").run(adsetId, rec.id);
  }

  // 전략 단계별 실행
  for (const step of steps) {
    if (step === "budget_decrease_70") {
      const newBudget = Math.round(rec.original_budget * 0.7);
      const result = await updateAdSetBudget(creds.access_token, adsetId, newBudget);
      if (result.error) throw new Error(`Budget update failed: ${result.error}`);
      console.log(`[AutoImprove] ${rec.campaign_name}: budget ${rec.original_budget} → ${newBudget} (70%)`);
    } else if (step === "budget_decrease_50") {
      const newBudget = Math.round(rec.original_budget * 0.5);
      const result = await updateAdSetBudget(creds.access_token, adsetId, newBudget);
      if (result.error) throw new Error(`Budget update failed: ${result.error}`);
      console.log(`[AutoImprove] ${rec.campaign_name}: budget ${rec.original_budget} → ${newBudget} (50%)`);
    } else if (step === "targeting_broaden") {
      const broadTargeting = { geo_locations: { countries: ["KR"] }, age_min: 18, age_max: 65 };
      const result = await updateAdSetTargeting(creds.access_token, adsetId, broadTargeting);
      if (result.error) throw new Error(`Targeting update failed: ${result.error}`);
      console.log(`[AutoImprove] ${rec.campaign_name}: targeting broadened`);
    }
  }

  // 마지막: 캠페인 재개
  const resumeResult = await updateCampaignStatus(creds.access_token, rec.meta_campaign_id, "ACTIVE");
  if (resumeResult.error) throw new Error(`Resume failed: ${resumeResult.error}`);

  // improvement_log 기록 (before_roas 스냅샷)
  const campaign = db.prepare("SELECT roas, ctr FROM campaigns WHERE id = ?").get(rec.campaign_id);
  if (campaign) {
    db.prepare(`
      INSERT INTO improvement_log (campaign_id, action_type, action_description, before_roas, before_ctr)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      rec.campaign_id,
      `auto_improve_attempt${attempt}`,
      `자동 개선 ${attempt}차: ${steps.join(" + ")} → 재개 (근본 원인: ${rec.root_cause})`,
      campaign.roas, campaign.ctr
    );
  }

  // 상태 업데이트
  db.prepare(`
    UPDATE paused_campaign_improvements
    SET status = 'attempted', attempt_count = ?, last_attempt_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(attempt, rec.id);

  console.log(`[AutoImprove] ${rec.campaign_name}: ${attempt}차 시도 완료 — ${steps.join(" + ")} → 재개됨`);
}

// ─── 헬퍼 함수 ───

function parseRootCause(reason) {
  if (!reason) return { code: "unknown", cooling: 3, ruleCode: null };

  // [R1], [R1b], [R2], [R3], [R7] 패턴 매칭
  const match = reason.match(/\[R(\d+b?)\]/);
  if (match) {
    const ruleCode = `R${match[1]}`;
    const mapping = ROOT_CAUSE_MAP[ruleCode];
    if (mapping) return { ...mapping, ruleCode };
  }

  // 규칙 코드 없으면 키워드 기반 추론
  if (reason.includes("ROAS") && reason.includes("CPC")) return { code: "roas_low_cpc_high", cooling: 3, ruleCode: null };
  if (reason.includes("구매 0건") || reason.includes("전환 없")) return { code: "zero_purchases", cooling: 7, ruleCode: null };
  if (reason.includes("Frequency") || reason.includes("피로")) return { code: "frequency_fatigue", cooling: -1, ruleCode: null };
  if (reason.includes("ROAS")) return { code: "roas_low", cooling: 3, ruleCode: null };

  return { code: "unknown", cooling: 3, ruleCode: null };
}

function pickStrategies(db, rootCauseCode) {
  const defaults = DEFAULT_STRATEGIES[rootCauseCode] || DEFAULT_STRATEGIES.roas_low;

  // ─── 성장형 학습: postmortem_lessons에서 교훈 반영 ───
  let lessonOverrides = null;
  try {
    const lessons = db.prepare(
      "SELECT lesson_type, description, confidence, evidence_json FROM postmortem_lessons WHERE root_cause = ? ORDER BY campaign_count DESC LIMIT 10"
    ).all(rootCauseCode);

    if (lessons.length) {
      console.log(`[AutoImprove] 포스트모템 교훈 ${lessons.length}건 참고 (${rootCauseCode})`);
      lessonOverrides = applyLessonOverrides(defaults, lessons, rootCauseCode);
    }
  } catch { /* postmortem_lessons 테이블 없을 수 있음 */ }

  // 교훈에서 전략 오버라이드가 나왔으면 사용
  if (lessonOverrides) return lessonOverrides;

  // action_effectiveness에서 성공률 데이터 확인
  try {
    const rows = db.prepare(
      "SELECT action_type, success_rate, times_applied FROM action_effectiveness WHERE times_applied >= 3 ORDER BY success_rate DESC"
    ).all();

    // ─── 트렌드 기반 전략 수정자 (기존 전략 세트 내에서 순서만 변경) ───
    let trendMods = null;
    try { trendMods = getStrategyModifiers(); } catch { /* ignore */ }

    if (rows.length < 2) {
      if (trendMods?.prefer_broad_targeting && (rootCauseCode === "roas_low_cpc_high" || rootCauseCode === "cpc_high")) {
        console.log(`[AutoImprove] 트렌드 기반: Broad 타겟 우선 (${rootCauseCode})`);
        return {
          first: ["targeting_broaden", "budget_decrease_70"],
          second: ["budget_decrease_70"],
        };
      }
      return defaults;
    }

    // 성공률 기반으로 전략 순서 조정
    const budgetSuccess = rows.find(r => r.action_type === "budget_decrease")?.success_rate || 0;
    const targetSuccess = rows.find(r => r.action_type === "targeting_broaden")?.success_rate || 0;

    if (rootCauseCode === "roas_low_cpc_high" || rootCauseCode === "cpc_high") {
      const threshold = trendMods?.prefer_broad_targeting ? 0.3 : 0.5;
      if (targetSuccess > budgetSuccess && targetSuccess > threshold) {
        return {
          first: ["targeting_broaden", "budget_decrease_70"],
          second: ["budget_decrease_70"],
        };
      }
    }

    return defaults;
  } catch {
    return defaults;
  }
}

/**
 * 성장형 학습: 교훈을 기반으로 전략 순서 조정
 * what_failed → 해당 전략 후순위 / what_worked → 해당 전략 우선
 */
function applyLessonOverrides(defaults, lessons, rootCauseCode) {
  const failed = lessons.filter(l => l.lesson_type === "what_failed" && (l.confidence === "high" || l.confidence === "medium"));
  const worked = lessons.filter(l => l.lesson_type === "what_worked" && (l.confidence === "high" || l.confidence === "medium"));

  if (failed.length === 0 && worked.length === 0) return null;

  // 실패한 전략들의 action_type 수집
  const failedActions = new Set();
  for (const f of failed) {
    try {
      const evidence = JSON.parse(f.evidence_json || "{}");
      if (evidence.action_type) failedActions.add(evidence.action_type);
      if (evidence.strategy) {
        for (const s of evidence.strategy.split(" + ")) failedActions.add(s.trim());
      }
    } catch { /* ignore */ }
  }

  // 성공한 전략들의 action_type 수집
  const workedActions = new Set();
  for (const w of worked) {
    try {
      const evidence = JSON.parse(w.evidence_json || "{}");
      if (evidence.action_type) workedActions.add(evidence.action_type);
      if (evidence.strategy) {
        for (const s of evidence.strategy.split(" + ")) workedActions.add(s.trim());
      }
    } catch { /* ignore */ }
  }

  // 기본 전략의 1차/2차를 조정
  let first = defaults.first ? [...defaults.first] : null;
  let second = defaults.second ? [...defaults.second] : null;

  let modified = false;

  // 1차 전략에 실패 전략이 있으면 → 1차에서 제거, 2차로 이동
  if (first) {
    const hasFailedInFirst = first.some(s => failedActions.has(s));
    if (hasFailedInFirst && second) {
      console.log(`[AutoImprove] 교훈 반영: 1차 전략에서 실패 이력 감지, 2차로 교체`);
      [first, second] = [second, first];
      modified = true;
    }
  }

  // CPC 관련 root_cause에서 targeting_broaden이 성공한 적 있으면 우선
  if ((rootCauseCode === "roas_low_cpc_high" || rootCauseCode === "cpc_high") && workedActions.has("targeting_broaden")) {
    if (first && !first.includes("targeting_broaden")) {
      console.log(`[AutoImprove] 교훈 반영: targeting_broaden 성공 이력, 1차에 추가`);
      first = ["targeting_broaden", ...first.filter(s => s !== "targeting_broaden")];
      modified = true;
    }
  }

  return modified ? { first, second } : null;
}

function getCampaignInternalId(db, metaCampaignId) {
  const row = db.prepare("SELECT id FROM campaigns WHERE meta_campaign_id = ?").get(metaCampaignId);
  return row?.id || 0;
}

function getVerdict(beforeRoas, afterRoas) {
  if (afterRoas === null || afterRoas === undefined) return null;
  const diff = afterRoas - beforeRoas;
  if (diff > 0.1) return "improved";
  if (diff < -0.1) return "worsened";
  return "unchanged";
}

function formatImprovementReport(results) {
  const lines = [];
  lines.push("🔧 자동 개선 파이프라인 보고");
  lines.push("");

  if (results.improved.length > 0) {
    lines.push(`✅ 개선 완료: ${results.improved.length}건`);
    for (const r of results.improved) {
      lines.push(`  ${r.campaign} → ROAS ${r.roas?.toFixed(2)}x`);
    }
    lines.push("");
  }

  if (results.retried.length > 0) {
    lines.push(`🔄 재시도 예약: ${results.retried.length}건`);
    for (const r of results.retried) {
      lines.push(`  ${r.campaign} → ${r.attempt}차 시도 준비`);
    }
    lines.push("");
  }

  if (results.manual.length > 0) {
    lines.push(`⚠️ 수동 리뷰 필요: ${results.manual.length}건`);
    for (const r of results.manual) {
      lines.push(`  ${r.campaign}: ${r.reason}`);
    }
    lines.push("");
  }

  if (results.errors.length > 0) {
    lines.push(`❌ 오류: ${results.errors.length}건`);
    for (const r of results.errors) {
      lines.push(`  ${r.campaign}: ${r.error}`);
    }
  }

  if (results.measured.length > 0) {
    lines.push("");
    lines.push(`📊 측정 완료: ${results.measured.length}건`);
    for (const r of results.measured) {
      const emoji = r.verdict === "improved" ? "📈" : r.verdict === "worsened" ? "📉" : "➡️";
      lines.push(`  ${emoji} ${r.campaign}: ROAS ${r.before?.toFixed(2)} → ${r.after?.toFixed(2)} (${r.verdict})`);
    }
  }

  return lines.join("\n");
}

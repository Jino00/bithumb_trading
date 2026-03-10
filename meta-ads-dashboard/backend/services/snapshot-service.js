// 캠페인 성과 스냅샷 서비스 — 일별 기록 + 개선 효과 추적 + 트렌드 인텔리전스 트리거 + 성장형 학습
import { getDb } from "../db/database.js";
import { recomputeAll } from "./trend-intelligence.js";
import { roundN } from "./biz-metrics.js";
import { upsertLesson } from "./postmortem-service.js";

/**
 * 현재 모든 active Meta 캠페인의 스냅샷을 기록
 * 이미 오늘 기록이 있으면 업데이트
 */
export function takeSnapshotAll() {
  const db = getDb();
  const today = new Date().toISOString().substring(0, 10);
  const campaigns = db.prepare("SELECT * FROM campaigns WHERE source = 'meta' AND status = 'active'").all();

  if (campaigns.length === 0) {
    return { recorded: 0, date: today, message: "No active Meta campaigns" };
  }

  const upsert = db.prepare(`
    INSERT INTO campaign_snapshots
      (campaign_id, meta_campaign_id, snapshot_date, roas, ctr, cpc, frequency, spend, revenue, purchases, cpa, aov,
       clicks, landing_page_views, content_views, add_to_cart_count, initiate_checkout_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(campaign_id, snapshot_date)
    DO UPDATE SET
      roas=excluded.roas, ctr=excluded.ctr, cpc=excluded.cpc, frequency=excluded.frequency,
      spend=excluded.spend, revenue=excluded.revenue, purchases=excluded.purchases,
      cpa=excluded.cpa, aov=excluded.aov, clicks=excluded.clicks,
      landing_page_views=excluded.landing_page_views, content_views=excluded.content_views,
      add_to_cart_count=excluded.add_to_cart_count, initiate_checkout_count=excluded.initiate_checkout_count,
      created_at=datetime('now')
  `);

  const snapshot = db.transaction((items) => {
    let count = 0;
    for (const c of items) {
      upsert.run(
        c.id,
        c.meta_campaign_id || null,
        today,
        c.roas || 0,
        c.ctr || 0,
        c.cpc || 0,
        c.frequency || 0,
        c.total_spend || 0,
        c.revenue || 0,
        c.purchase_count || 0,
        c.cpa || 0,
        c.aov || 0,
        c.clicks || 0,
        c.landing_page_views || 0,
        c.content_views || 0,
        c.add_to_cart_count || 0,
        c.initiate_checkout_count || 0
      );
      count++;
    }
    return count;
  });

  const recorded = snapshot(campaigns);
  measureImprovements(db, today);

  // 스냅샷 후 벤치마크 + 트렌드 재계산 (학습 데이터 갱신)
  let intelligence = { benchmarks: 0, trends: 0, effectiveness: 0 };
  try {
    intelligence = recomputeAll();
  } catch (err) {
    console.error("[Snapshot] Trend intelligence recompute failed:", err.message);
  }

  return { recorded, date: today, intelligence };
}

// ─── 실시간 누적 측정 + 조기 감지 시스템 ───

const MEASUREMENT_CONFIG = {
  MIN_DAYS_FINAL: 7,            // 최종판정 기본 일수
  MAX_TRACKING_DAYS: 30,        // 추적 최대 일수
  IMPROVED_THRESHOLD: 10,       // % 이상 → improved
  WORSENED_THRESHOLD: -10,      // % 이하 → worsened
  EARLY_SIGNAL_CONFIDENCE: 0.8, // 조기 감지에 필요한 패턴 매칭 신뢰도 (80%)
  MIN_PATTERN_SAMPLES: 3,       // 조기 감지 패턴에 필요한 최소 과거 사례 수
  TRAJECTORY_TOLERANCE: 0.2,    // 유사 궤적 판단 허용 범위 (roas_change ±0.2)
};

/**
 * 실시간 누적 측정: 매 스냅샷마다 pending 개선 로그의 일별 데이터를 축적하고
 * 조기 감지 / 예비판정 / 최종판정을 유연하게 수행한다.
 */
function measureImprovements(db, today) {
  const pendingLogs = getPendingLogs(db);
  if (pendingLogs.length === 0) return;

  const measureAll = db.transaction((logs) => {
    for (const log of logs) {
      const recorded = recordDailyMetric(db, log, today);
      if (recorded) updateVerdictIfReady(db, log, today);
    }
  });
  measureAll(pendingLogs);
}

/** verdict_phase가 final이 아닌 모든 개선 로그 (1~30일 범위) */
function getPendingLogs(db) {
  const oneDayAgo = getDateNDaysAgo(1);
  const maxAgo = getDateNDaysAgo(MEASUREMENT_CONFIG.MAX_TRACKING_DAYS);
  return db.prepare(`
    SELECT il.*, c.roas AS current_roas, c.ctr AS current_ctr
    FROM improvement_log il
    JOIN campaigns c ON c.id = il.campaign_id
    WHERE (il.verdict_phase IS NULL OR il.verdict_phase NOT IN ('final'))
      AND date(il.created_at) <= date(?)
      AND date(il.created_at) >= date(?)
  `).all(oneDayAgo, maxAgo);
}

/** 오늘의 campaign_snapshots → improvement_daily_metrics에 기록 */
function recordDailyMetric(db, log, today) {
  try {
    const snapshot = db.prepare(
      "SELECT * FROM campaign_snapshots WHERE campaign_id = ? AND snapshot_date = ?"
    ).get(log.campaign_id, today);
    if (!snapshot) return false;

    const dayNumber = daysBetween(log.created_at, today);
    if (dayNumber < 1) return false;

    const roasChange = roundN((snapshot.roas || 0) - (log.before_roas || 0));
    const ctrChange = roundN((snapshot.ctr || 0) - (log.before_ctr || 0));

    db.prepare(`
      INSERT INTO improvement_daily_metrics
        (improvement_log_id, campaign_id, day_number, snapshot_date,
         roas, ctr, cpc, spend, revenue, purchases, roas_change, ctr_change)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(improvement_log_id, snapshot_date) DO UPDATE SET
        roas=excluded.roas, ctr=excluded.ctr, cpc=excluded.cpc,
        roas_change=excluded.roas_change, ctr_change=excluded.ctr_change
    `).run(
      log.id, log.campaign_id, dayNumber, today,
      snapshot.roas, snapshot.ctr, snapshot.cpc,
      snapshot.spend, snapshot.revenue, snapshot.purchases,
      roasChange, ctrChange
    );

    // data_points 카운트 업데이트
    const pts = db.prepare(
      "SELECT COUNT(*) as cnt FROM improvement_daily_metrics WHERE improvement_log_id = ?"
    ).get(log.id);
    db.prepare("UPDATE improvement_log SET data_points = ? WHERE id = ?").run(pts.cnt, log.id);
    log.data_points = pts.cnt;
    return true;
  } catch (err) {
    console.warn("[Measure] recordDailyMetric failed:", err.message);
    return false;
  }
}

/**
 * 유연한 판정 로직:
 * - pending → early_signal (과거 패턴 매칭 80%+, 즉시 가능)
 * - pending → preliminary (day 3+, 추세 기반)
 * - pending/preliminary/early_signal → final (day 7+, 확정)
 */
function updateVerdictIfReady(db, log, today) {
  try {
    const dailyMetrics = db.prepare(
      "SELECT * FROM improvement_daily_metrics WHERE improvement_log_id = ? ORDER BY day_number ASC"
    ).all(log.id);
    if (dailyMetrics.length === 0) return;

    const currentPhase = log.verdict_phase || "pending";

    // Step 1: 조기 감지 시도 (pending 상태에서만)
    if (currentPhase === "pending") {
      const earlySignal = matchHistoricalPattern(db, log, dailyMetrics);
      if (earlySignal) {
        db.prepare(
          "UPDATE improvement_log SET result_verdict = ?, verdict_phase = 'early_signal' WHERE id = ?"
        ).run(earlySignal.verdict, log.id);
        console.log(`[EarlySignal] ${log.action_type} day${dailyMetrics.length}: ${earlySignal.verdict} (${(earlySignal.confidence * 100).toFixed(0)}% 신뢰도, ${earlySignal.samples}건 근거)`);
        log.verdict_phase = "early_signal";
        log.result_verdict = earlySignal.verdict;
      }
    }

    // Step 2: 일반 판정
    const dayCount = dailyMetrics.length;
    if (dayCount >= MEASUREMENT_CONFIG.MIN_DAYS_FINAL) {
      // day 7+: 최종 확정
      finalizeVerdict(db, log, dailyMetrics, today);
    } else if (dayCount >= 3 && currentPhase === "pending") {
      // day 3~6: 예비 판정 (조기 감지 안 됐으면)
      const trendVerdict = computeTrendVerdict(dailyMetrics, log.before_roas);
      db.prepare(
        "UPDATE improvement_log SET result_verdict = ?, verdict_phase = 'preliminary' WHERE id = ?"
      ).run(trendVerdict, log.id);
    }
  } catch (err) {
    console.warn("[Measure] updateVerdictIfReady failed:", err.message);
  }
}

/** 최종 판정: after_roas 기록 + 교훈 1회 기록 + 조기감지 정확도 기록 */
function finalizeVerdict(db, log, dailyMetrics, today) {
  const trendVerdict = computeTrendVerdict(dailyMetrics, log.before_roas);
  const latest = dailyMetrics[dailyMetrics.length - 1];

  db.prepare(`
    UPDATE improvement_log
    SET after_roas = ?, after_ctr = ?, result_verdict = ?,
        verdict_phase = 'final', measured_at = ?
    WHERE id = ?
  `).run(latest.roas, latest.ctr, trendVerdict, today, log.id);

  // 교훈 기록 (1회만 — lesson_recorded_at 체크)
  if (!log.lesson_recorded_at) {
    recordLessonFromVerdict(db, log, trendVerdict, latest.roas, latest.ctr);

    // 조기 감지가 있었다면 정확도도 기록
    if (log.verdict_phase === "early_signal" && log.result_verdict) {
      recordEarlySignalAccuracy(db, log, trendVerdict);
    }

    db.prepare("UPDATE improvement_log SET lesson_recorded_at = ? WHERE id = ?").run(today, log.id);
  }
}

/**
 * ⭐ 핵심: 과거 완료 사례의 같은 day_number 궤적과 비교하여 조기 예측
 * 같은 action_type + root_cause의 과거 final 사례에서
 * 현재와 비슷한 roas_change 궤적(±tolerance)인 것들의 최종 verdict 비율로 판정
 */
function matchHistoricalPattern(db, log, currentMetrics) {
  try {
    const latestMetric = currentMetrics[currentMetrics.length - 1];
    const dayNum = latestMetric.day_number;

    // 같은 action_type + root_cause의 과거 완료 사례
    const pastLogs = db.prepare(`
      SELECT il.id, il.result_verdict FROM improvement_log il
      WHERE il.action_type = ? AND il.verdict_phase = 'final'
        AND il.result_verdict IS NOT NULL AND il.id != ?
        ${log.root_cause ? "AND il.root_cause = ?" : ""}
    `).all(...(log.root_cause
      ? [log.action_type, log.id, log.root_cause]
      : [log.action_type, log.id]));

    if (pastLogs.length < MEASUREMENT_CONFIG.MIN_PATTERN_SAMPLES) return null;

    const tolerance = MEASUREMENT_CONFIG.TRAJECTORY_TOLERANCE;
    const currentChange = latestMetric.roas_change || 0;
    let matchingVerdicts = [];

    for (const past of pastLogs) {
      const pastMetric = db.prepare(
        "SELECT roas_change FROM improvement_daily_metrics WHERE improvement_log_id = ? AND day_number = ?"
      ).get(past.id, dayNum);
      if (!pastMetric) continue;

      // 유사 궤적: roas_change가 ±tolerance 이내
      if (Math.abs((pastMetric.roas_change || 0) - currentChange) <= tolerance) {
        matchingVerdicts.push(past.result_verdict);
      }
    }

    if (matchingVerdicts.length < MEASUREMENT_CONFIG.MIN_PATTERN_SAMPLES) return null;

    // 가장 많은 verdict의 비율 계산
    const counts = {};
    for (const v of matchingVerdicts) counts[v] = (counts[v] || 0) + 1;
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const confidence = dominant[1] / matchingVerdicts.length;

    if (confidence >= MEASUREMENT_CONFIG.EARLY_SIGNAL_CONFIDENCE) {
      return { verdict: dominant[0], confidence, samples: matchingVerdicts.length };
    }
    return null;
  } catch (err) {
    console.warn("[EarlySignal] matchHistoricalPattern failed:", err.message);
    return null;
  }
}

/** 최근 3일 평균 ROAS → baseline 대비 % 변화로 verdict 산출 */
function computeTrendVerdict(dailyMetrics, baselineRoas) {
  if (dailyMetrics.length === 0) return "unchanged";
  const window = Math.min(3, dailyMetrics.length);
  const recent = dailyMetrics.slice(-window);
  const avgRecentRoas = recent.reduce((s, m) => s + (m.roas || 0), 0) / recent.length;
  const changePct = baselineRoas > 0
    ? ((avgRecentRoas - baselineRoas) / baselineRoas) * 100 : 0;
  if (changePct > MEASUREMENT_CONFIG.IMPROVED_THRESHOLD) return "improved";
  if (changePct < MEASUREMENT_CONFIG.WORSENED_THRESHOLD) return "worsened";
  return "unchanged";
}

/** 조기 감지 정확도를 postmortem_lessons에 기록 (시스템 자기 평가) */
function recordEarlySignalAccuracy(db, log, finalVerdict) {
  try {
    const matched = log.result_verdict === finalVerdict;
    upsertLesson(db, {
      root_cause: "early_signal_accuracy",
      lesson_type: matched ? "what_worked" : "what_failed",
      description: matched
        ? `조기 감지 정확: ${log.action_type} → ${finalVerdict} (day 1~2에서 예측 성공)`
        : `조기 감지 오류: ${log.action_type} → 예측 ${log.result_verdict}, 실제 ${finalVerdict}`,
      evidence_json: JSON.stringify({
        action_type: log.action_type, root_cause: log.root_cause,
        early_verdict: log.result_verdict, final_verdict: finalVerdict,
      }),
      campaign_count: 1,
      confidence: "low",
    });
  } catch (err) {
    console.warn("[EarlySignal] accuracy recording failed:", err.message);
  }
}

/** 두 날짜 문자열 사이의 일수 계산 */
function daysBetween(dateStr, today) {
  const d1 = new Date(dateStr.substring(0, 10));
  const d2 = new Date(today);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

/**
 * 캠페인의 최근 N일 스냅샷 조회
 */
export function getCampaignSnapshots(campaignId, days = 30) {
  const db = getDb();
  const since = getDateNDaysAgo(days);

  return db.prepare(`
    SELECT * FROM campaign_snapshots
    WHERE campaign_id = ? AND snapshot_date >= ?
    ORDER BY snapshot_date ASC
  `).all(campaignId, since);
}

/**
 * 캠페인의 성과 트렌드 분석
 */
export function getCampaignTrend(campaignId) {
  const snapshots = getCampaignSnapshots(campaignId, 30);
  if (snapshots.length < 2) {
    return { snapshots, trend: "insufficient_data", change_7d: null, change_30d: null };
  }

  const latest = snapshots[snapshots.length - 1];
  const oneWeekAgo = snapshots.find(
    (s) => s.snapshot_date <= getDateNDaysAgo(7)
  ) || snapshots[0];
  const oldest = snapshots[0];

  const change7d = computeChange(oneWeekAgo, latest);
  const change30d = computeChange(oldest, latest);

  // 추이 판단
  let trend = "stable";
  if (change7d.roas > 0.1 && change7d.ctr > 0) trend = "improving";
  else if (change7d.roas < -0.1 && change7d.ctr < 0) trend = "declining";

  return { snapshots, trend, change_7d: change7d, change_30d: change30d };
}

function computeChange(before, after) {
  return {
    roas: roundN(after.roas - before.roas),
    ctr: roundN(after.ctr - before.ctr),
    cpc: roundN(after.cpc - before.cpc),
    cpa: roundN((after.cpa || 0) - (before.cpa || 0)),
    spend: roundN((after.spend || 0) - (before.spend || 0)),
    revenue: roundN((after.revenue || 0) - (before.revenue || 0)),
  };
}

/**
 * 개선 조치 기록
 */
export function logImprovement(campaignId, actionType, description) {
  const db = getDb();
  const campaign = db.prepare("SELECT roas, ctr FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  return db.prepare(`
    INSERT INTO improvement_log (campaign_id, action_type, action_description, before_roas, before_ctr)
    VALUES (?, ?, ?, ?, ?)
  `).run(campaignId, actionType, description, campaign.roas, campaign.ctr);
}

/**
 * 캠페인의 개선 이력 + 효과 조회
 */
export function getImprovementHistory(campaignId) {
  const db = getDb();
  const improvements = db.prepare(`
    SELECT * FROM improvement_log
    WHERE campaign_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(campaignId);

  const measured = improvements.filter((i) => i.result_verdict);
  const improved = measured.filter((i) => i.result_verdict === "improved").length;
  const successRate = measured.length > 0
    ? `${Math.round((improved / measured.length) * 100)}%`
    : "N/A";

  // 가장 효과적인 조치 유형 찾기
  const actionResults = {};
  for (const imp of measured) {
    if (!actionResults[imp.action_type]) {
      actionResults[imp.action_type] = { success: 0, total: 0 };
    }
    actionResults[imp.action_type].total += 1;
    if (imp.result_verdict === "improved") {
      actionResults[imp.action_type].success += 1;
    }
  }

  let bestAction = null;
  let bestRate = 0;
  for (const [type, stats] of Object.entries(actionResults)) {
    const rate = stats.total > 0 ? stats.success / stats.total : 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestAction = type;
    }
  }

  return {
    improvements,
    success_rate: successRate,
    best_action: bestAction,
    action_breakdown: actionResults,
  };
}

/**
 * 성장형 학습: 측정 결과를 교훈으로 자동 기록
 * verdict가 나올 때마다 postmortem_lessons에 쌓여서 시스템이 점점 똑똑해짐
 */
function recordLessonFromVerdict(db, log, verdict, currentRoas, currentCtr) {
  try {
    const roasChange = roundN((currentRoas || 0) - (log.before_roas || 0));
    const ctrChange = roundN((currentCtr || 0) - (log.before_ctr || 0));

    // improvement_log에 change_detail 저장
    db.prepare("UPDATE improvement_log SET change_detail = ? WHERE id = ?")
      .run(JSON.stringify({ roas_change: roasChange, ctr_change: ctrChange }), log.id);

    // 교훈 타입 결정
    const rootCause = log.root_cause || "unknown";
    const lessonType = verdict === "improved" ? "what_worked"
                     : verdict === "worsened" ? "what_failed"
                     : "pattern";

    // 교훈 설명 생성
    const actionLabel = log.action_type || "unknown";
    let description;
    if (verdict === "improved") {
      description = `${actionLabel} 적용 후 ROAS ${roasChange >= 0 ? "+" : ""}${roasChange}x 개선`;
    } else if (verdict === "worsened") {
      description = `${actionLabel} 적용 후 ROAS ${roasChange}x 악화 — 이 조치는 ${rootCause} 상황에서 비효과적`;
    } else {
      description = `${actionLabel} 적용 후 변화 미미 (ROAS ${roasChange >= 0 ? "+" : ""}${roasChange}x)`;
    }

    upsertLesson(db, {
      root_cause: rootCause,
      lesson_type: lessonType,
      description,
      evidence_json: JSON.stringify({
        action_type: log.action_type,
        strategy: log.strategy_applied,
        before_roas: log.before_roas,
        after_roas: currentRoas,
        roas_change: roasChange,
        ctr_change: ctrChange,
        funnel_stage: log.funnel_stage,
      }),
      campaign_count: 1,
      confidence: "low",
    });

    console.log(`[Learning] 교훈 자동 기록: ${lessonType} — ${description}`);
  } catch (err) {
    console.warn("[Learning] recordLessonFromVerdict failed:", err.message);
  }
}

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

// roundN() 삭제 → roundN() from biz-metrics.js (SSOT)

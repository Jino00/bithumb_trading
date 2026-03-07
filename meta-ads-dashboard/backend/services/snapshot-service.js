// 캠페인 성과 스냅샷 서비스 — 일별 기록 + 개선 효과 추적 + 트렌드 인텔리전스 트리거
import { getDb } from "../db/database.js";
import { recomputeAll } from "./trend-intelligence.js";

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

/**
 * 7일 전에 기록된 improvement_log의 효과를 측정
 */
function measureImprovements(db, today) {
  const sevenDaysAgo = getDateNDaysAgo(7);

  const pendingLogs = db.prepare(`
    SELECT il.*, c.roas AS current_roas, c.ctr AS current_ctr
    FROM improvement_log il
    JOIN campaigns c ON c.id = il.campaign_id
    WHERE il.after_roas IS NULL
      AND il.created_at <= ?
      AND il.created_at >= ?
  `).all(sevenDaysAgo, getDateNDaysAgo(30));

  if (pendingLogs.length === 0) return;

  const update = db.prepare(`
    UPDATE improvement_log
    SET after_roas = ?, after_ctr = ?, result_verdict = ?, measured_at = ?
    WHERE id = ?
  `);

  const measureAll = db.transaction((logs) => {
    for (const log of logs) {
      const verdict = getImprovementVerdict(log.before_roas, log.current_roas);
      update.run(log.current_roas, log.current_ctr, verdict, today, log.id);
    }
  });

  measureAll(pendingLogs);
}

function getImprovementVerdict(before, after) {
  if (!before || !after) return "unchanged";
  const change = ((after - before) / Math.max(before, 0.01)) * 100;
  if (change > 10) return "improved";
  if (change < -10) return "worsened";
  return "unchanged";
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
    roas: round2(after.roas - before.roas),
    ctr: round2(after.ctr - before.ctr),
    cpc: round2(after.cpc - before.cpc),
    cpa: round2((after.cpa || 0) - (before.cpa || 0)),
    spend: round2((after.spend || 0) - (before.spend || 0)),
    revenue: round2((after.revenue || 0) - (before.revenue || 0)),
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

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

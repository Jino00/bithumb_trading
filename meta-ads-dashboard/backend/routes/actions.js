// 액션 큐 API — 일일 리뷰 결과 조회 / 승인 / 거부 / 실행
import { Router } from "express";
import { getDb } from "../db/database.js";
import { updateCampaignStatus, updateAdSetBudget, fetchAdSetsForCampaign, updateAdSetTargeting } from "../services/meta-api.js";
import { runDailyReview } from "../services/daily-review.js";
import { sendTestNotification } from "../services/notification.js";
import { logImprovement } from "../services/snapshot-service.js";
import { assessDataMaturity } from "../services/trend-intelligence.js";

const router = Router();

// ─── 조회 ───

/** 전체 액션 목록 (status 필터 지원) */
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const { status, limit = 50 } = req.query;
    let sql = "SELECT * FROM action_queue";
    const params = [];
    if (status) {
      sql += " WHERE status = ?";
      params.push(status);
    }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(Number(limit));
    const actions = db.prepare(sql).all(...params);
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** pending 액션만 조회 */
router.get("/pending", (_req, res) => {
  try {
    const db = getDb();
    const actions = db.prepare("SELECT * FROM action_queue WHERE status = 'pending' ORDER BY created_at DESC").all();
    res.json(actions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 리뷰 실행 기록 조회 */
router.get("/runs", (req, res) => {
  try {
    const db = getDb();
    const { limit = 30 } = req.query;
    const runs = db.prepare("SELECT * FROM review_runs ORDER BY created_at DESC LIMIT ?").all(Number(limit));
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 승인/거부 ───

/** 개별 액션 승인 */
router.post("/:id/approve", (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const action = db.prepare("SELECT * FROM action_queue WHERE id = ?").get(id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    if (action.status !== "pending") return res.status(400).json({ error: `Cannot approve action with status '${action.status}'` });

    db.prepare("UPDATE action_queue SET status = 'approved', acted_at = datetime('now') WHERE id = ?").run(id);
    updateRunCounters(db, action.review_run_id);
    res.json({ success: true, id: Number(id), status: "approved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 개별 액션 거부 */
router.post("/:id/reject", (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const action = db.prepare("SELECT * FROM action_queue WHERE id = ?").get(id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    if (action.status !== "pending") return res.status(400).json({ error: `Cannot reject action with status '${action.status}'` });

    db.prepare("UPDATE action_queue SET status = 'rejected', acted_at = datetime('now') WHERE id = ?").run(id);
    res.json({ success: true, id: Number(id), status: "rejected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 전체 pending 일괄 승인 */
router.post("/approve-all", (_req, res) => {
  try {
    const db = getDb();
    const result = db.prepare("UPDATE action_queue SET status = 'approved', acted_at = datetime('now') WHERE status = 'pending'").run();
    // review_runs 카운터 업데이트
    const runIds = db.prepare("SELECT DISTINCT review_run_id FROM action_queue WHERE status = 'approved' AND acted_at IS NOT NULL").all();
    for (const { review_run_id } of runIds) {
      if (review_run_id) updateRunCounters(db, review_run_id);
    }
    res.json({ success: true, approved_count: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 실행 ───

/** 개별 승인 액션 실행 (Meta API 호출) */
router.post("/:id/execute", async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const action = db.prepare("SELECT * FROM action_queue WHERE id = ?").get(id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    if (action.status !== "approved") return res.status(400).json({ error: `Can only execute 'approved' actions, current: '${action.status}'` });

    const result = await executeAction(db, action);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 승인된 액션 일괄 실행 */
router.post("/execute-all", async (_req, res) => {
  try {
    const db = getDb();
    const actions = db.prepare("SELECT * FROM action_queue WHERE status = 'approved'").all();
    if (actions.length === 0) return res.json({ executed: 0, failed: 0, results: [] });

    const results = [];
    for (const action of actions) {
      const result = await executeAction(db, action);
      results.push(result);
    }

    const executed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    res.json({ executed, failed, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 수동 조치 완료 (creative_refresh 등 자동 실행 불가 액션용) */
router.post("/:id/complete-manual", (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const action = db.prepare("SELECT * FROM action_queue WHERE id = ?").get(id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    if (action.status !== "manual_pending") {
      return res.status(400).json({ error: `수동 완료는 'manual_pending' 상태에서만 가능합니다 (현재: '${action.status}')` });
    }

    db.prepare("UPDATE action_queue SET status = 'executed', execution_result = ? WHERE id = ?")
      .run(JSON.stringify({ manual_completed: true, completed_at: new Date().toISOString() }), action.id);
    if (action.review_run_id) updateRunCounters(db, action.review_run_id);

    // 이미 autoLogImprovement가 execute 시점에 호출되어 before_roas가 기록됨
    // 7일 후 measureImprovements()가 자동으로 after_roas를 측정
    res.json({ success: true, id: Number(id), status: "executed", message: "수동 조치 완료 — 7일 후 개선 효과가 자동 측정됩니다." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 수동 리뷰 트리거 */
router.post("/run-review", async (_req, res) => {
  try {
    const result = await runDailyReview();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 알림 설정 ───

// ─── 개선 결과 + 학습 상태 ───

/** 개별 액션의 개선 효과 조회 (improvement_log 연동) */
router.get("/:id/improvement", (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const action = db.prepare("SELECT * FROM action_queue WHERE id = ?").get(id);
    if (!action) return res.status(404).json({ error: "Action not found" });
    if (!action.improvement_log_id) return res.json({ measured: false, message: "No improvement log linked" });

    const log = db.prepare("SELECT * FROM improvement_log WHERE id = ?").get(action.improvement_log_id);
    if (!log) return res.json({ measured: false, message: "Improvement log not found" });

    const measured = log.after_roas !== null && log.after_roas !== undefined;
    res.json({
      measured,
      before_roas: log.before_roas,
      after_roas: log.after_roas,
      before_ctr: log.before_ctr,
      after_ctr: log.after_ctr,
      roas_change: measured ? Math.round((log.after_roas - log.before_roas) * 100) / 100 : null,
      ctr_change: measured && log.after_ctr ? Math.round((log.after_ctr - log.before_ctr) * 100) / 100 : null,
      result_verdict: log.result_verdict,
      created_at: log.created_at,
      measured_at: log.measured_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 학습 시스템 상태 조회 (데이터 성숙도 + 액션별 성공률) */
router.get("/learning-status", (_req, res) => {
  try {
    const db = getDb();
    let maturity = null;
    try {
      maturity = assessDataMaturity(db);
    } catch { /* 데이터 부족 시 null */ }

    const effectiveness = db.prepare(
      "SELECT action_type, diagnosis_stage, times_applied, times_improved, times_unchanged, times_worsened, success_rate, avg_roas_change FROM action_effectiveness ORDER BY times_applied DESC"
    ).all();

    const pendingMeasurements = db.prepare(
      "SELECT COUNT(*) as cnt FROM improvement_log WHERE after_roas IS NULL AND created_at >= datetime('now', '-30 days')"
    ).get()?.cnt || 0;

    res.json({ maturity, effectiveness, pending_measurements: pendingMeasurements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 알림 설정 ───

/** 알림 설정 조회 */
router.get("/notification-config", (_req, res) => {
  try {
    const db = getDb();
    const configs = db.prepare("SELECT * FROM notification_config ORDER BY id").all();
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 알림 설정 저장/업데이트 */
router.post("/notification-config", (req, res) => {
  try {
    const db = getDb();
    const { channel, webhook_url, enabled = 1 } = req.body;
    if (!channel || !webhook_url) return res.status(400).json({ error: "channel and webhook_url required" });

    // 같은 채널이 있으면 업데이트, 없으면 삽입
    const existing = db.prepare("SELECT id FROM notification_config WHERE channel = ?").get(channel);
    if (existing) {
      db.prepare("UPDATE notification_config SET webhook_url = ?, enabled = ? WHERE id = ?").run(webhook_url, enabled ? 1 : 0, existing.id);
    } else {
      db.prepare("INSERT INTO notification_config (channel, webhook_url, enabled) VALUES (?, ?, ?)").run(channel, webhook_url, enabled ? 1 : 0);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 알림 테스트 발송 */
router.post("/notification-test", async (req, res) => {
  try {
    const { webhook_url, channel = "openclaw" } = req.body;
    if (!webhook_url) return res.status(400).json({ error: "webhook_url required" });
    const result = await sendTestNotification(webhook_url, channel);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 내부 헬퍼 ───

async function executeAction(db, action) {
  const creds = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials ORDER BY id DESC LIMIT 1").get();
  if (!creds?.access_token) {
    markFailed(db, action.id, "No Meta credentials");
    return { success: false, action_id: action.id, error: "No Meta credentials" };
  }

  let result;
  if (action.action_type === "pause") {
    result = await updateCampaignStatus(creds.access_token, action.meta_campaign_id, "PAUSED");
  } else if (action.action_type === "resume") {
    result = await updateCampaignStatus(creds.access_token, action.meta_campaign_id, "ACTIVE");
  } else if (action.action_type === "budget_increase" || action.action_type === "budget_decrease") {
    // adset ID를 찾아서 예산 변경
    const adsetId = action.adset_id || null;
    let targetAdsetId = adsetId;
    if (!targetAdsetId) {
      const { data: adsets } = await fetchAdSetsForCampaign(creds.access_token, action.meta_campaign_id);
      if (!adsets?.length) {
        markFailed(db, action.id, "No adsets found for campaign");
        return { success: false, action_id: action.id, error: "No adsets found" };
      }
      targetAdsetId = adsets[0].id;
    }
    const newBudget = Number(action.proposed_value);
    result = await updateAdSetBudget(creds.access_token, targetAdsetId, newBudget);
  } else if (action.action_type === "targeting_broaden") {
    // Broad 타겟으로 전환 (관심사/행동 제거, 지역+연령만)
    const adsetId = action.adset_id || null;
    let targetAdsetId = adsetId;
    if (!targetAdsetId) {
      const { data: adsets } = await fetchAdSetsForCampaign(creds.access_token, action.meta_campaign_id);
      if (!adsets?.length) {
        markFailed(db, action.id, "No adsets found for campaign");
        return { success: false, action_id: action.id, error: "No adsets found" };
      }
      targetAdsetId = adsets[0].id;
    }
    let targeting;
    try {
      targeting = JSON.parse(action.proposed_value);
    } catch {
      targeting = { geo_locations: { countries: ["KR"] }, age_min: 18, age_max: 65 };
    }
    result = await updateAdSetTargeting(creds.access_token, targetAdsetId, targeting);
  } else if (action.action_type === "creative_refresh") {
    // 수동 조치 필요 — 자동 실행 불가하지만 학습 추적은 시작
    db.prepare("UPDATE action_queue SET status = 'manual_pending', executed_at = datetime('now'), execution_result = ? WHERE id = ?")
      .run(JSON.stringify({ manual_required: true, message: "수동 조치 필요: 새 크리에이티브를 제작하고 새 광고를 생성하세요" }), action.id);
    // 학습 추적 시작 — before_roas 기록 (수동 완료 시 7일 후 자동 측정)
    autoLogImprovement(db, action);
    return { success: true, action_id: action.id, manual_required: true, message: "수동 조치 필요 — 학습 추적 시작됨. 소재 교체 후 '수동 완료' 버튼을 눌러주세요." };
  } else {
    markFailed(db, action.id, `Unknown action type: ${action.action_type}`);
    return { success: false, action_id: action.id, error: `Unknown action type: ${action.action_type}` };
  }

  if (result.error) {
    markFailed(db, action.id, result.error);
    return { success: false, action_id: action.id, error: result.error };
  }

  // 성공 — DB 기록
  db.prepare("UPDATE action_queue SET status = 'executed', executed_at = datetime('now'), execution_result = ? WHERE id = ?")
    .run(JSON.stringify(result.data), action.id);
  if (action.review_run_id) updateRunCounters(db, action.review_run_id);

  // ─── 학습 피드백: improvement_log 자동 생성 ───
  autoLogImprovement(db, action);

  return { success: true, action_id: action.id, meta_response: result.data };
}

/** 실행 성공 후 improvement_log 자동 기록 (7일 뒤 자동 측정) */
function autoLogImprovement(db, action) {
  try {
    const campaignRow = db.prepare(
      "SELECT id FROM campaigns WHERE meta_campaign_id = ?"
    ).get(action.meta_campaign_id);
    if (!campaignRow) return;

    const logResult = logImprovement(
      campaignRow.id,
      action.action_type,
      action.reason
    );
    // action_queue에 improvement_log_id 기록 (양방향 연결)
    db.prepare("UPDATE action_queue SET improvement_log_id = ? WHERE id = ?")
      .run(logResult.lastInsertRowid, action.id);
  } catch (err) {
    console.warn("[Actions] improvement_log auto-create failed:", err.message);
  }
}

function markFailed(db, actionId, error) {
  db.prepare("UPDATE action_queue SET status = 'failed', executed_at = datetime('now'), execution_result = ? WHERE id = ?")
    .run(JSON.stringify({ error }), actionId);
}

function updateRunCounters(db, runId) {
  const approved = db.prepare("SELECT COUNT(*) as cnt FROM action_queue WHERE review_run_id = ? AND status IN ('approved', 'executed')").get(runId)?.cnt || 0;
  const executed = db.prepare("SELECT COUNT(*) as cnt FROM action_queue WHERE review_run_id = ? AND status = 'executed'").get(runId)?.cnt || 0;
  db.prepare("UPDATE review_runs SET actions_approved = ?, actions_executed = ? WHERE id = ?").run(approved, executed, runId);
}

export default router;

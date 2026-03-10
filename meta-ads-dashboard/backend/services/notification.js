// 알림 서비스 — OpenClaw CLI / 웹훅(Slack/Discord)으로 리뷰 결과 발송
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDb } from "../db/database.js";

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = "/usr/local/bin/openclaw";
const OPENCLAW_CHANNEL = "telegram";
const OPENCLAW_TARGET = "5789649111";

const ACTION_TYPE_LABELS = {
  pause: "⏸️ 일시정지",
  budget_increase: "📈 예산 증액",
  budget_decrease: "📉 예산 감축",
  resume: "▶️ 재개",
  targeting_broaden: "🎯 Broad 타겟 전환",
  creative_refresh: "🎨 소재 교체 필요",
  early_warning: "🔮 조기 경고",
  early_kill: "💀 조기 중단 권장",
};

/**
 * 리뷰 결과를 OpenClaw (기본) + 등록된 웹훅 채널로 발송
 * @param {{ date, total_campaigns, actions, summary }} reviewResult
 */
export async function sendReviewNotification(reviewResult) {
  const message = formatReviewMessage(reviewResult);
  let sent = 0;

  // 1. OpenClaw Telegram 발송 (항상 실행)
  try {
    await sendViaOpenClaw(message);
    sent++;
    console.log("[Notification] Sent via OpenClaw Telegram");
  } catch (err) {
    console.error("[Notification] OpenClaw send failed:", err.message);
  }

  // 2. DB에 등록된 추가 웹훅 채널 발송
  try {
    const db = getDb();
    const configs = db.prepare("SELECT * FROM notification_config WHERE enabled = 1").all();
    for (const config of configs) {
      try {
        await sendWebhook(config.webhook_url, message, config.channel);
        sent++;
        console.log(`[Notification] Sent to ${config.channel}: ${config.webhook_url.substring(0, 40)}...`);
      } catch (err) {
        console.error(`[Notification] Failed to send to ${config.channel}:`, err.message);
      }
    }
  } catch { /* DB 미초기화 시 무시 */ }

  return { sent };
}

/**
 * OpenClaw CLI로 Telegram 메시지 발송
 */
export async function sendViaOpenClaw(message) {
  const { stdout, stderr } = await execFileAsync(OPENCLAW_BIN, [
    "message", "send",
    "--channel", OPENCLAW_CHANNEL,
    "--target", OPENCLAW_TARGET,
    "--message", message,
  ], { timeout: 15000 });

  if (stderr && stderr.includes("error")) {
    throw new Error(stderr.substring(0, 200));
  }
  return stdout;
}

/**
 * 테스트 알림 발송 (OpenClaw)
 */
export async function sendTestNotification() {
  const message = "🔔 테스트 알림\n\nMeta Ads Intelligence 알림이 정상 연결되었습니다.\n일일 리뷰 결과가 이 채널로 발송됩니다.";
  await sendViaOpenClaw(message);
  return { success: true };
}

function formatReviewMessage({ date, total_campaigns, actions, summary, early_signals }) {
  const lines = [];
  lines.push(`📊 일일 광고 리뷰 — ${date}`);
  lines.push("");

  // 요약
  lines.push(`활성 캠페인: ${total_campaigns}개`);
  if (summary) {
    const roas = summary.overall_roas?.toFixed(2) || "N/A";
    const spend = summary.total_spend ? `₩${Math.round(summary.total_spend).toLocaleString()}` : "N/A";
    const revenue = summary.total_revenue ? `₩${Math.round(summary.total_revenue).toLocaleString()}` : "N/A";
    lines.push(`전체 ROAS: ${roas}x | 광고비: ${spend} | 매출: ${revenue}`);
    const dist = summary.verdict_distribution || {};
    lines.push(`판정: 🟢SCALE ${dist.SCALE || 0} / 🟡MAINTAIN ${dist.MAINTAIN || 0} / 🟠MODIFY ${dist.MODIFY || 0} / 🔴PAUSE ${dist.PAUSE || 0}`);
  }

  // 추세 요약 (WMA 적용 시)
  if (actions && actions.length > 0) {
    const improving = actions.filter((a) => a.trend_direction === "improving").length;
    const declining = actions.filter((a) => a.trend_direction === "declining").length;
    const flat = actions.filter((a) => a.trend_direction === "flat").length;
    const hasTrend = improving + declining + flat > 0;
    if (hasTrend) {
      lines.push(`📊 추세: 📈개선 ${improving} / 📉하락 ${declining} / ➡️안정 ${flat}`);
    }
  }

  // 조기 진단 섹션 (1-3일차 신규 캠페인)
  if (early_signals && early_signals.length > 0) {
    lines.push("");
    lines.push(`🔮 신규 캠페인 조기 진단: ${early_signals.length}건`);
    for (const es of early_signals) {
      const name = es.campaign?.campaign_name || es.campaign?.meta_campaign_id || "Unknown";
      lines.push(`  ${es.emoji} ${name} — Day ${es.dayCount} | Score ${es.score} (${es.grade})`);
      if (es.recommendations && es.recommendations.length > 0) {
        lines.push(`    💡 ${es.recommendations[0]}`);
      }
    }
  }

  if (!actions || actions.length === 0) {
    lines.push("");
    lines.push("✅ 변경 필요 없음 — 모든 캠페인 정상 운영 중");
  } else {
    lines.push("");
    lines.push(`⚠️ 변경 필요: ${actions.length}건`);
    for (const a of actions) {
      const label = ACTION_TYPE_LABELS[a.action_type] || a.action_type;
      lines.push(`  ${label} | ${a.campaign_name}`);
      lines.push(`    사유: ${a.reason}`);
      const recs = a.recommendations || [];
      if (recs.length > 0 && recs[0] !== "현행 유지") {
        lines.push(`    💡 추천: ${recs[0]}`);
      }
    }
    lines.push("");
    lines.push("👉 승인하기: http://localhost:5173/?tab=actions");
  }

  return lines.join("\n");
}

/**
 * 웹훅 발송 (Slack/Discord 등 추가 채널용)
 */
async function sendWebhook(url, message, channel) {
  const payload = { text: message };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook failed (${res.status}): ${text.substring(0, 200)}`);
  }
}

// 알림 서비스 — OpenClaw/Slack/Telegram 웹훅으로 리뷰 결과 발송
import fetch from "node-fetch";
import { getDb } from "../db/database.js";

const WEBHOOK_TIMEOUT_MS = 10000;

const ACTION_TYPE_LABELS = {
  pause: "⏸️ 일시정지",
  budget_increase: "📈 예산 증액",
  budget_decrease: "📉 예산 감축",
  resume: "▶️ 재개",
  targeting_broaden: "🎯 Broad 타겟 전환",
  creative_refresh: "🎨 소재 교체 필요",
};

/**
 * 리뷰 결과를 등록된 모든 웹훅 채널로 발송
 * @param {{ date, total_campaigns, actions, summary }} reviewResult
 */
export async function sendReviewNotification(reviewResult) {
  const db = getDb();
  const configs = db.prepare("SELECT * FROM notification_config WHERE enabled = 1").all();

  if (configs.length === 0) {
    console.log("[Notification] No enabled notification channels configured, skipping");
    return { sent: 0, skipped: true };
  }

  const message = formatReviewMessage(reviewResult);
  let sent = 0;

  for (const config of configs) {
    try {
      await sendWebhook(config.webhook_url, message, config.channel);
      sent++;
      console.log(`[Notification] Sent to ${config.channel}: ${config.webhook_url.substring(0, 40)}...`);
    } catch (err) {
      console.error(`[Notification] Failed to send to ${config.channel}:`, err.message);
    }
  }

  return { sent, total: configs.length };
}

/**
 * 테스트 알림 발송
 */
export async function sendTestNotification(webhookUrl, channel) {
  const message = "🔔 테스트 알림\n\nMeta Ads Intelligence 알림이 정상 연결되었습니다.\n일일 리뷰 결과가 이 채널로 발송됩니다.";
  await sendWebhook(webhookUrl, message, channel);
  return { success: true };
}

function formatReviewMessage({ date, total_campaigns, actions, summary }) {
  const lines = [];
  lines.push(`📊 일일 광고 리뷰 — ${date}`);
  lines.push("");

  // 요약
  lines.push(`활성 캠페인: ${total_campaigns}개`);
  if (summary) {
    const roas = summary.overall_roas?.toFixed(2) || "N/A";
    lines.push(`전체 ROAS: ${roas}x`);
    const dist = summary.verdict_distribution || {};
    lines.push(`판정: SCALE ${dist.SCALE || 0} / MAINTAIN ${dist.MAINTAIN || 0} / MODIFY ${dist.MODIFY || 0} / PAUSE ${dist.PAUSE || 0}`);
  }

  if (actions.length === 0) {
    lines.push("");
    lines.push("✅ 변경 필요 없음 — 모든 캠페인 정상 운영 중");
  } else {
    lines.push("");
    lines.push(`⚠️ 변경 필요: ${actions.length}건`);
    for (const a of actions) {
      const label = ACTION_TYPE_LABELS[a.action_type] || a.action_type;
      lines.push(`  ${label} | ${a.campaign_name}`);
      lines.push(`    사유: ${a.reason}`);
      // 개선 방향 요약 (첫 번째 추천 사항만 표시)
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

async function sendWebhook(url, message, channel) {
  // Slack 호환 포맷 (OpenClaw, Slack, Discord 모두 지원)
  const payload = { text: message };
  if (channel === "telegram") {
    // Telegram Bot API는 다른 포맷
    payload.chat_id = extractTelegramChatId(url);
    payload.parse_mode = "HTML";
    delete payload.text;
    payload.text = message;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook failed (${res.status}): ${text.substring(0, 200)}`);
  }
}

function extractTelegramChatId(url) {
  // Telegram 웹훅 URL에서 chat_id를 추출하는 로직
  // 일반적으로 사용자가 webhook_url에 chat_id를 포함시킴
  const match = url.match(/chat_id=([^&]+)/);
  return match ? match[1] : "";
}

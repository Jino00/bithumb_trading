// node-cron 스케줄러 — 매일 06:00 트렌드 자동 갱신
import cron from "node-cron";
import { refreshTrendsData, getLastRefreshTime } from "./services/trend-refresh.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function startScheduler() {
  // 매일 06:00 KST 실행
  cron.schedule("0 6 * * *", async () => {
    console.log("[Scheduler] Running daily trend refresh...");
    try {
      const result = await refreshTrendsData();
      console.log(`[Scheduler] Trends refreshed at ${result.last_updated}`);
    } catch (err) {
      console.error("[Scheduler] Trend refresh failed:", err.message);
    }
  }, { timezone: "Asia/Seoul" });

  console.log("[Scheduler] Daily trend refresh scheduled at 06:00 KST");

  // 시작 시 마지막 갱신 확인 → 24시간 이상 지났으면 즉시 갱신
  checkAndRefreshOnStartup();
}

async function checkAndRefreshOnStartup() {
  try {
    const lastRefresh = getLastRefreshTime();
    if (!lastRefresh) {
      console.log("[Scheduler] No previous trends found, refreshing now...");
      const result = await refreshTrendsData();
      console.log(`[Scheduler] Initial trends loaded at ${result.last_updated}`);
      return;
    }

    const elapsed = Date.now() - new Date(lastRefresh).getTime();
    if (elapsed > TWENTY_FOUR_HOURS_MS) {
      console.log("[Scheduler] Trends are stale (>24h), refreshing...");
      const result = await refreshTrendsData();
      console.log(`[Scheduler] Trends refreshed at ${result.last_updated}`);
    } else {
      const hoursAgo = Math.round(elapsed / (60 * 60 * 1000));
      console.log(`[Scheduler] Trends are fresh (updated ${hoursAgo}h ago)`);
    }
  } catch (err) {
    console.error("[Scheduler] Startup refresh check failed:", err.message);
  }
}

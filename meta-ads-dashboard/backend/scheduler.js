// node-cron 스케줄러 — 매일 06:00 트렌드 + 07:00 스냅샷 + 08:00 Cafe24 동기화
import cron from "node-cron";
import { refreshTrendsData, getLastRefreshTime } from "./services/trend-refresh.js";
import { takeSnapshotAll } from "./services/snapshot-service.js";
import { syncCafe24OrdersJob } from "./services/cafe24-sync-job.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function startScheduler() {
  // 매일 06:00 KST — 트렌드 갱신
  cron.schedule("0 6 * * *", async () => {
    console.log("[Scheduler] Running daily trend refresh...");
    try {
      const result = await refreshTrendsData();
      console.log(`[Scheduler] Trends refreshed at ${result.last_updated}`);
    } catch (err) {
      console.error("[Scheduler] Trend refresh failed:", err.message);
    }
  }, { timezone: "Asia/Seoul" });

  // 매일 07:00 KST — 캠페인 성과 스냅샷 기록 + 개선 효과 측정
  cron.schedule("0 7 * * *", () => {
    console.log("[Scheduler] Taking daily campaign snapshots...");
    try {
      const result = takeSnapshotAll();
      console.log(`[Scheduler] Snapshot: ${result.recorded} campaigns recorded for ${result.date}`);
    } catch (err) {
      console.error("[Scheduler] Snapshot failed:", err.message);
    }
  }, { timezone: "Asia/Seoul" });

  // 매일 08:00 KST — Cafe24 주문 데이터 자동 동기화 + 크로스 검증
  cron.schedule("0 8 * * *", async () => {
    console.log("[Scheduler] Running daily Cafe24 order sync...");
    try {
      const result = await syncCafe24OrdersJob();
      if (result.skipped) {
        console.log(`[Scheduler] Cafe24 sync skipped: ${result.reason}`);
      } else {
        console.log(`[Scheduler] Cafe24 sync: ${result.synced} orders synced, ${result.meta_attributed} from Meta ads`);
        if (result.cross_validation) {
          console.log(`[Scheduler] Cross-validation: ${result.cross_validation.match_rate}% match rate`);
        }
      }
    } catch (err) {
      console.error("[Scheduler] Cafe24 sync failed:", err.message);
    }
  }, { timezone: "Asia/Seoul" });

  console.log("[Scheduler] Daily tasks: trends@06:00, snapshots@07:00, cafe24-sync@08:00 KST");

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

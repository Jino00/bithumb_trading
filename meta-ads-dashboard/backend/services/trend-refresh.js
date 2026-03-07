// 트렌드 갱신 서비스 — 스케줄러와 HTTP 라우트 양쪽에서 호출
import { getDb } from "../db/database.js";
import { callClaude, parseClaudeJson } from "./claude-client.js";

const SYSTEM_PROMPT = `You are a Meta Ads expert with access to real-time web search. Always search for the latest Meta Ads updates, algorithm changes, best practices, and trends before answering. Your knowledge must be current as of today. Return ONLY valid JSON.`;

const REFRESH_PROMPT = `Search the web for the very latest Meta Ads information and return:

1. Recent algorithm updates or policy changes from Meta
2. Best-performing ad formats right now with performance data
3. Current CPM/CPC/CTR benchmarks by industry
4. What strategies are working best right now

Return JSON:
{
  "algorithm_updates": [{"title": string, "content": string, "date": string}],
  "best_formats": [{"format": string, "performance": string, "trend": "up"|"stable"|"down"}],
  "benchmarks": {"average_ctr": string, "average_cpc": string, "average_cpm": string, "average_roas": string, "industry_note": string},
  "whats_working": string[]
}`;

export function generateMockTrends() {
  return JSON.stringify({
    algorithm_updates: [
      {
        title: "Meta Advantage+ Shopping Campaigns Enhanced",
        content: "Meta has expanded Advantage+ shopping campaigns with improved AI-driven targeting and creative optimization. Advertisers report 15-20% improvement in ROAS.",
        date: "2025-03",
      },
      {
        title: "New Reels Ad Placements",
        content: "Meta introduced new Reels ad placements with interactive features. Early adopters see 30% lower CPMs compared to feed placements.",
        date: "2025-02",
      },
    ],
    best_formats: [
      { format: "Short-form Video (Reels)", performance: "Highest engagement, 40% lower CPM", trend: "up" },
      { format: "Carousel Ads", performance: "Best for e-commerce, 2.5x higher CTR", trend: "stable" },
      { format: "Collection Ads", performance: "Strong for product discovery, 3x conversion rate", trend: "up" },
      { format: "Stories Ads", performance: "Good for awareness, declining engagement", trend: "down" },
    ],
    benchmarks: {
      average_ctr: "1.5-2.5%",
      average_cpc: "$1.00-2.50",
      average_cpm: "$8.00-15.00",
      average_roas: "2.5-4.0x",
      industry_note: "E-commerce tends to outperform, B2B has higher CPCs but better conversion values",
    },
    whats_working: [
      "UGC-style video ads outperform polished creative by 30-50%",
      "Advantage+ audience targeting now matches or beats manual targeting for most advertisers",
      "First-party data integration via Conversions API improves attribution accuracy by 20%",
      "AI-generated ad variations show 15% improvement in creative testing velocity",
      "Broad targeting + creative diversity strategy replacing narrow interest targeting",
    ],
  });
}

/**
 * 트렌드 데이터를 갱신하고 DB에 저장
 * @returns {{ data: object, last_updated: string }} 갱신된 트렌드 데이터
 */
export async function refreshTrendsData() {
  const result = await callClaude(REFRESH_PROMPT, SYSTEM_PROMPT, generateMockTrends);
  const parsed = parseClaudeJson(result, JSON.parse(generateMockTrends()));

  const db = getDb();
  saveTrends(db, parsed);

  return { data: parsed, last_updated: new Date().toISOString() };
}

/**
 * 마지막 갱신 시간 조회
 * @returns {string|null} ISO 날짜 문자열 또는 null
 */
export function getLastRefreshTime() {
  const db = getDb();
  const row = db.prepare("SELECT fetched_at FROM trends ORDER BY fetched_at DESC LIMIT 1").get();
  return row?.fetched_at || null;
}

function saveTrends(db, data) {
  db.prepare("DELETE FROM trends").run();

  const insert = db.prepare("INSERT INTO trends (category, title, content, source) VALUES (?, ?, ?, ?)");

  const save = db.transaction((trendData) => {
    if (trendData.algorithm_updates) {
      for (const update of trendData.algorithm_updates) {
        insert.run("algorithm_update", update.title, update.content, update.date || null);
      }
    }
    if (trendData.best_formats) {
      for (const fmt of trendData.best_formats) {
        insert.run("best_format", fmt.format, `${fmt.performance} (trend: ${fmt.trend})`, null);
      }
    }
    if (trendData.benchmarks) {
      insert.run("benchmark", "Industry Benchmarks", JSON.stringify(trendData.benchmarks), null);
    }
    if (trendData.whats_working) {
      for (const tip of trendData.whats_working) {
        insert.run("whats_working", "Best Practice", tip, null);
      }
    }
  });

  try {
    save(data);
  } catch (err) {
    console.error("Failed to save trends:", err.message);
  }
}

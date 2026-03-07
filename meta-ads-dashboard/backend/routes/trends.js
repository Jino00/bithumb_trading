// Meta Ads 트렌드 — 실시간 웹 검색 기반 최신 정보
import { Router } from "express";
import { getDb } from "../db/database.js";
import { refreshTrendsData, generateMockTrends } from "../services/trend-refresh.js";

const router = Router();

router.get("/", (_req, res) => {
  try {
    const db = getDb();
    const trends = db.prepare("SELECT * FROM trends ORDER BY fetched_at DESC LIMIT 50").all();

    if (trends.length === 0) {
      const mock = JSON.parse(generateMockTrends());
      return res.json({ trends: [], latest: mock, last_updated: null });
    }

    const grouped = {};
    for (const t of trends) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }

    res.json({ trends: grouped, last_updated: trends[0]?.fetched_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/refresh", async (_req, res) => {
  try {
    const result = await refreshTrendsData();
    res.json({ ...result.data, last_updated: result.last_updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

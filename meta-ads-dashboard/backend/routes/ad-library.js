// Meta Ad Library 리뷰 — 검색/분석/저장 라우트
import { Router } from "express";
import { getDb } from "../db/database.js";
import { reviewAdLibrary } from "../services/ad-library-review.js";

const router = Router();

// 리뷰 목록 조회
router.get("/reviews", (_req, res) => {
  try {
    const db = getDb();
    const reviews = db.prepare("SELECT id, search_query, search_type, ads_found, created_at FROM ad_library_reviews ORDER BY created_at DESC LIMIT 50").all();
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 새 리뷰 생성 (검색 + AI 분석)
router.post("/review", async (req, res) => {
  try {
    const { query, type } = req.body;
    if (!query) return res.status(400).json({ error: "query is required" });

    const searchType = type || "keyword";
    const result = await reviewAdLibrary(query, searchType);

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO ad_library_reviews (search_query, search_type, ads_found, trends, styles, pros_cons, messaging_patterns, key_takeaways, raw_analysis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      result.search_query,
      result.search_type,
      result.ads_found,
      JSON.stringify(result.trends),
      JSON.stringify(result.styles),
      JSON.stringify(result.pros_cons),
      JSON.stringify(result.messaging_patterns),
      JSON.stringify(result.key_takeaways),
      JSON.stringify(result.raw_analysis)
    );

    res.json({ id: info.lastInsertRowid, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 리뷰 상세 조회
router.get("/reviews/:id", (req, res) => {
  try {
    const db = getDb();
    const review = db.prepare("SELECT * FROM ad_library_reviews WHERE id = ?").get(req.params.id);
    if (!review) return res.status(404).json({ error: "Review not found" });

    res.json({
      ...review,
      trends: JSON.parse(review.trends || "[]"),
      styles: JSON.parse(review.styles || "[]"),
      pros_cons: JSON.parse(review.pros_cons || "{}"),
      messaging_patterns: JSON.parse(review.messaging_patterns || "[]"),
      key_takeaways: JSON.parse(review.key_takeaways || "[]"),
      raw_analysis: JSON.parse(review.raw_analysis || "{}"),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 리뷰 삭제
router.delete("/reviews/:id", (req, res) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM ad_library_reviews WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

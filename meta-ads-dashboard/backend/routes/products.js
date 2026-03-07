// 제품 레지스트리 + 하이브리드 리뷰 분석 (스크래핑 + Claude AI) REST API 라우트
import { Router } from "express";
import { getDb } from "../db/database.js";
import { analyzeListingReviews, analyzeNewReviews, aggregateProductReviews } from "../services/review-analyzer.js";
import { scrapeListing } from "../services/scrapers/scraper-manager.js";

const router = Router();

// GET / — 제품 목록 (listing_count, last_analyzed 포함)
router.get("/", (_req, res) => {
  const db = getDb();
  const products = db.prepare(`
    SELECT p.*,
           COUNT(pl.id) as listing_count,
           (SELECT MAX(pr.analyzed_at) FROM product_reviews pr WHERE pr.product_id = p.id) as last_analyzed
    FROM products p
    LEFT JOIN product_listings pl ON pl.product_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all();
  res.json(products);
});

// POST / — 제품 등록
router.post("/", (req, res) => {
  const { name, category, description } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: "name and category are required" });
  }
  const db = getDb();
  const result = db.prepare("INSERT INTO products (name, category, description) VALUES (?, ?, ?)").run(name, category, description || null);
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(product);
});

// GET /:id — 제품 상세 (listings + latest_reviews + aggregation)
router.get("/:id", (req, res) => {
  const db = getDb();
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const listings = db.prepare("SELECT * FROM product_listings WHERE product_id = ? ORDER BY platform_type").all(req.params.id);

  const latestReviews = db.prepare(`
    SELECT pr.* FROM product_reviews pr
    INNER JOIN (
      SELECT listing_id, MAX(analyzed_at) as max_date
      FROM product_reviews
      WHERE product_id = ?
      GROUP BY listing_id
    ) latest ON pr.listing_id = latest.listing_id AND pr.analyzed_at = latest.max_date
    WHERE pr.product_id = ?
  `).all(req.params.id, req.params.id);

  const aggregation = db.prepare("SELECT * FROM product_review_aggregations WHERE product_id = ?").get(req.params.id);

  res.json({
    ...product,
    listings,
    latest_reviews: latestReviews.map(parseReviewJson),
    aggregation: aggregation ? parseAggregationJson(aggregation) : null,
  });
});

// PUT /:id — 제품 수정
router.put("/:id", (req, res) => {
  const db = getDb();
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const { name, category, description } = req.body;
  db.prepare("UPDATE products SET name = ?, category = ?, description = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name || product.name, category || product.category, description !== undefined ? description : product.description, req.params.id);

  const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  res.json(updated);
});

// DELETE /:id — 제품 삭제 (cascade)
router.delete("/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM product_review_aggregations WHERE product_id = ?").run(req.params.id);
  db.prepare("DELETE FROM product_reviews WHERE product_id = ?").run(req.params.id);
  db.prepare("DELETE FROM product_listings WHERE product_id = ?").run(req.params.id);
  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.json({ deleted: true });
});

// POST /:id/listings — 판매처 등록 추가
router.post("/:id/listings", (req, res) => {
  const { platform_type, listing_url, listing_name } = req.body;
  if (!platform_type || !listing_url || !listing_name) {
    return res.status(400).json({ error: "platform_type, listing_url, and listing_name are required" });
  }
  const db = getDb();
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
  if (!product) return res.status(404).json({ error: "Product not found" });

  const result = db.prepare("INSERT INTO product_listings (product_id, platform_type, listing_url, listing_name) VALUES (?, ?, ?, ?)")
    .run(req.params.id, platform_type, listing_url, listing_name);
  const listing = db.prepare("SELECT * FROM product_listings WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(listing);
});

// DELETE /:id/listings/:lid — 판매처 등록 삭제
router.delete("/:id/listings/:lid", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM product_listings WHERE id = ? AND product_id = ?").run(req.params.lid, req.params.id);
  res.json({ deleted: true });
});

// POST /:id/analyze — 하이브리드 리뷰 분석 (스크래핑 → 증분 분석 → 종합)
router.post("/:id/analyze", async (req, res) => {
  try {
    const db = getDb();
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const listings = db.prepare("SELECT * FROM product_listings WHERE product_id = ?").all(req.params.id);
    if (listings.length === 0) return res.status(400).json({ error: "No listings registered for this product" });

    const platformReviews = [];

    for (const listing of listings) {
      const analysis = await hybridAnalyzeListing(db, product, listing);

      platformReviews.push({
        platform_type: listing.platform_type,
        listing_name: listing.listing_name,
        analysis,
      });
    }

    const aggregation = await aggregateProductReviews(product, platformReviews);

    db.prepare(`
      INSERT INTO product_review_aggregations (product_id, total_review_count, overall_sentiment, cross_platform_themes, cross_platform_strengths, cross_platform_weaknesses, platform_comparison, actionable_insights, raw_aggregation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        total_review_count = excluded.total_review_count,
        overall_sentiment = excluded.overall_sentiment,
        cross_platform_themes = excluded.cross_platform_themes,
        cross_platform_strengths = excluded.cross_platform_strengths,
        cross_platform_weaknesses = excluded.cross_platform_weaknesses,
        platform_comparison = excluded.platform_comparison,
        actionable_insights = excluded.actionable_insights,
        raw_aggregation = excluded.raw_aggregation,
        aggregated_at = datetime('now')
    `).run(
      product.id, aggregation.total_review_count,
      JSON.stringify(aggregation.overall_sentiment),
      JSON.stringify(aggregation.cross_platform_themes),
      JSON.stringify(aggregation.cross_platform_strengths),
      JSON.stringify(aggregation.cross_platform_weaknesses),
      JSON.stringify(aggregation.platform_comparison),
      JSON.stringify(aggregation.actionable_insights),
      JSON.stringify(aggregation),
    );

    res.json({ product_id: product.id, listings_analyzed: platformReviews.length, aggregation });
  } catch (err) {
    console.error("Failed to analyze product reviews:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 하이브리드 분석: 스크래핑 → 새 리뷰 저장 → Claude 증분 분석 → DB 저장
 * 스크래핑 미지원 플랫폼은 기존 web_search fallback 사용
 */
async function hybridAnalyzeListing(db, product, listing) {
  // 1. scrape_state에서 마지막 스크래핑 날짜 조회
  const state = db.prepare("SELECT * FROM scrape_state WHERE listing_id = ?").get(listing.id);
  const lastReviewDate = state?.last_review_date || null;

  // 2. 스크래핑 시도
  let scrapeResult = null;
  try {
    db.prepare("INSERT INTO scrape_state (listing_id, scrape_status) VALUES (?, 'scraping') ON CONFLICT(listing_id) DO UPDATE SET scrape_status = 'scraping', error_message = NULL").run(listing.id);

    scrapeResult = await scrapeListing(listing, lastReviewDate);
  } catch (err) {
    console.error(`[Hybrid] Scraping failed for ${listing.platform_type}, falling back to web_search:`, err.message);
    db.prepare("UPDATE scrape_state SET scrape_status = 'error', error_message = ? WHERE listing_id = ?").run(err.message, listing.id);
  }

  // 3. 스크래핑 실패, 미지원, 또는 봇 감지(0건 반환) → 기존 web_search fallback
  const hasExistingScrapedData = db.prepare("SELECT COUNT(*) as cnt FROM scraped_reviews WHERE listing_id = ?").get(listing.id)?.cnt > 0;
  const scrapingBlocked = scrapeResult && scrapeResult.totalReviewCount === 0 && scrapeResult.reviews.length === 0 && !hasExistingScrapedData;

  if (!scrapeResult || scrapingBlocked) {
    let fallbackReason;
    if (scrapingBlocked) {
      fallbackReason = "Bot detection - using web_search fallback";
      console.log(`[Hybrid] Scraping returned 0 results (likely bot detection) for ${listing.platform_type}, falling back to web_search`);
    } else if (!scrapeResult && !state?.scrape_status?.includes("error")) {
      // scrapeResult is null without error (e.g. own_store — no scraper available)
      fallbackReason = "No scraper available - using web_search fallback";
      console.log(`[Hybrid] No scraper for ${listing.platform_type}, falling back to web_search`);
    } else {
      fallbackReason = "Scraping failed - using web_search fallback";
    }

    try {
      const analysis = await analyzeListingReviews(listing);
      saveProductReview(db, product.id, listing, analysis);
      // Update scrape_state to reflect successful web_search fallback
      db.prepare(`
        INSERT INTO scrape_state (listing_id, scrape_status, error_message)
        VALUES (?, 'done_web_search', ?)
        ON CONFLICT(listing_id) DO UPDATE SET
          scrape_status = 'done_web_search',
          error_message = ?,
          last_scraped_at = datetime('now')
      `).run(listing.id, fallbackReason, fallbackReason);
      return analysis;
    } catch (fallbackErr) {
      // web_search fallback itself failed — keep error state
      db.prepare(`
        INSERT INTO scrape_state (listing_id, scrape_status, error_message)
        VALUES (?, 'error', ?)
        ON CONFLICT(listing_id) DO UPDATE SET
          scrape_status = 'error',
          error_message = ?
      `).run(listing.id, fallbackErr.message, fallbackErr.message);
      throw fallbackErr;
    }
  }

  // 4. 새 리뷰를 scraped_reviews에 저장 (중복 무시)
  const insertReview = db.prepare(`
    INSERT OR IGNORE INTO scraped_reviews (listing_id, platform_review_id, reviewer_name, rating, review_text, review_date, option_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let newCount = 0;
  let latestDate = lastReviewDate;
  for (const r of scrapeResult.reviews) {
    const result = insertReview.run(listing.id, r.platformReviewId, r.reviewerName, r.rating, r.reviewText, r.reviewDate, r.optionName);
    if (result.changes > 0) newCount++;
    if (r.reviewDate && (!latestDate || r.reviewDate > latestDate)) {
      latestDate = r.reviewDate;
    }
  }

  // 5. scrape_state 업데이트
  db.prepare(`
    UPDATE scrape_state SET
      total_review_count = ?, average_rating = ?,
      last_scraped_at = datetime('now'), last_review_date = ?,
      scrape_status = 'done'
    WHERE listing_id = ?
  `).run(scrapeResult.totalReviewCount, scrapeResult.averageRating, latestDate, listing.id);

  console.log(`[Hybrid] ${listing.platform_type}: ${scrapeResult.totalReviewCount} total, ${newCount} new reviews saved`);

  // 6. 미분석 리뷰 추출
  const unanalyzedReviews = db.prepare("SELECT * FROM scraped_reviews WHERE listing_id = ? AND is_analyzed = 0").all(listing.id);

  if (unanalyzedReviews.length === 0) {
    console.log(`[Hybrid] No new reviews to analyze for ${listing.listing_name}`);
    // 기존 분석 결과 반환
    const existing = db.prepare(`
      SELECT * FROM product_reviews WHERE listing_id = ? ORDER BY analyzed_at DESC LIMIT 1
    `).get(listing.id);

    if (existing) {
      return parseReviewJson(existing).raw_analysis || {};
    }
    // 기존 분석도 없으면 스크래핑 데이터만으로 기본 분석
    return { review_count: scrapeResult.totalReviewCount, average_rating: scrapeResult.averageRating, sentiment_summary: { positive_pct: 0, neutral_pct: 0, negative_pct: 0, overall: "neutral" }, themes: [], strengths: [], weaknesses: [], notable_reviews: [] };
  }

  // 7. 기존 분석 결과 로드 (병합용)
  const existingReview = db.prepare("SELECT raw_analysis FROM product_reviews WHERE listing_id = ? ORDER BY analyzed_at DESC LIMIT 1").get(listing.id);
  const existingAnalysis = existingReview ? JSON.parse(existingReview.raw_analysis || "null") : null;

  // 8. Claude로 새 리뷰만 분석
  const analysis = await analyzeNewReviews(
    listing, unanalyzedReviews,
    existingAnalysis,
    { totalReviewCount: scrapeResult.totalReviewCount, averageRating: scrapeResult.averageRating },
  );

  // 9. 분석 완료 표시
  db.prepare("UPDATE scraped_reviews SET is_analyzed = 1 WHERE listing_id = ? AND is_analyzed = 0").run(listing.id);

  // 10. product_reviews에 저장
  saveProductReview(db, product.id, listing, analysis);

  return analysis;
}

function saveProductReview(db, productId, listing, analysis) {
  db.prepare(`
    INSERT INTO product_reviews (product_id, listing_id, platform_type, review_count, average_rating, sentiment_summary, themes, strengths, weaknesses, notable_reviews, raw_analysis)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    productId, listing.id, listing.platform_type,
    analysis.review_count, analysis.average_rating,
    JSON.stringify(analysis.sentiment_summary),
    JSON.stringify(analysis.themes),
    JSON.stringify(analysis.strengths),
    JSON.stringify(analysis.weaknesses),
    JSON.stringify(analysis.notable_reviews),
    JSON.stringify(analysis),
  );
}

// GET /:id/scrape-status — 리스팅별 스크래핑 상태
router.get("/:id/scrape-status", (req, res) => {
  const db = getDb();
  const listings = db.prepare("SELECT * FROM product_listings WHERE product_id = ?").all(req.params.id);

  const statuses = listings.map((listing) => {
    const state = db.prepare("SELECT * FROM scrape_state WHERE listing_id = ?").get(listing.id);
    const unanalyzedCount = db.prepare("SELECT COUNT(*) as cnt FROM scraped_reviews WHERE listing_id = ? AND is_analyzed = 0").get(listing.id)?.cnt || 0;
    const totalScraped = db.prepare("SELECT COUNT(*) as cnt FROM scraped_reviews WHERE listing_id = ?").get(listing.id)?.cnt || 0;

    // 자동 보정: 분석 데이터가 있는데 상태가 error/scraping이면 done_web_search로 수정
    let scrapeStatus = state?.scrape_status || "idle";
    if (scrapeStatus === "error" || scrapeStatus === "scraping") {
      const hasReview = db.prepare(
        "SELECT COUNT(*) as cnt FROM product_reviews WHERE product_id = (SELECT product_id FROM product_listings WHERE id = ?) AND platform_type = ?"
      ).get(listing.id, listing.platform_type)?.cnt > 0;
      if (hasReview) {
        scrapeStatus = "done_web_search";
        db.prepare("UPDATE scrape_state SET scrape_status = 'done_web_search', last_scraped_at = CURRENT_TIMESTAMP WHERE listing_id = ?").run(listing.id);
      }
    }

    return {
      listing_id: listing.id,
      platform_type: listing.platform_type,
      listing_name: listing.listing_name,
      total_review_count: state?.total_review_count || 0,
      average_rating: state?.average_rating || null,
      last_scraped_at: state?.last_scraped_at || null,
      scrape_status: scrapeStatus,
      error_message: state?.error_message || null,
      scraped_review_count: totalScraped,
      unanalyzed_count: unanalyzedCount,
    };
  });

  res.json(statuses);
});

// GET /:id/reviews — 리뷰 분석 히스토리
router.get("/:id/reviews", (req, res) => {
  const db = getDb();
  const reviews = db.prepare("SELECT * FROM product_reviews WHERE product_id = ? ORDER BY analyzed_at DESC").all(req.params.id);
  res.json(reviews.map(parseReviewJson));
});

function parseReviewJson(review) {
  return {
    ...review,
    sentiment_summary: JSON.parse(review.sentiment_summary || "{}"),
    themes: JSON.parse(review.themes || "[]"),
    strengths: JSON.parse(review.strengths || "[]"),
    weaknesses: JSON.parse(review.weaknesses || "[]"),
    notable_reviews: JSON.parse(review.notable_reviews || "[]"),
    raw_analysis: JSON.parse(review.raw_analysis || "{}"),
  };
}

function parseAggregationJson(agg) {
  return {
    ...agg,
    overall_sentiment: JSON.parse(agg.overall_sentiment || "{}"),
    cross_platform_themes: JSON.parse(agg.cross_platform_themes || "[]"),
    cross_platform_strengths: JSON.parse(agg.cross_platform_strengths || "[]"),
    cross_platform_weaknesses: JSON.parse(agg.cross_platform_weaknesses || "[]"),
    platform_comparison: JSON.parse(agg.platform_comparison || "[]"),
    actionable_insights: JSON.parse(agg.actionable_insights || "[]"),
    raw_aggregation: JSON.parse(agg.raw_aggregation || "{}"),
  };
}

export default router;

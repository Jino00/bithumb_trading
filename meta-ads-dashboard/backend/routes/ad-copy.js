// 데이터 기반 광고 카피 생성 REST API — 리뷰 + Ad Library + 성과 학습 + 미디어 Vision
import { Router } from "express";
import fs from "fs";
import { getDb } from "../db/database.js";
import { generateAdCopy } from "../services/ad-copy-generator.js";
import { uploadMedia, isVideoFile, UPLOAD_DIR } from "../middleware/upload.js";
import { extractVideoThumbnail } from "../services/video-thumbnail.js";

const router = Router();

// POST /generate — 광고 카피 생성
router.post("/generate", async (req, res) => {
  try {
    const { product_id, copy_type, platform, tone, custom_instruction } = req.body;

    if (!product_id) {
      return res.status(400).json({ error: "product_id is required" });
    }

    const db = getDb();
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(product_id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // 리뷰 분석 데이터 존재 여부 확인
    const hasReviews = db.prepare("SELECT COUNT(*) as cnt FROM product_reviews WHERE product_id = ?").get(product_id)?.cnt > 0;
    if (!hasReviews) {
      return res.status(400).json({ error: "이 제품의 리뷰 분석 데이터가 없습니다. 먼저 리뷰 분석을 실행해주세요." });
    }

    console.log(`[Ad Copy] Generating copy for product: ${product.name} (type: ${copy_type || "full"}, tone: ${tone || "professional"})`);

    const result = await generateAdCopy(product_id, { copy_type, platform, tone, custom_instruction });

    // DB에 저장
    const insertResult = db.prepare(`
      INSERT INTO ad_copy_generations (product_id, copy_type, platform, tone, generated_copies, review_context, ad_library_context)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      product_id,
      copy_type || "full",
      platform || "facebook",
      tone || "professional",
      JSON.stringify(result.copies),
      JSON.stringify(result.review_context),
      JSON.stringify(result.ad_library_context),
    );

    console.log(`[Ad Copy] Generated ${result.copies.length} copies, saved as ID: ${insertResult.lastInsertRowid}`);

    res.json({
      id: insertResult.lastInsertRowid,
      product_id,
      copy_type: copy_type || "full",
      platform: platform || "facebook",
      tone: tone || "professional",
      copies: result.copies,
      context_summary: result.context_summary,
    });
  } catch (err) {
    console.error("Failed to generate ad copy:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /generate-with-media — 미디어(이미지/비디오) 첨부 광고 카피 생성
router.post("/generate-with-media", (req, res, next) => {
  uploadMedia(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const product_id = parseInt(req.body.product_id);
    const copy_type = req.body.copy_type || "full";
    const platform = req.body.platform || "facebook";
    const tone = req.body.tone || "professional";
    const custom_instruction = req.body.custom_instruction || "";
    const media_emphasis = req.body.media_emphasis || "";

    if (!product_id) {
      return res.status(400).json({ error: "product_id is required" });
    }

    const db = getDb();
    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(product_id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    const hasReviews = db.prepare("SELECT COUNT(*) as cnt FROM product_reviews WHERE product_id = ?").get(product_id)?.cnt > 0;
    if (!hasReviews) {
      return res.status(400).json({ error: "이 제품의 리뷰 분석 데이터가 없습니다. 먼저 리뷰 분석을 실행해주세요." });
    }

    // 미디어 파일 처리
    let mediaContext = null;
    let mediaFilename = null;
    let mediaType = null;

    if (req.file) {
      let imagePath = req.file.path;

      if (isVideoFile(req.file.mimetype)) {
        mediaType = "video";
        console.log(`[Ad Copy] Extracting thumbnail from video: ${req.file.filename}`);
        imagePath = await extractVideoThumbnail(req.file.path, UPLOAD_DIR);
      } else {
        mediaType = "image";
      }

      const imageBuffer = fs.readFileSync(imagePath);
      const base64 = imageBuffer.toString("base64");
      const mimeType = mediaType === "video" ? "image/jpeg" : req.file.mimetype;

      mediaContext = {
        base64,
        mediaType: mimeType,
        originalType: mediaType,
        emphasis: media_emphasis || null,
      };
      mediaFilename = req.file.filename;

      console.log(`[Ad Copy] Media attached: ${mediaType} (${req.file.filename}), emphasis: "${media_emphasis || "없음"}"`);
    }

    console.log(`[Ad Copy] Generating copy for product: ${product.name} (media: ${mediaType || "없음"})`);

    const result = await generateAdCopy(product_id, { copy_type, platform, tone, custom_instruction }, mediaContext);

    const insertResult = db.prepare(`
      INSERT INTO ad_copy_generations (product_id, copy_type, platform, tone, generated_copies, review_context, ad_library_context, media_filename, media_type, media_emphasis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product_id, copy_type, platform, tone,
      JSON.stringify(result.copies),
      JSON.stringify(result.review_context),
      JSON.stringify(result.ad_library_context),
      mediaFilename, mediaType, media_emphasis || null,
    );

    console.log(`[Ad Copy] Generated ${result.copies.length} copies with media, saved as ID: ${insertResult.lastInsertRowid}`);

    res.json({
      id: insertResult.lastInsertRowid,
      product_id,
      copy_type, platform, tone,
      copies: result.copies,
      context_summary: result.context_summary,
      has_media: !!mediaContext,
      media_type: mediaType,
    });
  } catch (err) {
    console.error("Failed to generate ad copy with media:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /history/:productId — 해당 제품의 카피 생성 히스토리
router.get("/history/:productId", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, product_id, copy_type, platform, tone, generated_copies, user_feedback, performance_data, created_at
      FROM ad_copy_generations
      WHERE product_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(req.params.productId);

    const history = rows.map((row) => {
      const copies = JSON.parse(row.generated_copies || "[]");
      const feedback = row.user_feedback ? JSON.parse(row.user_feedback) : null;
      const performance = row.performance_data ? JSON.parse(row.performance_data) : null;
      return {
        id: row.id,
        product_id: row.product_id,
        copy_type: row.copy_type,
        platform: row.platform,
        tone: row.tone,
        copies_count: copies.length,
        user_rating: feedback?.rating || null,
        has_performance: !!performance,
        created_at: row.created_at,
      };
    });

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — 특정 카피 생성 결과 상세 조회
router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare("SELECT * FROM ad_copy_generations WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Ad copy generation not found" });

    res.json({
      ...row,
      generated_copies: JSON.parse(row.generated_copies || "[]"),
      review_context: JSON.parse(row.review_context || "{}"),
      ad_library_context: JSON.parse(row.ad_library_context || "{}"),
      user_feedback: row.user_feedback ? JSON.parse(row.user_feedback) : null,
      performance_data: row.performance_data ? JSON.parse(row.performance_data) : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/feedback — 사용자 피드백 저장 (별점 + 선택한 카피 인덱스)
router.put("/:id/feedback", (req, res) => {
  try {
    const { rating, selected_index, notes } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating (1-5) is required" });
    }

    const db = getDb();
    const row = db.prepare("SELECT id FROM ad_copy_generations WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Ad copy generation not found" });

    const feedback = { rating, selected_index: selected_index ?? null, notes: notes || null };

    db.prepare("UPDATE ad_copy_generations SET user_feedback = ?, selected_copy_index = ? WHERE id = ?")
      .run(JSON.stringify(feedback), selected_index ?? null, req.params.id);

    res.json({ updated: true, feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id/performance — 캠페인 성과 데이터 연동 (학습용)
router.put("/:id/performance", (req, res) => {
  try {
    const { campaign_id, ctr, roas, cpc, conversions, impressions, clicks, notes } = req.body;

    const db = getDb();
    const row = db.prepare("SELECT id FROM ad_copy_generations WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Ad copy generation not found" });

    const perfData = { ctr, roas, cpc, conversions, impressions, clicks, notes, recorded_at: new Date().toISOString() };

    db.prepare("UPDATE ad_copy_generations SET campaign_id = ?, performance_data = ? WHERE id = ?")
      .run(campaign_id || null, JSON.stringify(perfData), req.params.id);

    console.log(`[Ad Copy] Performance data recorded for copy #${req.params.id}: CTR=${ctr}%, ROAS=${roas}x`);

    res.json({ updated: true, performance: perfData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

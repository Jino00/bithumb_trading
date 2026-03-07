// 캠페인 퍼블리시 라우트 — AI 카피를 Meta 광고로 자동 생성 (이미지 + 비디오 지원)
import { Router } from "express";
import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db/database.js";
import {
  fetchPages,
  createMetaCampaign,
  createMetaAdSet,
  uploadAdImage,
  uploadAdVideo,
  createAdCreative,
  createVideoAdCreative,
  createMetaAd,
  delay,
} from "../services/meta-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// ─── 헬퍼: 인증 정보 조회 ───

function getCredentials() {
  const db = getDb();
  const cred = db.prepare(
    "SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'"
  ).get();
  if (!cred || !cred.access_token) {
    return { error: "Meta 계정이 연결되어 있지 않습니다. Settings에서 연결하세요." };
  }
  if (!cred.selected_ad_account_id) {
    return { error: "광고 계정이 선택되어 있지 않습니다. Settings에서 선택하세요." };
  }
  return { accessToken: cred.access_token, adAccountId: cred.selected_ad_account_id };
}

// ─── GET /pages — Facebook Page 목록 ───

router.get("/pages", async (_req, res) => {
  try {
    const cred = getCredentials();
    if (cred.error) return res.status(400).json({ error: cred.error });

    const result = await fetchPages(cred.accessToken);
    if (result.error) {
      return res.status(500).json({ error: result.error });
    }
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /publish — 캠페인 자동 생성 ───

router.post("/publish", async (req, res) => {
  try {
    const cred = getCredentials();
    if (cred.error) return res.status(400).json({ success: false, error: cred.error });

    const {
      ad_copy_generation_id,
      copy_index = 0,
      campaign_name,
      objective = "OUTCOME_TRAFFIC",
      daily_budget,
      targeting,
      optimization_goal = "LINK_CLICKS",
      start_time,
      page_id,
      link_url,
      cta_type = "LEARN_MORE",
    } = req.body;

    // 필수 값 검증
    if (!ad_copy_generation_id) {
      return res.status(400).json({ success: false, error: "ad_copy_generation_id는 필수입니다." });
    }
    if (!campaign_name) {
      return res.status(400).json({ success: false, error: "campaign_name은 필수입니다." });
    }
    if (!daily_budget || daily_budget <= 0) {
      return res.status(400).json({ success: false, error: "daily_budget는 0보다 커야 합니다." });
    }
    if (!page_id) {
      return res.status(400).json({ success: false, error: "Facebook Page를 선택하세요." });
    }
    if (!link_url) {
      return res.status(400).json({ success: false, error: "랜딩 URL은 필수입니다." });
    }

    // 카피 데이터 조회
    const db = getDb();
    const generation = db.prepare(
      "SELECT generated_copies, media_filename, media_type FROM ad_copy_generations WHERE id = ?"
    ).get(ad_copy_generation_id);

    if (!generation) {
      return res.status(404).json({ success: false, error: "해당 카피 생성 기록을 찾을 수 없습니다." });
    }

    const copies = JSON.parse(generation.generated_copies);
    const selectedCopy = copies[copy_index];
    if (!selectedCopy) {
      return res.status(400).json({ success: false, error: `copy_index ${copy_index}에 해당하는 카피가 없습니다.` });
    }

    const { headline, body, cta } = selectedCopy;
    const { accessToken, adAccountId } = cred;
    const partialResults = {};

    // Step 1: 미디어 업로드 (이미지 또는 비디오)
    let imageHash = null;
    let videoId = null;

    if (generation.media_filename) {
      const mediaPath = join(__dirname, "..", "uploads", generation.media_filename);

      if (generation.media_type === "video") {
        // 비디오 업로드
        console.log(`[Publish] Uploading video to Meta: ${generation.media_filename}`);
        const videoResult = await uploadAdVideo(accessToken, adAccountId, mediaPath);
        if (videoResult.error) {
          console.warn("Video upload failed (continuing without video):", videoResult.error);
        } else {
          videoId = videoResult.data.id;
          partialResults.video_id = videoId;
        }
        // 썸네일도 이미지로 업로드 (비디오 광고의 커버 이미지)
        const thumbPath = mediaPath.replace(/\.[^.]+$/, "-thumb.jpg");
        console.log(`[Publish] Checking thumbnail: ${thumbPath}, exists: ${fs.existsSync(thumbPath)}`);
        if (fs.existsSync(thumbPath)) {
          console.log("[Publish] Uploading thumbnail as cover image...");
          const imgResult = await uploadAdImage(accessToken, adAccountId, thumbPath);
          if (imgResult.error) {
            console.warn("[Publish] Thumbnail upload failed:", imgResult.error);
          } else if (imgResult.data?.images) {
            const imageKeys = Object.keys(imgResult.data.images);
            if (imageKeys.length > 0) {
              imageHash = imgResult.data.images[imageKeys[0]].hash;
              partialResults.image_hash = imageHash;
              console.log(`[Publish] Thumbnail uploaded, hash: ${imageHash}`);
            }
          }
        }
      } else if (generation.media_type === "image") {
        // 기존 이미지 업로드
        const imgResult = await uploadAdImage(accessToken, adAccountId, mediaPath);
        if (imgResult.error) {
          console.warn("Image upload failed (continuing without image):", imgResult.error);
        } else if (imgResult.data?.images) {
          const imageKeys = Object.keys(imgResult.data.images);
          if (imageKeys.length > 0) {
            imageHash = imgResult.data.images[imageKeys[0]].hash;
            partialResults.image_hash = imageHash;
          }
        }
      }
      await delay(500);
    }

    // Step 2: Campaign 생성
    console.log(`[Publish] Step 2: Creating campaign "${campaign_name}"...`);
    const campaignResult = await createMetaCampaign(accessToken, adAccountId, {
      name: campaign_name,
      objective,
      status: "PAUSED",
      special_ad_categories: ["NONE"],
    });
    if (campaignResult.error) {
      return res.status(500).json({
        success: false,
        error: `캠페인 생성 실패: ${campaignResult.error}`,
        partial_results: partialResults,
      });
    }
    const metaCampaignId = campaignResult.data.id;
    partialResults.meta_campaign_id = metaCampaignId;
    await delay(500);

    // Step 3: Ad Set 생성
    console.log(`[Publish] Step 3: Creating ad set...`);
    const adsetResult = await createMetaAdSet(accessToken, adAccountId, {
      name: `${campaign_name} - Ad Set`,
      campaign_id: metaCampaignId,
      daily_budget,
      optimization_goal,
      targeting: targeting || { geo_locations: { countries: ["KR"] }, age_min: 18, age_max: 65 },
      start_time: start_time || new Date().toISOString(),
      status: "PAUSED",
    });
    if (adsetResult.error) {
      savePublishedCampaign(db, {
        ad_copy_generation_id, copy_index, campaign_name, objective, daily_budget,
        targeting, page_id, link_url, meta_campaign_id: metaCampaignId,
        publish_error: `Ad Set 생성 실패: ${adsetResult.error}`,
      });
      return res.status(500).json({
        success: false,
        error: `Ad Set 생성 실패: ${adsetResult.error}`,
        partial_results: partialResults,
      });
    }
    const metaAdsetId = adsetResult.data.id;
    partialResults.meta_adset_id = metaAdsetId;
    await delay(500);

    // Step 4: Ad Creative 생성 (비디오/이미지 분기)
    console.log(`[Publish] Step 4: Creating creative (videoId: ${videoId || "none"}, imageHash: ${imageHash || "none"})...`);
    let creativeResult;
    if (videoId) {
      creativeResult = await createVideoAdCreative(accessToken, adAccountId, {
        name: `${campaign_name} - Video Creative`,
        page_id,
        video_id: videoId,
        link: link_url,
        message: body || "",
        headline: headline || "",
        cta_type,
        image_hash: imageHash,
      });
    } else {
      creativeResult = await createAdCreative(accessToken, adAccountId, {
        name: `${campaign_name} - Creative`,
        page_id,
        link: link_url,
        message: body || "",
        headline: headline || "",
        cta_type,
        image_hash: imageHash,
      });
    }
    if (creativeResult.error) {
      savePublishedCampaign(db, {
        ad_copy_generation_id, copy_index, campaign_name, objective, daily_budget,
        targeting, page_id, link_url, meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdsetId,
        publish_error: `Creative 생성 실패: ${creativeResult.error}`,
      });
      return res.status(500).json({
        success: false,
        error: `Creative 생성 실패: ${creativeResult.error}`,
        partial_results: partialResults,
      });
    }
    const metaCreativeId = creativeResult.data.id;
    partialResults.meta_creative_id = metaCreativeId;
    await delay(500);

    // Step 5: Ad 생성
    console.log(`[Publish] Step 5: Creating ad...`);
    const adResult = await createMetaAd(accessToken, adAccountId, {
      name: `${campaign_name} - Ad`,
      adset_id: metaAdsetId,
      creative_id: metaCreativeId,
      status: "PAUSED",
    });
    if (adResult.error) {
      savePublishedCampaign(db, {
        ad_copy_generation_id, copy_index, campaign_name, objective, daily_budget,
        targeting, page_id, link_url, meta_campaign_id: metaCampaignId,
        meta_adset_id: metaAdsetId, meta_creative_id: metaCreativeId,
        publish_error: `Ad 생성 실패: ${adResult.error}`,
      });
      return res.status(500).json({
        success: false,
        error: `Ad 생성 실패: ${adResult.error}`,
        partial_results: partialResults,
      });
    }
    const metaAdId = adResult.data.id;

    // Step 6: DB 저장
    const publishedId = savePublishedCampaign(db, {
      ad_copy_generation_id, copy_index, campaign_name, objective, daily_budget,
      targeting, page_id, link_url,
      meta_campaign_id: metaCampaignId,
      meta_adset_id: metaAdsetId,
      meta_creative_id: metaCreativeId,
      meta_ad_id: metaAdId,
    });

    // ad_copy_generations에 연결
    db.prepare(
      "UPDATE ad_copy_generations SET published_campaign_id = ? WHERE id = ?"
    ).run(publishedId, ad_copy_generation_id);

    res.json({
      success: true,
      meta_campaign_id: metaCampaignId,
      meta_adset_id: metaAdsetId,
      meta_creative_id: metaCreativeId,
      meta_ad_id: metaAdId,
      published_campaign_id: publishedId,
    });
  } catch (err) {
    console.error("Campaign publish error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /published — 퍼블리시 이력 ───

router.get("/published", (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM published_campaigns ORDER BY created_at DESC LIMIT 50"
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 헬퍼: DB 저장 ───

function savePublishedCampaign(db, data) {
  const result = db.prepare(`
    INSERT INTO published_campaigns (
      ad_copy_generation_id, copy_index, meta_campaign_id, meta_adset_id,
      meta_creative_id, meta_ad_id, campaign_name, objective, daily_budget,
      targeting, page_id, link_url, publish_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.ad_copy_generation_id,
    data.copy_index || 0,
    data.meta_campaign_id || null,
    data.meta_adset_id || null,
    data.meta_creative_id || null,
    data.meta_ad_id || null,
    data.campaign_name,
    data.objective || null,
    data.daily_budget || null,
    data.targeting ? JSON.stringify(data.targeting) : null,
    data.page_id || null,
    data.link_url || null,
    data.publish_error || null
  );
  return result.lastInsertRowid;
}

export default router;

// 캠페인 퍼블리시 라우트 — AI 카피를 Meta 광고로 자동 생성 (이미지 + 비디오 지원)
// ※ 학습 반영 (v2): 성공 캠페인 패턴에서 추천 설정을 도출하여 신규 광고 생성 시 제안
import { Router } from "express";
import fs from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db/database.js";
import { getBenchmarks, assessDataMaturity } from "../services/trend-intelligence.js";
import {
  fetchPages,
  createMetaCampaign,
  createMetaAdSet,
  uploadAdImage,
  uploadAdVideo,
  waitForVideoReady,
  createAdCreative,
  createVideoAdCreative,
  createMetaAd,
  delay,
} from "../services/meta-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// ─── 헬퍼: UTM 태그 자동 생성 ───

function buildUtmParams(campaignName, copyIndex) {
  const safeCampaignName = (campaignName || "unknown")
    .replace(/[^a-zA-Z0-9가-힣_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80);
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    utm_source: "meta",
    utm_medium: "paid",
    utm_campaign: safeCampaignName,
    utm_content: `copy_${copyIndex}`,
    utm_term: timestamp,
  };
}

function appendUtmToUrl(url, utmParams) {
  try {
    const urlObj = new URL(url);
    for (const [key, value] of Object.entries(utmParams)) {
      urlObj.searchParams.set(key, value);
    }
    return urlObj.toString();
  } catch {
    // URL 파싱 실패 시 수동으로 쿼리 파라미터 추가
    const sep = url.includes("?") ? "&" : "?";
    const qs = Object.entries(utmParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return `${url}${sep}${qs}`;
  }
}

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

    const primaryText = selectedCopy.primary_text || selectedCopy.body || "";
    const headline = selectedCopy.headline || "";
    const description = selectedCopy.description || "";
    const body = primaryText;  // 하위 호환성
    const { accessToken, adAccountId } = cred;
    const partialResults = {};

    // UTM 태그 자동 생성 → link_url에 추가
    const utmParams = buildUtmParams(campaign_name, copy_index);
    const linkUrlWithUtm = appendUtmToUrl(link_url, utmParams);
    console.log(`[Publish] Link URL with UTM: ${linkUrlWithUtm}`);

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

          // 비디오 인코딩 완료 대기 (Meta 서버에서 처리 필요)
          console.log(`[Publish] Waiting for Meta video processing...`);
          const readyResult = await waitForVideoReady(accessToken, videoId, 300000);
          if (readyResult.error) {
            console.warn(`[Publish] Video processing issue: ${readyResult.error}`);
          }
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
      special_ad_categories: [],
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

    // Step 3: Ad Set 생성 (픽셀 자동 조회 — OFFSITE_CONVERSIONS 필수)
    let promoted_object = null;
    if (optimization_goal === "OFFSITE_CONVERSIONS") {
      try {
        const pixelRes = await fetch(
          `https://graph.facebook.com/v21.0/${adAccountId}/adspixels?fields=id,name&limit=1&access_token=${accessToken}`,
          { signal: AbortSignal.timeout(10000) }
        );
        const pixelJson = await pixelRes.json();
        if (pixelJson.data?.[0]?.id) {
          promoted_object = { pixel_id: pixelJson.data[0].id, custom_event_type: "PURCHASE" };
          console.log(`[Publish] Pixel found: ${pixelJson.data[0].name} (${pixelJson.data[0].id})`);
        }
      } catch (e) {
        console.warn("[Publish] Pixel lookup failed:", e.message);
      }
    }

    console.log(`[Publish] Step 3: Creating ad set...`);
    const adsetResult = await createMetaAdSet(accessToken, adAccountId, {
      name: `${campaign_name} - Ad Set`,
      campaign_id: metaCampaignId,
      daily_budget,
      optimization_goal,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      promoted_object,
      targeting: {
        ...(targeting || { geo_locations: { countries: ["KR"] }, age_min: 18, age_max: 65 }),
        targeting_automation: { advantage_audience: 0 },
      },
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
        link: linkUrlWithUtm,
        message: primaryText || "",
        headline: headline || "",
        description: description || "",
        cta_type,
        image_hash: imageHash,
      });
    } else {
      creativeResult = await createAdCreative(accessToken, adAccountId, {
        name: `${campaign_name} - Creative`,
        page_id,
        link: linkUrlWithUtm,
        message: primaryText || "",
        headline: headline || "",
        description: description || "",
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
    const metaAdId = adResult.data?.id;
    console.log(`[Publish] Ad created: ${metaAdId}, adResult.data: ${JSON.stringify(adResult.data).substring(0, 200)}`);

    // Step 6: DB 저장 (UTM 포함 URL 저장)
    const publishedId = savePublishedCampaign(db, {
      ad_copy_generation_id, copy_index, campaign_name, objective, daily_budget,
      targeting, page_id, link_url: linkUrlWithUtm,
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
      link_url_with_utm: linkUrlWithUtm,
      utm_params: utmParams,
    });
  } catch (err) {
    console.error("Campaign publish error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /recommendations — 학습 기반 신규 캠페인 추천 설정 ───

router.get("/recommendations", (_req, res) => {
  try {
    const db = getDb();
    const maturity = assessDataMaturity(db);

    // 벤치마크 로드
    let benchmarks = null;
    try {
      const bData = getBenchmarks("30d");
      if (bData && Object.keys(bData.metrics).length > 0) {
        benchmarks = bData.metrics;
      }
    } catch { /* 벤치마크 없으면 건너뛰기 */ }

    // 성공 캠페인 분석 (ROAS ≥ p75 또는 ≥ 2.0x)
    const roasThreshold = benchmarks?.roas?.p75 || 2.0;
    const successCampaigns = db.prepare(`
      SELECT pc.*, cs.roas, cs.ctr, cs.cpc, cs.frequency, cs.cpa
      FROM published_campaigns pc
      JOIN campaigns c ON c.meta_campaign_id = pc.meta_campaign_id
      JOIN campaign_snapshots cs ON cs.campaign_id = c.id
      WHERE cs.roas >= ? AND pc.publish_error IS NULL
      ORDER BY cs.roas DESC
    `).all(roasThreshold);

    // 추천 예산: 성공 캠페인의 예산 중앙값
    const budgets = successCampaigns
      .map((c) => c.daily_budget)
      .filter((b) => b && b > 0)
      .sort((a, b) => a - b);
    const medianBudget = budgets.length > 0
      ? budgets[Math.floor(budgets.length / 2)]
      : null;

    // 추천 목표: 성공 캠페인의 최빈 objective
    const objCounts = {};
    for (const c of successCampaigns) {
      if (c.objective) objCounts[c.objective] = (objCounts[c.objective] || 0) + 1;
    }
    const topObjective = Object.entries(objCounts).sort(([, a], [, b]) => b - a)[0];

    // 타겟팅 추천: action_effectiveness에서 targeting_broaden 성공률 확인
    let targetingRec = null;
    try {
      const broadEffect = db.prepare(
        "SELECT success_rate, times_applied, avg_ctr_change FROM action_effectiveness WHERE action_type = 'targeting_broaden'"
      ).get();
      if (broadEffect && broadEffect.times_applied >= 2 && broadEffect.success_rate > 50) {
        targetingRec = {
          value: "broad",
          confidence: broadEffect.success_rate >= 70 ? "high" : "medium",
          evidence: `Broad 타겟 전환 성공률 ${Math.round(broadEffect.success_rate)}% (${broadEffect.times_applied}건)`,
        };
      }
    } catch { /* 없으면 건너뛰기 */ }

    // CTA 추천: 성공 캠페인의 CTA 분포 분석은 published_campaigns에 cta 저장 안 됨
    // → 대신 벤치마크 기반 일반 추천
    const recommendations = {
      recommended_budget: medianBudget ? {
        value: medianBudget,
        confidence: budgets.length >= 5 ? "high" : budgets.length >= 2 ? "medium" : "low",
        evidence: `ROAS ≥${roasThreshold.toFixed(1)}x 캠페인 ${budgets.length}건의 중앙값`,
      } : null,

      recommended_objective: topObjective ? {
        value: topObjective[0],
        confidence: topObjective[1] >= 3 ? "high" : "medium",
        evidence: `성공 캠페인의 ${Math.round((topObjective[1] / successCampaigns.length) * 100)}%가 사용`,
      } : null,

      recommended_targeting: targetingRec,

      benchmarks: benchmarks ? {
        avg_roas: benchmarks.roas?.avg || 0,
        avg_ctr: benchmarks.ctr?.avg || 0,
        avg_cpc: benchmarks.cpc?.avg || 0,
        avg_cpa: benchmarks.cpa?.avg || 0,
      } : null,

      data_maturity: maturity.level,
      maturity_description: maturity.description,
      success_campaign_count: successCampaigns.length,
    };

    res.json(recommendations);
  } catch (err) {
    console.error("[Recommendations] Error:", err.message);
    res.status(500).json({ error: err.message });
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

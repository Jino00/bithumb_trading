// Claude AI 분석 엔진 — 캠페인 분석 + 추천 (규칙 기반 자동 판단 + AI 분석)
import { Router } from "express";
import { getDb } from "../db/database.js";
import { callClaude } from "../services/claude-client.js";
import { judgeAllCampaigns } from "../services/campaign-judge.js";
import {
  takeSnapshotAll,
  getCampaignTrend,
  logImprovement,
  getImprovementHistory,
} from "../services/snapshot-service.js";
import {
  recomputeAll,
  getBenchmarks,
  getCampaignMetricTrends,
  getActionEffectiveness,
  getCampaignHealthReport,
  getSmartRecommendations,
} from "../services/trend-intelligence.js";
import { crossValidate } from "../services/data-cross-validator.js";
import { syncCafe24OrdersJob } from "../services/cafe24-sync-job.js";
import {
  fetchAccountInsights,
  mapAccountInsightToSchema,
} from "../services/meta-api.js";
import { generatePostMortemReport } from "../services/postmortem-service.js";
import { calcCampaignProfitability, calcProfitabilitySummary } from "../services/biz-metrics.js";

const router = Router();

function generateMockAnalysis(_prompt) {
  return JSON.stringify({
    campaigns: [
      {
        id: 1,
        name: "Summer Sale 2025",
        verdict: "MAINTAIN",
        fix_type: null,
        reasoning: "All KPIs are within excellent range. CTR 3.2% is well above 2% threshold, ROAS 4.1x exceeds 3x target, CPC $0.89 is under $1.5 limit, and frequency 2.1 is healthy.",
        action_items: ["Continue current creative strategy", "Consider 10-15% budget increase", "Test new audience segments with similar targeting"],
        estimated_improvement: "5-10% with budget scaling",
        copy_alternatives: null,
      },
      {
        id: 2,
        name: "Brand Awareness Q1",
        verdict: "PAUSE",
        fix_type: "PAUSE",
        reasoning: "Critical underperformance across all metrics. CTR 0.8% is poor, ROAS 1.4x is well below breakeven threshold, CPC $4.20 is extremely high, and frequency 6.8 indicates severe ad fatigue.",
        action_items: ["Stop spending immediately — negative ROI", "Audience is oversaturated (freq 6.8)", "Complete creative and targeting overhaul needed before relaunch"],
        estimated_improvement: "N/A — pause and rebuild",
        copy_alternatives: null,
      },
      {
        id: 3,
        name: "Retargeting - Cart Abandoners",
        verdict: "MODIFY",
        fix_type: "COPY_ONLY",
        reasoning: "Moderate performance with room for improvement. CTR 1.5% is in warning zone, ROAS 2.3x is below 3x target. Frequency 4.2 suggests some fatigue. Copy refresh should help re-engage the audience.",
        action_items: ["Refresh ad copy with urgency messaging", "Add social proof elements", "Test limited-time discount messaging"],
        estimated_improvement: "15-25% CTR lift with fresh copy",
        copy_alternatives: [
          "Still thinking about it? Your cart items are selling fast — complete your order before they're gone!",
          "We saved your favorites! Come back and enjoy free shipping on your cart — today only.",
          "Don't miss out! The items in your cart have a special 10% discount waiting for you.",
        ],
      },
      {
        id: 4,
        name: "Lookalike - Top Customers",
        verdict: "MODIFY",
        fix_type: "CREATIVE_REFRESH",
        reasoning: "Below-target performance indicating creative fatigue. CTR 1.1% and ROAS 1.9x are both in warning zone. CPC $2.80 is high. Frequency 3.9 shows the audience has seen the ads too many times.",
        action_items: ["Design new visual assets with fresh angles", "Test video ads vs static images", "Update color schemes and imagery", "Refresh value proposition presentation"],
        estimated_improvement: "20-35% improvement with new creatives",
        copy_alternatives: null,
      },
      {
        id: 5,
        name: "New Product Launch",
        verdict: "MAINTAIN",
        fix_type: null,
        reasoning: "Strong performance across all metrics. CTR 2.8% is excellent, ROAS 3.5x exceeds target, CPC $1.10 is efficient, and frequency 1.8 means the audience is fresh.",
        action_items: ["Scale budget gradually (15-20% weekly)", "Expand to similar audience segments", "Create retargeting funnel for engaged users"],
        estimated_improvement: "10-15% with careful scaling",
        copy_alternatives: null,
      },
    ],
  });
}

// ─── 수익성 분석 API (원가 기반, biz-metrics SSOT 사용) ───
router.get("/profitability", async (req, res) => {
  try {
    const db = getDb();
    const since = req.query.since;
    const until = req.query.until;
    const isCustomRange = since && until;

    const period = isCustomRange ? "custom" : (req.query.period || "30d");
    if (!isCustomRange) {
      const validPeriods = ["1d", "7d", "15d", "30d"];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({ error: `Invalid period. Use: ${validPeriods.join(", ")} or since/until params` });
      }
    }

    // Meta API에서 기간별 데이터 조회 (DB 누적 데이터 사용 금지 — CLAUDE.md 규칙)
    const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'").get();
    const adAccountId = cred?.selected_ad_account_id;

    const effectivePeriod = isCustomRange
      ? `${Math.max(1, Math.ceil((new Date(until) - new Date(since)) / 86400000) + 1)}d`
      : period;

    let campaigns = [];
    if (cred && adAccountId) {
      const result = isCustomRange
        ? await fetchAccountInsights(cred.access_token, adAccountId, "30d", { since, until })
        : await fetchAccountInsights(cred.access_token, adAccountId, period);
      if (result.error) {
        return res.status(400).json({ error: `Meta API error: ${result.error}` });
      }
      campaigns = (result.data || []).map((insight, idx) => ({
        id: 10000 + idx,
        ...mapAccountInsightToSchema(insight, effectivePeriod),
        source: "meta",
      }));
    } else {
      campaigns = db.prepare("SELECT * FROM campaigns WHERE source = 'meta' AND status = 'active'").all();
    }

    // 원가 데이터 매칭
    const costs = db.prepare("SELECT * FROM product_costs").all();
    const costMap = {};
    for (const c of costs) costMap[c.campaign_name] = c;

    // 수익성 계산 — biz-metrics.js SSOT 함수 사용
    const results = campaigns.map((camp) => {
      const cost = costMap[camp.name];
      const p = calcCampaignProfitability({
        costPrice: cost?.cost_price || 0,
        purchases: camp.purchase_count || 0,
        revenue: camp.revenue || 0,
        adSpend: camp.total_spend || 0,
        aov: camp.aov || 0,
      });

      return {
        campaign_id: camp.id,
        campaign_name: camp.name,
        product_name: cost?.product_name || "미등록",
        cost_price: cost?.cost_price || 0,
        purchases: camp.purchase_count || 0,
        revenue: camp.revenue || 0,
        ad_spend: camp.total_spend || 0,
        roas: camp.roas,
        ...p,
      };
    });

    // 집계 — biz-metrics.js SSOT 함수 사용
    const summaryInput = results.map((r) => ({
      revenue: r.revenue,
      adSpend: r.ad_spend,
      cogs: r.cogs,
      isProfitable: r.isProfitable,
    }));
    const s = calcProfitabilitySummary(summaryInput);

    res.json({
      period,
      campaigns: results,
      summary: {
        total_revenue: s.totalRevenue,
        total_cogs: s.totalCogs,
        total_ad_spend: s.totalAdSpend,
        total_gross_profit: s.totalRevenue - s.totalCogs,
        total_net_profit: s.totalNetProfit,
        overall_net_margin: s.overallNetMargin,
        overall_true_roi: s.overallTrueRoi,
        profitable_campaigns: s.profitableCount,
        total_campaigns: s.totalCampaigns,
        is_profitable: s.isProfitable,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 원가 관리 API ───
router.get("/product-costs", (_req, res) => {
  try {
    const db = getDb();
    const costs = db.prepare("SELECT * FROM product_costs ORDER BY campaign_name").all();
    res.json(costs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/product-costs", (req, res) => {
  try {
    const db = getDb();
    const { campaign_name, product_name, cost_price } = req.body;
    if (!campaign_name || !product_name || cost_price == null) {
      return res.status(400).json({ error: "campaign_name, product_name, cost_price 필요" });
    }
    const camp = db.prepare("SELECT id, meta_campaign_id FROM campaigns WHERE name = ?").get(campaign_name);
    db.prepare(
      "INSERT OR REPLACE INTO product_costs (campaign_id, meta_campaign_id, campaign_name, product_name, cost_price) VALUES (?, ?, ?, ?, ?)"
    ).run(camp?.id || null, camp?.meta_campaign_id || null, campaign_name, product_name, cost_price);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 규칙 기반 자동 판단 (AI 없이 즉시 실행, 무료) ───
router.post("/judge-all", async (req, res) => {
  try {
    const db = getDb();
    const since = req.query.since;
    const until = req.query.until;
    const isCustomRange = since && until;

    const period = isCustomRange ? "custom" : (req.query.period || req.body.period || "30d");
    if (!isCustomRange) {
      const validPeriods = ["1d", "7d", "15d", "30d"];
      if (!validPeriods.includes(period)) {
        return res.status(400).json({ error: `Invalid period. Use: ${validPeriods.join(", ")} or since/until params` });
      }
    }

    // Meta API에서 기간별 데이터를 가져옴 (DB 누적 데이터 대신)
    const cred = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials WHERE user_id = 'default'").get();
    const adAccountId = cred?.selected_ad_account_id;

    const effectivePeriod = isCustomRange
      ? `${Math.max(1, Math.ceil((new Date(until) - new Date(since)) / 86400000) + 1)}d`
      : period;

    let campaigns = [];
    if (cred && adAccountId) {
      const result = isCustomRange
        ? await fetchAccountInsights(cred.access_token, adAccountId, "30d", { since, until })
        : await fetchAccountInsights(cred.access_token, adAccountId, period);
      if (result.error) {
        return res.status(400).json({ error: `Meta API error: ${result.error}` });
      }
      campaigns = (result.data || []).map((insight, idx) => ({
        id: 10000 + idx,
        ...mapAccountInsightToSchema(insight, effectivePeriod),
        source: "meta",
      }));
    } else {
      // Meta 미연결 시 DB fallback
      campaigns = db.prepare("SELECT * FROM campaigns WHERE source = 'meta' AND status = 'active'").all();
    }

    if (campaigns.length === 0) {
      return res.json({ judgments: [], summary: null, period, message: "No Meta campaigns found. Sync first." });
    }

    // 원가 데이터 주입
    const costs = db.prepare("SELECT * FROM product_costs").all();
    const costMap = {};
    for (const c of costs) costMap[c.campaign_name] = c;
    for (const camp of campaigns) {
      const cost = costMap[camp.name];
      if (cost) {
        camp.cost_price = cost.cost_price;
        camp.product_name = cost.product_name;
      }
    }

    const { judgments, summary } = judgeAllCampaigns(campaigns, effectivePeriod);

    // 판정 결과를 DB에 저장 (meta_campaign_id로 매칭)
    const updateByMetaId = db.prepare(`
      UPDATE campaigns SET ai_verdict=?, ai_recommendation=?, ai_fix_type=?, updated_at=datetime('now')
      WHERE meta_campaign_id=?
    `);
    const updateById = db.prepare(`
      UPDATE campaigns SET ai_verdict=?, ai_recommendation=?, ai_fix_type=?, updated_at=datetime('now')
      WHERE id=?
    `);
    const saveAll = db.transaction((items) => {
      for (const j of items) {
        const recommendation = j.reasons.join(" | ") + " → " + j.recommendations.join("; ");
        const fixType = j.verdict === "PAUSE" ? "PAUSE" : j.verdict === "MODIFY" ? "CREATIVE_REFRESH" : null;
        const camp = campaigns.find(c => c.name === j.campaign_name);
        if (camp?.meta_campaign_id) {
          updateByMetaId.run(j.verdict, recommendation, fixType, camp.meta_campaign_id);
        } else if (camp?.id && camp.id < 10000) {
          updateById.run(j.verdict, recommendation, fixType, camp.id);
        }
      }
    });
    saveAll(judgments);

    res.json({ judgments, summary, period: effectivePeriod });
  } catch (err) {
    console.error("Judge error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/analyze-all", async (_req, res) => {
  try {
    const db = getDb();
    const campaigns = db.prepare("SELECT * FROM campaigns").all();

    const campaignData = campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      ctr: c.ctr,
      roas: c.roas,
      cpc: c.cpc,
      frequency: c.frequency,
      daily_spend: c.daily_spend,
      total_spend: c.total_spend,
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: c.conversions,
      revenue: c.revenue || 0,
      purchase_count: c.purchase_count || 0,
      cpa: c.cpa || 0,
      aov: c.aov || 0,
      source: c.source || "manual",
    }));

    const prompt = buildAnalysisPrompt(campaignData);
    const systemPrompt = buildSystemPrompt();
    const result = await callClaude(prompt, systemPrompt, generateMockAnalysis);

    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { campaigns: [] };
    }

    saveAnalysisResults(db, parsed.campaigns || []);

    res.json(parsed);
  } catch (err) {
    console.error("Analysis error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/analyze/:id", async (req, res) => {
  try {
    const db = getDb();
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });

    const prompt = buildSingleAnalysisPrompt(campaign);
    const systemPrompt = buildSystemPrompt();
    const result = await callClaude(prompt, systemPrompt, generateMockAnalysis);

    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/history/:campaignId", (req, res) => {
  try {
    const db = getDb();
    const logs = db
      .prepare("SELECT * FROM analysis_log WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 10")
      .all(req.params.campaignId);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Phase 4: 성과 트렌드 + 개선 추적 API ───

/** 수동으로 스냅샷 기록 (테스트/강제 실행용) */
router.post("/snapshot", (_req, res) => {
  try {
    const result = takeSnapshotAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 캠페인 성과 트렌드 조회 (최근 30일 일별 스냅샷) */
router.get("/trends/:campaignId", (req, res) => {
  try {
    const result = getCampaignTrend(parseInt(req.params.campaignId, 10));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 개선 조치 기록 */
router.post("/improvements/:campaignId", (req, res) => {
  try {
    const { action_type, description } = req.body;
    if (!action_type || !description) {
      return res.status(400).json({ error: "action_type과 description 필요" });
    }
    const result = logImprovement(
      parseInt(req.params.campaignId, 10),
      action_type,
      description
    );
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 개선 이력 + 효과 추적 조회 */
router.get("/improvements/:campaignId", (req, res) => {
  try {
    const result = getImprovementHistory(parseInt(req.params.campaignId, 10));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 트렌드 인텔리전스 API (동적 벤치마크 + 학습 데이터) ───

/** 동적 벤치마크 조회 — 우리 캠페인 데이터에서 도출된 기준값 */
router.get("/benchmarks", (req, res) => {
  try {
    const period = req.query.period || "30d";
    const result = getBenchmarks(period);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 캠페인별 메트릭 트렌드 조회 — 각 지표의 방향/이동평균/변동성 */
router.get("/metric-trends/:campaignId", (req, res) => {
  try {
    const result = getCampaignMetricTrends(parseInt(req.params.campaignId, 10));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 캠페인 종합 건강도 리포트 — 벤치마크 대비 위치 + 학습 추천 */
router.get("/health-report/:campaignId", (req, res) => {
  try {
    const result = getCampaignHealthReport(parseInt(req.params.campaignId, 10));
    if (!result) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 학습 기반 스마트 추천 — 과거 조치 효과 데이터로 우선순위 추천 */
router.get("/smart-recommendations/:campaignId", (req, res) => {
  try {
    const result = getSmartRecommendations(parseInt(req.params.campaignId, 10));
    res.json({ campaign_id: parseInt(req.params.campaignId, 10), recommendations: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 조치 효과 학습 데이터 — 어떤 유형의 개선이 가장 효과적인지 */
router.get("/action-effectiveness", (_req, res) => {
  try {
    const result = getActionEffectiveness();
    res.json({ actions: result, total: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 트렌드 인텔리전스 수동 재계산 (벤치마크 + 트렌드 + 효과 학습) */
router.post("/recompute-intelligence", (_req, res) => {
  try {
    const result = recomputeAll();
    res.json({
      success: true,
      computed: result,
      message: `벤치마크 ${result.benchmarks}건, 트렌드 ${result.trends}건, 효과 학습 ${result.effectiveness}건 계산 완료`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 크로스 검증 API (Meta Pixel vs Cafe24 Admin API) ───

/** Meta Pixel 데이터와 Cafe24 실제 주문 데이터 크로스 검증 */
router.get("/cross-validate", (req, res) => {
  try {
    const endDate = req.query.end_date || new Date().toISOString().substring(0, 10);
    const startDate = req.query.start_date || getDateNDaysAgo(30);

    const result = crossValidate(startDate, endDate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Cafe24 수동 동기화 + 크로스 검증 동시 실행 */
router.post("/sync-and-validate", async (_req, res) => {
  try {
    const syncResult = await syncCafe24OrdersJob();
    if (syncResult.skipped) {
      return res.json({
        sync: syncResult,
        validation: null,
        message: `Cafe24 동기화 스킵: ${syncResult.reason}`,
      });
    }

    // 동기화 후 크로스 검증 실행
    const endDate = new Date().toISOString().substring(0, 10);
    const startDate = getDateNDaysAgo(30);
    const validation = crossValidate(startDate, endDate);

    res.json({
      sync: {
        synced: syncResult.synced,
        meta_attributed: syncResult.meta_attributed,
        total_revenue: syncResult.total_revenue,
      },
      validation,
      message: `${syncResult.synced}건 동기화 완료, 데이터 품질 ${validation.quality_score.grade}등급`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

function buildSystemPrompt() {
  return `You are a world-class Meta Ads strategist specializing in Korean e-commerce (Cafe24 자사몰).
All monetary values are in KRW (Korean Won). ROAS is from Cafe24 Pixel (purchase_roas).

Return ONLY valid JSON in this exact format:
{
  "campaigns": [
    {
      "id": number,
      "name": string,
      "verdict": "SCALE" | "MAINTAIN" | "MODIFY" | "PAUSE",
      "fix_type": null | "COPY_ONLY" | "CREATIVE_REFRESH" | "FULL_OVERHAUL" | "PAUSE",
      "reasoning": string,
      "action_items": string[],
      "estimated_improvement": string,
      "copy_alternatives": string[] | null
    }
  ]
}

KPI Thresholds (KRW 기준):
- ROAS: 3x+ 우수(SCALE) | 2~3x 양호(MAINTAIN) | 1~2x 주의(MODIFY) | <1x 적자(PAUSE)
- CTR: 3%+ 우수 | 1.5~3% 양호 | <1% 위험
- CPC: ~₩700 우수 | ₩700~₩1,500 양호 | ₩2,000+ 위험
- CPA: ~₩15,000 우수 | ₩15,000~₩30,000 양호 | ₩40,000+ 위험
- Frequency: ~2.0 최적 | 3.0+ 피로감 | 5.0+ 교체 필요
- AOV(평균주문금액): ₩15,000~₩25,000 범위 (이 상품군)

Fix Types:
- COPY_ONLY: 헤드라인/설명/CTA만 업데이트. 한국어 카피 대안 3개 제공.
- CREATIVE_REFRESH: 이미지/영상 + 카피 교체. 크리에이티브 피로도 설명.
- FULL_OVERHAUL: 타겟팅 + 크리에이티브 + 카피 전면 재설계. 완전한 전략 제공.
- PAUSE: 즉시 지출 중단. 어떤 임계값이 위반되었는지 설명.`;
}

function buildAnalysisPrompt(campaigns) {
  const totalSpend = campaigns.reduce((s, c) => s + (c.total_spend || 0), 0);
  const totalRevenue = campaigns.reduce((s, c) => s + (c.revenue || 0), 0);
  const totalPurchases = campaigns.reduce((s, c) => s + (c.purchase_count || 0), 0);
  const overallRoas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "0";

  return `Analyze ALL of the following Meta Ads campaigns (Korean e-commerce, Cafe24 자사몰).
통화: KRW (한국 원). ROAS는 Cafe24 Pixel 기반 purchase_roas 값입니다.

전체 요약:
- 총 광고비: ₩${Math.round(totalSpend).toLocaleString()}
- 총 매출: ₩${Math.round(totalRevenue).toLocaleString()}
- 전체 ROAS: ${overallRoas}x
- 총 구매: ${totalPurchases}건
- 손익: ₩${Math.round(totalRevenue - totalSpend).toLocaleString()} (${totalRevenue >= totalSpend ? "흑자" : "적자"})

개별 캠페인 데이터:
${JSON.stringify(campaigns, null, 2)}

각 캠페인에 대해 ROAS/CTR/CPC/Frequency/CPA를 평가하고, 구체적인 한국어 개선 액션을 제안하세요. Return structured JSON.`;
}

function buildSingleAnalysisPrompt(campaign) {
  return `Analyze this Meta Ads campaign in detail:

${JSON.stringify(campaign, null, 2)}

Search for latest Meta Ads benchmarks and provide a detailed recommendation. Return structured JSON with verdict, fix_type, reasoning, action_items, estimated_improvement, and copy_alternatives if applicable.`;
}

function saveAnalysisResults(db, campaigns) {
  const updateCampaign = db.prepare(`
    UPDATE campaigns SET ai_verdict=?, ai_recommendation=?, ai_fix_type=?, updated_at=datetime('now')
    WHERE id=?
  `);
  const insertLog = db.prepare(`
    INSERT INTO analysis_log (campaign_id, verdict, fix_type, reasoning, action_items, estimated_improvement, copy_alternatives)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const save = db.transaction((items) => {
    for (const c of items) {
      updateCampaign.run(c.verdict, c.reasoning, c.fix_type, c.id);
      insertLog.run(
        c.id,
        c.verdict,
        c.fix_type,
        c.reasoning,
        JSON.stringify(c.action_items),
        c.estimated_improvement,
        c.copy_alternatives ? JSON.stringify(c.copy_alternatives) : null
      );
    }
  });

  try {
    save(campaigns);
  } catch (err) {
    console.error("Failed to save analysis results:", err.message);
  }
}

// ─── 포스트모템 분석 API ───

// POST /api/analysis/postmortem — 전체 포스트모템 생성
router.post("/postmortem", async (_req, res) => {
  try {
    const result = await generatePostMortemReport();
    res.json(result);
  } catch (err) {
    console.error("[PostMortem] generation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analysis/postmortem/:metaCampaignId — 개별 캠페인 포스트모템
router.get("/postmortem/:metaCampaignId", async (req, res) => {
  try {
    const { postMortems } = await generatePostMortemReport();
    const pm = postMortems.find(p => p.campaign.meta_campaign_id === req.params.metaCampaignId);
    if (!pm) return res.status(404).json({ error: "Campaign not found in post-mortem" });
    res.json(pm);
  } catch (err) {
    console.error("[PostMortem] single campaign error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analysis/postmortem-lessons — 저장된 학습 데이터 조회
router.get("/postmortem-lessons", (_req, res) => {
  try {
    const db = getDb();
    const lessons = db.prepare("SELECT * FROM postmortem_lessons ORDER BY confidence DESC, campaign_count DESC").all();
    res.json({ lessons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

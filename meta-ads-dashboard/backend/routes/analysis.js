// Claude AI 분석 엔진 — 캠페인 분석 + 추천
import { Router } from "express";
import { getDb } from "../db/database.js";
import { callClaude } from "../services/claude-client.js";

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

function buildSystemPrompt() {
  return `You are a world-class Meta Ads strategist with real-time web search access. Always search for the latest data before making recommendations.

Return ONLY valid JSON in this exact format:
{
  "campaigns": [
    {
      "id": number,
      "name": string,
      "verdict": "MAINTAIN" | "MODIFY" | "PAUSE",
      "fix_type": null | "COPY_ONLY" | "CREATIVE_REFRESH" | "FULL_OVERHAUL" | "PAUSE",
      "reasoning": string,
      "action_items": string[],
      "estimated_improvement": string,
      "copy_alternatives": string[] | null
    }
  ]
}

KPI Thresholds:
- CTR: Good >= 2%, Warning 1-2%, Poor < 1%
- ROAS: Good >= 3x, Warning 2-3x, Poor < 2x
- CPC: Good <= $1.5, Warning $1.5-3, Poor > $3
- Frequency: Good <= 3, Warning 3-5, Poor > 5

Fix Types:
- COPY_ONLY: Just update headlines/descriptions/CTA. Provide 3 copy alternatives.
- CREATIVE_REFRESH: Update images/videos + copy. Explain visual fatigue.
- FULL_OVERHAUL: Restructure targeting + creative + copy. Provide complete strategy.
- PAUSE: Stop spending immediately. Explain which threshold was breached.`;
}

function buildAnalysisPrompt(campaigns) {
  return `Analyze ALL of the following Meta Ads campaigns and provide recommendations for each:

${JSON.stringify(campaigns, null, 2)}

Search the web for the latest Meta Ads benchmarks and best practices, then evaluate each campaign against current industry standards. Return structured JSON.`;
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

export default router;

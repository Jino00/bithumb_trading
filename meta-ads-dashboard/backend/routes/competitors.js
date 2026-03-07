// 경쟁사 광고 인텔리전스 라우트
import { Router } from "express";
import { getDb } from "../db/database.js";
import { callClaude } from "../services/claude-client.js";

const router = Router();

function generateMockCompetitorInsights(_prompt) {
  return JSON.stringify({
    competitor_name: "Competitor",
    active_campaigns: [
      { format: "Video Ad", theme: "Social proof with customer testimonials", estimated_spend: "$500-1000/day" },
      { format: "Carousel Ad", theme: "Product showcase with lifestyle imagery", estimated_spend: "$300-600/day" },
      { format: "Stories Ad", theme: "Limited-time offers with countdown timers", estimated_spend: "$200-400/day" },
    ],
    messaging_themes: ["Urgency and scarcity", "Social proof and reviews", "Lifestyle aspiration", "Value proposition focus"],
    top_formats: ["Video (60%)", "Carousel (25%)", "Static Image (15%)"],
    creative_angles: ["User-generated content style", "Before/after comparisons", "Influencer partnerships"],
    estimated_monthly_spend: "$25,000-45,000",
    strategy_summary:
      "Heavy investment in video content with UGC-style creatives. Focus on social proof and urgency messaging. Aggressive retargeting with carousel ads showing previously viewed products.",
  });
}

router.get("/", (_req, res) => {
  try {
    const db = getDb();
    const competitors = db.prepare("SELECT * FROM competitors ORDER BY created_at DESC").all();
    const parsed = competitors.map((c) => ({
      ...c,
      insights: c.insights ? JSON.parse(c.insights) : null,
    }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", (req, res) => {
  try {
    const db = getDb();
    const { name, page_url } = req.body;
    if (!name) return res.status(400).json({ error: "Competitor name is required" });

    const result = db.prepare("INSERT INTO competitors (name, page_url) VALUES (?, ?)").run(name, page_url || null);
    const competitor = db.prepare("SELECT * FROM competitors WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(competitor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/analyze", async (req, res) => {
  try {
    const db = getDb();
    const competitor = db.prepare("SELECT * FROM competitors WHERE id = ?").get(req.params.id);
    if (!competitor) return res.status(404).json({ error: "Competitor not found" });

    const systemPrompt = `You are a competitive intelligence analyst for Meta Ads. Use web search to find real-time data about competitors' advertising strategies. Return ONLY valid JSON.`;

    const prompt = `Search the Facebook Ad Library and web for information about "${competitor.name}"${competitor.page_url ? ` (${competitor.page_url})` : ""}.

Find and analyze:
1. Their active ad campaigns (formats, themes, messaging)
2. Creative angles and messaging themes they use
3. Estimated ad spend patterns
4. Top performing ad formats

Return JSON in this format:
{
  "competitor_name": string,
  "active_campaigns": [{"format": string, "theme": string, "estimated_spend": string}],
  "messaging_themes": string[],
  "top_formats": string[],
  "creative_angles": string[],
  "estimated_monthly_spend": string,
  "strategy_summary": string
}`;

    const result = await callClaude(prompt, systemPrompt, generateMockCompetitorInsights);

    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    db.prepare("UPDATE competitors SET insights = ?, last_analyzed = datetime('now') WHERE id = ?").run(
      JSON.stringify(parsed),
      req.params.id
    );

    res.json({ ...competitor, insights: parsed, last_analyzed: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/steal-strategy", async (req, res) => {
  try {
    const db = getDb();
    const competitor = db.prepare("SELECT * FROM competitors WHERE id = ?").get(req.params.id);
    if (!competitor) return res.status(404).json({ error: "Competitor not found" });

    const insights = competitor.insights ? JSON.parse(competitor.insights) : null;
    if (!insights) return res.status(400).json({ error: "Analyze competitor first" });

    const systemPrompt = `You are a Meta Ads strategist. Based on competitor intelligence, create an adapted strategy for the user's brand. Return ONLY valid JSON.`;

    const prompt = `Based on this competitor analysis:
${JSON.stringify(insights, null, 2)}

Create an inspired (not copied) ad strategy that:
1. Adapts their winning approaches to our brand
2. Identifies gaps in their strategy we can exploit
3. Provides specific campaign recommendations

Return JSON:
{
  "strategy_name": string,
  "key_insights": string[],
  "recommended_campaigns": [{"name": string, "format": string, "targeting": string, "creative_direction": string, "estimated_budget": string}],
  "competitive_advantages": string[],
  "implementation_timeline": string
}`;

    const result = await callClaude(prompt, systemPrompt, generateMockCompetitorInsights);

    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : {
            strategy_name: "Competitive Counter-Strategy",
            key_insights: ["Leverage competitor's weakness in video content", "Target underserved audience segments"],
            recommended_campaigns: [
              {
                name: "Counter-Campaign",
                format: "Video + Carousel Mix",
                targeting: "Competitor's audience lookalikes",
                creative_direction: "UGC-style with stronger CTAs",
                estimated_budget: "$500/day",
              },
            ],
            competitive_advantages: ["Faster creative iteration", "Better targeting precision"],
            implementation_timeline: "2-3 weeks for full rollout",
          };
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM competitors WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

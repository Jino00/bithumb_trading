// 광고 캠페인 CRUD 라우트
import { Router } from "express";
import { getDb } from "../db/database.js";

const router = Router();

router.get("/", (_req, res) => {
  try {
    const db = getDb();
    const campaigns = db.prepare("SELECT * FROM campaigns ORDER BY updated_at DESC").all();
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", (req, res) => {
  try {
    const db = getDb();
    const { name, ctr, roas, cpc, frequency, daily_spend, total_spend, impressions, clicks, conversions } = req.body;
    const result = db.prepare(`
      INSERT INTO campaigns (name, ctr, roas, cpc, frequency, daily_spend, total_spend, impressions, clicks, conversions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, ctr, roas, cpc, frequency, daily_spend || 0, total_spend || 0, impressions || 0, clicks || 0, conversions || 0);
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const db = getDb();
    const { name, status, ctr, roas, cpc, frequency, daily_spend, total_spend, impressions, clicks, conversions } = req.body;
    db.prepare(`
      UPDATE campaigns SET name=?, status=?, ctr=?, roas=?, cpc=?, frequency=?,
        daily_spend=?, total_spend=?, impressions=?, clicks=?, conversions=?,
        updated_at=datetime('now')
      WHERE id=?
    `).run(name, status, ctr, roas, cpc, frequency, daily_spend, total_spend, impressions, clicks, conversions, req.params.id);
    const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(req.params.id);
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

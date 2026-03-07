// Meta Ads Intelligence Dashboard — Express 서버 진입점
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import adsRouter from "./routes/ads.js";
import analysisRouter from "./routes/analysis.js";
import competitorsRouter from "./routes/competitors.js";
import trendsRouter from "./routes/trends.js";
import metaRouter from "./routes/meta.js";
import adLibraryRouter from "./routes/ad-library.js";
import productsRouter from "./routes/products.js";
import adCopyRouter from "./routes/ad-copy.js";
import campaignPublishRouter from "./routes/campaign-publish.js";
import cafe24Router from "./routes/cafe24.js";
import { getDb } from "./db/database.js";
import { startScheduler } from "./scheduler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json());

// DB 초기화
getDb();

app.use("/api/ads", adsRouter);
app.use("/api/analysis", analysisRouter);
app.use("/api/competitors", competitorsRouter);
app.use("/api/trends", trendsRouter);
app.use("/api/meta", metaRouter);
app.use("/api/ad-library", adLibraryRouter);
app.use("/api/products", productsRouter);
app.use("/api/ad-copy", adCopyRouter);
app.use("/api/campaign-publish", campaignPublishRouter);
app.use("/api/cafe24", cafe24Router);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const server = app.listen(PORT, () => {
  console.log(`Meta Ads Intelligence API running on http://localhost:${PORT}`);
  startScheduler();
});
server.timeout = 600000;        // 10분 — 대용량 비디오 Meta 업로드 대비
server.keepAliveTimeout = 620000;

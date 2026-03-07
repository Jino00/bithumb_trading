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

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Meta Ads Intelligence API running on http://localhost:${PORT}`);
  startScheduler();
});

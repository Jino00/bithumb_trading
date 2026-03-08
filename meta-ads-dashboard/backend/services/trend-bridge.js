// trend-bridge.js — 트렌드 데이터 → 각 서비스용 포맷 변환 + 안전장치
import { getDb } from "../db/database.js";

const MAX_TREND_AGE_HOURS = 48;
const TREND_INFLUENCE_CAP = 0.15;

// 수치 범위 검증 (한국 원화 기준)
const VALID_RANGES = {
  ctr_pct: { min: 0.1, max: 10 },
  cpc_krw: { min: 100, max: 10000 },
  cpm_krw: { min: 500, max: 50000 },
  roas: { min: 0.1, max: 20 },
  frequency_cap: { min: 1, max: 10 },
};

function isNumericValid(value, key) {
  if (value == null || typeof value !== "number" || isNaN(value)) return false;
  const range = VALID_RANGES[key];
  if (!range) return true;
  return value >= range.min && value <= range.max;
}

function getLatestTrendActionable() {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM trend_actionable ORDER BY fetched_at DESC LIMIT 1"
  ).get();
  if (!row) return null;

  // 48시간 초과 검사
  const fetchedAt = new Date(row.fetched_at + "Z");
  const ageHours = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > MAX_TREND_AGE_HOURS) return null;

  return row;
}

/**
 * daily-review용 — 외부 업계 벤치마크 수치 반환
 * @returns {{ ctr_pct, cpc_krw, cpm_krw, roas, frequency_cap, confidence, is_fresh } | null}
 */
export function getExternalBenchmarks() {
  try {
    const row = getLatestTrendActionable();
    if (!row) return null;

    const benchmarks = JSON.parse(row.benchmarks_json || "{}");
    const result = {};

    for (const key of ["ctr_pct", "cpc_krw", "cpm_krw", "roas", "frequency_cap"]) {
      const rawKey = key === "ctr_pct" ? "avg_ctr_pct"
        : key === "cpc_krw" ? "avg_cpc_krw"
        : key === "cpm_krw" ? "avg_cpm_krw"
        : key === "roas" ? "avg_roas"
        : "avg_frequency_cap";
      const val = benchmarks[rawKey];
      if (isNumericValid(val, key)) {
        result[key] = val;
      }
    }

    if (Object.keys(result).length === 0) return null;

    result.confidence = row.confidence || "low";
    result.is_fresh = true;
    return result;
  } catch {
    return null;
  }
}

/**
 * daily-review용 — 내부 blendThreshold 결과를 외부 벤치마크로 미세 조정
 * cap = TREND_INFLUENCE_CAP (기본 15%)
 */
export function adjustThresholdWithTrend(blendedValue, externalValue, cap = TREND_INFLUENCE_CAP) {
  if (externalValue == null || blendedValue == null) return blendedValue;
  if (blendedValue === 0) return blendedValue;

  const delta = (externalValue - blendedValue) / blendedValue;
  const clampedDelta = Math.max(-cap, Math.min(cap, delta));
  return Math.round(blendedValue * (1 + clampedDelta) * 100) / 100;
}

/**
 * ad-copy-generator용 — 마크다운 포맷의 트렌드 컨텍스트
 * @returns {string | null}
 */
export function getTrendContextForCopy() {
  try {
    const row = getLatestTrendActionable();
    if (!row) return null;

    const sections = [];

    // 포맷 트렌드
    const formats = JSON.parse(row.formats_json || "[]");
    if (formats.length > 0) {
      sections.push("### 효과적인 광고 포맷");
      for (const f of formats) {
        const arrow = f.trend === "up" ? " ↑" : f.trend === "down" ? " ↓" : "";
        sections.push(`- ${f.format}: ${f.performance}${arrow}`);
      }
    }

    // 현재 효과적인 전략
    const strategies = JSON.parse(row.strategies_json || "[]");
    if (strategies.length > 0) {
      sections.push("\n### 현재 효과적인 전략");
      for (const s of strategies) {
        const tag = s.effectiveness === "high" ? " [높은 효과]" : "";
        sections.push(`- ${s.strategy}${tag}`);
      }
    }

    // 계절 컨텍스트
    const seasonal = JSON.parse(row.seasonal_context_json || "{}");
    if (seasonal.current_season || seasonal.upcoming_events?.length > 0) {
      sections.push("\n### 계절 컨텍스트");
      if (seasonal.current_season) {
        sections.push(`- 현재: ${seasonal.current_season}`);
      }
      if (seasonal.cpm_trend) {
        sections.push(`- CPM 추세: ${seasonal.cpm_trend}`);
      }
      if (seasonal.upcoming_events?.length > 0) {
        sections.push(`- 다가오는 이벤트: ${seasonal.upcoming_events.join(", ")}`);
      }
    }

    // 벤치마크 참고
    const benchmarks = JSON.parse(row.benchmarks_json || "{}");
    if (benchmarks.avg_ctr_pct || benchmarks.avg_roas) {
      sections.push("\n### 한국 이커머스 업계 벤치마크 (참고)");
      if (benchmarks.avg_ctr_pct) sections.push(`- 평균 CTR: ${benchmarks.avg_ctr_pct}%`);
      if (benchmarks.avg_cpc_krw) sections.push(`- 평균 CPC: ₩${benchmarks.avg_cpc_krw.toLocaleString()}`);
      if (benchmarks.avg_roas) sections.push(`- 평균 ROAS: ${benchmarks.avg_roas}x`);
    }

    if (sections.length === 0) return null;
    return sections.join("\n");
  } catch {
    return null;
  }
}

/**
 * auto-improvement용 — 전략 순서 조정을 위한 트렌드 수정자
 * @returns {{ prefer_broad_targeting, prefer_video, budget_season_factor } | null}
 */
export function getStrategyModifiers() {
  try {
    const row = getLatestTrendActionable();
    if (!row) return null;

    const result = {
      prefer_broad_targeting: false,
      prefer_video: false,
      budget_season_factor: 1.0,
    };

    // 전략 데이터에서 타겟팅 확장 추천 확인
    const strategies = JSON.parse(row.strategies_json || "[]");
    const hasBroadTargeting = strategies.some(
      s => s.category === "targeting" && s.effectiveness === "high"
        && /broad|확장|넓|advantage/i.test(s.strategy)
    );
    result.prefer_broad_targeting = hasBroadTargeting;

    // 포맷 데이터에서 비디오 트렌드 확인
    const formats = JSON.parse(row.formats_json || "[]");
    const videoTrending = formats.some(
      f => /video|reels|릴스|영상/i.test(f.format) && f.trend === "up"
    );
    result.prefer_video = videoTrending;

    // 계절 예산 조정 팩터
    const seasonal = JSON.parse(row.seasonal_context_json || "{}");
    if (seasonal.recommended_budget_adjustment_pct != null) {
      const pct = seasonal.recommended_budget_adjustment_pct;
      if (typeof pct === "number" && pct >= -30 && pct <= 50) {
        result.budget_season_factor = 1 + pct / 100;
      }
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * daily-review용 — 최근 알고리즘 변경 알림
 * @returns {Array<{ title, impact_area, action_required }> | null}
 */
export function getAlgorithmAlerts() {
  try {
    const row = getLatestTrendActionable();
    if (!row) return null;

    const alerts = JSON.parse(row.algorithm_alerts_json || "[]");
    if (!Array.isArray(alerts) || alerts.length === 0) return null;

    return alerts.filter(a => a.title && a.impact_area);
  } catch {
    return null;
  }
}

/**
 * trend_actionable 테이블에 구조화된 트렌드 데이터 저장
 */
export function saveTrendActionable(data) {
  try {
    const db = getDb();
    // 최신 1건만 유지 (이전 데이터 삭제)
    db.prepare("DELETE FROM trend_actionable").run();
    db.prepare(`
      INSERT INTO trend_actionable (benchmarks_json, strategies_json, algorithm_alerts_json, seasonal_context_json, formats_json, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      JSON.stringify(data.benchmarks_kr_ecommerce || {}),
      JSON.stringify(data.whats_working || []),
      JSON.stringify(data.algorithm_updates || []),
      JSON.stringify(data.seasonal_context || {}),
      JSON.stringify(data.best_formats || []),
      data.benchmarks_kr_ecommerce?.confidence || "low"
    );
    return true;
  } catch (err) {
    console.error("[TrendBridge] Failed to save trend_actionable:", err.message);
    return false;
  }
}

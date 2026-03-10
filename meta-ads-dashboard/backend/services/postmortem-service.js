// 캠페인 포스트모템 분석 서비스 — 일시정지된 캠페인의 전 요소 시간별 리뷰 + 학습 자산화
import { getDb } from "../db/database.js";
import {
  fetchDailyBreakdown7d,
  groupDailyByCampaign,
} from "./meta-api.js";

// ─── 트렌드 판정 기준 ───
const VERDICT_THRESHOLDS = {
  roas: { good: 1.5, warning: 0.8 },
  ctr: { good: 1.5, warning: 0.8 },
  cpc: { good: 1200, warning: 2000 },     // KRW — 낮을수록 좋음 (역방향)
  frequency: { good: 3.0, warning: 5.0 },  // 낮을수록 좋음 (역방향)
};

/**
 * 전체 일시정지 캠페인 포스트모템 리포트 생성
 * @returns {{ postMortems: Array, summary: object, lessons: Array }}
 */
export async function generatePostMortemReport() {
  const db = getDb();

  // 1) 일시정지 캠페인 목록 + 메타데이터
  const paused = db.prepare(`
    SELECT p.*, c.meta_campaign_id as cid, c.name as campaign_name_db
    FROM paused_campaign_improvements p
    JOIN campaigns c ON c.id = p.campaign_id
    WHERE p.status IN ('cooling', 'attempt_1', 'attempt_2', 'resolved', 'failed')
    ORDER BY p.created_at DESC
  `).all();

  if (!paused.length) {
    return { postMortems: [], summary: null, lessons: [] };
  }

  // 2) Meta API에서 7일 일별 데이터 가져오기
  const creds = db.prepare("SELECT access_token, selected_ad_account_id FROM meta_credentials ORDER BY id DESC LIMIT 1").get();
  let dailyBycamp = {};
  if (creds?.access_token && creds?.selected_ad_account_id) {
    const { data } = await fetchDailyBreakdown7d(creds.access_token, creds.selected_ad_account_id);
    if (data) {
      dailyBycamp = groupDailyByCampaign(data);
    }
  }

  // 3) 개별 캠페인 포스트모템 생성
  const postMortems = paused.map(p =>
    buildCampaignPostMortem(db, p, dailyBycamp[p.meta_campaign_id])
  );

  // 4) 크로스캠페인 패턴 분석
  const summary = analyzeCommonPatterns(postMortems);

  // 5) 학습 데이터 기록
  const lessons = recordPostMortemLearnings(db, postMortems, summary);

  return { postMortems, summary, lessons };
}

/**
 * 개별 캠페인 포스트모템 빌드
 */
function buildCampaignPostMortem(db, pausedRow, dailyData) {
  const metaCampaignId = pausedRow.meta_campaign_id;

  // action_queue에서 진단 JSON 로드
  const actionRow = db.prepare(`
    SELECT reason, funnel_diagnosis_json, benchmark_comparison_json,
           profitability_json, recommendations_json, score, verdict,
           current_value, proposed_value
    FROM action_queue
    WHERE meta_campaign_id = ? AND action_type IN ('pause', 'early_kill')
    ORDER BY id DESC LIMIT 1
  `).get(metaCampaignId);

  // improvement_log에서 과거 개선 이력
  const improvementHistory = db.prepare(`
    SELECT action_type, action_description, before_roas, after_roas,
           before_ctr, after_ctr, result_verdict, created_at
    FROM improvement_log
    WHERE campaign_id = ?
    ORDER BY created_at DESC
  `).all(pausedRow.campaign_id);

  // 일별 메트릭 + factor 분석
  const days = dailyData?.days || [];
  const factorAnalysis = analyzeFactors(days);

  // 퍼널 분석
  const funnelAnalysis = analyzeFunnel(days);

  // 진단 JSON 파싱
  const diagnosis = parseDiagnosisJson(actionRow);

  // 강점/약점/놓친 신호 평가
  const assessment = buildAssessment(factorAnalysis, funnelAnalysis, diagnosis);

  // 리커버리 플랜
  const recoveryPlan = buildRecoveryPlan(pausedRow);

  return {
    campaign: {
      name: pausedRow.campaign_name || pausedRow.campaign_name_db,
      meta_campaign_id: metaCampaignId,
      root_cause: pausedRow.root_cause,
      pause_reason: pausedRow.pause_reason || actionRow?.reason || "",
      pause_date: pausedRow.created_at,
      score: actionRow?.score || 0,
      verdict: actionRow?.verdict || "",
    },
    daily_metrics: days,
    factor_analysis: factorAnalysis,
    funnel_analysis: funnelAnalysis,
    diagnosis,
    assessment,
    improvement_history: improvementHistory,
    recovery_plan: recoveryPlan,
  };
}

/**
 * 일별 데이터에서 ROAS/CTR/CPC/Frequency 각 factor 분석
 */
function analyzeFactors(days) {
  if (!days.length) return emptyFactors();

  const factors = {};
  for (const metric of ["roas", "ctr", "cpc", "frequency"]) {
    const values = days.map(d => d[metric]).filter(v => v != null);
    if (!values.length) {
      factors[metric] = { current: 0, avg: 0, trend: "flat", daily_values: [], verdict: "unknown" };
      continue;
    }

    const current = values[values.length - 1];
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const trend = computeTrend(values);
    const verdict = judgeMetric(metric, current, trend);

    factors[metric] = {
      current: round2(current),
      avg: round2(avg),
      min: round2(Math.min(...values)),
      max: round2(Math.max(...values)),
      trend,
      daily_values: days.map(d => ({ date: d.date, value: round2(d[metric]) })),
      verdict,
    };
  }

  // 추가 메트릭: spend, revenue, purchases
  for (const metric of ["spend", "revenue", "purchases"]) {
    const values = days.map(d => d[metric]).filter(v => v != null);
    const total = values.reduce((s, v) => s + v, 0);
    factors[metric] = {
      total: round2(total),
      daily_values: days.map(d => ({ date: d.date, value: round2(d[metric]) })),
    };
  }

  return factors;
}

/**
 * 퍼널 단계별 전환율 분석
 */
function analyzeFunnel(days) {
  if (!days.length) return null;

  // 7일 합산
  const totals = {
    impressions: sum(days, "impressions"),
    clicks: sum(days, "clicks"),
    landing_page_views: sum(days, "landing_page_views"),
    content_views: sum(days, "content_views"),
    add_to_cart: sum(days, "add_to_cart"),
    initiate_checkout: sum(days, "initiate_checkout"),
    purchases: sum(days, "purchases"),
  };

  const stages = [
    { name: "impressions", count: totals.impressions },
    { name: "clicks", count: totals.clicks },
    { name: "landing_page_views", count: totals.landing_page_views },
    { name: "content_views", count: totals.content_views },
    { name: "add_to_cart", count: totals.add_to_cart },
    { name: "initiate_checkout", count: totals.initiate_checkout },
    { name: "purchases", count: totals.purchases },
  ];

  // 각 단계 전환율 + 이탈률
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    stages[i].conversion_rate = prev > 0 ? round2((stages[i].count / prev) * 100) : 0;
    stages[i].drop_off_rate = prev > 0 ? round2(((prev - stages[i].count) / prev) * 100) : 0;
  }

  // 병목 단계 찾기 (가장 큰 이탈이 있는 단계)
  let bottleneck = null;
  let maxDropOff = 0;
  for (let i = 1; i < stages.length; i++) {
    if ((stages[i].drop_off_rate || 0) > maxDropOff && stages[i - 1].count > 0) {
      maxDropOff = stages[i].drop_off_rate;
      bottleneck = stages[i].name;
    }
  }

  return { stages, bottleneck, totals };
}

/**
 * 크로스캠페인 패턴 분석
 */
function analyzeCommonPatterns(postMortems) {
  if (!postMortems.length) return null;

  // 근본원인 분포
  const rootCauseDist = {};
  postMortems.forEach(pm => {
    const rc = pm.campaign.root_cause || "unknown";
    rootCauseDist[rc] = (rootCauseDist[rc] || 0) + 1;
  });

  // 총 낭비 금액
  const totalWastedSpend = postMortems.reduce((s, pm) => {
    return s + (pm.factor_analysis?.spend?.total || 0);
  }, 0);

  // 총 매출
  const totalRevenue = postMortems.reduce((s, pm) => {
    return s + (pm.factor_analysis?.revenue?.total || 0);
  }, 0);

  // 공통 약점
  const weaknessCount = {};
  postMortems.forEach(pm => {
    (pm.assessment?.weaknesses || []).forEach(w => {
      weaknessCount[w] = (weaknessCount[w] || 0) + 1;
    });
  });
  const commonWeaknesses = Object.entries(weaknessCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w, count]) => ({ weakness: w, campaign_count: count }));

  // 퍼널 병목 분포
  const bottleneckDist = {};
  postMortems.forEach(pm => {
    const bn = pm.funnel_analysis?.bottleneck;
    if (bn) bottleneckDist[bn] = (bottleneckDist[bn] || 0) + 1;
  });

  // 평균 메트릭
  const avgMetrics = {};
  for (const metric of ["roas", "ctr", "cpc", "frequency"]) {
    const vals = postMortems
      .map(pm => pm.factor_analysis?.[metric]?.avg)
      .filter(v => v != null && v > 0);
    avgMetrics[metric] = vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  }

  return {
    campaign_count: postMortems.length,
    root_cause_distribution: rootCauseDist,
    total_spend_7d: round2(totalWastedSpend),
    total_revenue_7d: round2(totalRevenue),
    overall_roas_7d: totalWastedSpend > 0 ? round2(totalRevenue / totalWastedSpend) : 0,
    avg_metrics: avgMetrics,
    common_weaknesses: commonWeaknesses,
    bottleneck_distribution: bottleneckDist,
  };
}

/**
 * 포스트모템 결과를 postmortem_lessons 테이블에 학습 데이터로 기록
 */
function recordPostMortemLearnings(db, postMortems, summary) {
  const lessons = [];

  // 1) 근본원인별 패턴 교훈
  if (summary?.root_cause_distribution) {
    for (const [rootCause, count] of Object.entries(summary.root_cause_distribution)) {
      const relatedPMs = postMortems.filter(pm => pm.campaign.root_cause === rootCause);
      const avgRoas = relatedPMs.length
        ? round2(relatedPMs.reduce((s, pm) => s + (pm.factor_analysis?.roas?.avg || 0), 0) / relatedPMs.length)
        : 0;

      const lesson = {
        root_cause: rootCause,
        lesson_type: "pattern",
        description: `${count}개 캠페인에서 "${rootCause}" 발생. 평균 ROAS ${avgRoas}x.`,
        evidence_json: JSON.stringify({
          campaign_count: count,
          avg_roas: avgRoas,
          campaigns: relatedPMs.map(pm => pm.campaign.name),
        }),
        campaign_count: count,
        confidence: count >= 3 ? "high" : count >= 2 ? "medium" : "low",
      };
      lessons.push(lesson);
      upsertLesson(db, lesson);
    }
  }

  // 2) 공통 약점 교훈
  (summary?.common_weaknesses || []).forEach(cw => {
    if (cw.campaign_count >= 2) {
      const lesson = {
        root_cause: "common",
        lesson_type: "what_failed",
        description: cw.weakness,
        evidence_json: JSON.stringify({ campaign_count: cw.campaign_count }),
        campaign_count: cw.campaign_count,
        confidence: cw.campaign_count >= 4 ? "high" : "medium",
      };
      lessons.push(lesson);
      upsertLesson(db, lesson);
    }
  });

  // 3) 퍼널 병목 교훈
  if (summary?.bottleneck_distribution) {
    for (const [bottleneck, count] of Object.entries(summary.bottleneck_distribution)) {
      if (count >= 2) {
        const lesson = {
          root_cause: "funnel",
          lesson_type: "recommendation",
          description: `퍼널 병목: "${bottleneck}" 단계에서 ${count}개 캠페인 이탈 집중. 이 단계 최적화 필요.`,
          evidence_json: JSON.stringify({ bottleneck, campaign_count: count }),
          campaign_count: count,
          confidence: count >= 3 ? "high" : "medium",
        };
        lessons.push(lesson);
        upsertLesson(db, lesson);
      }
    }
  }

  return lessons;
}

// ─── 헬퍼 함수 ───

/**
 * 교훈 upsert + 신뢰도 자동 에스컬레이션 (성장형 학습 핵심)
 * 같은 root_cause+lesson_type+description이면 campaign_count 증가
 * 1건: low, 3건: medium, 5건: high
 */
export function upsertLesson(db, lesson) {
  try {
    const existing = db.prepare(
      "SELECT id, campaign_count FROM postmortem_lessons WHERE root_cause = ? AND lesson_type = ? AND description = ?"
    ).get(lesson.root_cause, lesson.lesson_type, lesson.description);

    if (existing) {
      const newCount = existing.campaign_count + 1;
      const autoConfidence = newCount >= 5 ? "high" : newCount >= 3 ? "medium" : "low";
      db.prepare(`
        UPDATE postmortem_lessons
        SET campaign_count = ?, confidence = ?, evidence_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newCount, autoConfidence, lesson.evidence_json, existing.id);
    } else {
      db.prepare(`
        INSERT INTO postmortem_lessons (root_cause, lesson_type, description, evidence_json, campaign_count, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(lesson.root_cause, lesson.lesson_type, lesson.description, lesson.evidence_json, lesson.campaign_count || 1, lesson.confidence || "low");
    }
  } catch (err) {
    console.error("[PostMortem] lesson upsert error:", err.message);
  }
}

function computeTrend(values) {
  if (values.length < 2) return "flat";
  const first = values.slice(0, Math.ceil(values.length / 2));
  const second = values.slice(Math.ceil(values.length / 2));
  const avgFirst = first.reduce((s, v) => s + v, 0) / first.length;
  const avgSecond = second.reduce((s, v) => s + v, 0) / second.length;
  if (avgFirst === 0) return avgSecond > 0 ? "up" : "flat";
  const change = (avgSecond - avgFirst) / avgFirst;
  if (change > 0.1) return "up";
  if (change < -0.1) return "down";
  return "flat";
}

function judgeMetric(metric, current, trend) {
  const thresholds = VERDICT_THRESHOLDS[metric];
  if (!thresholds) return "unknown";

  // CPC, frequency는 역방향 (낮을수록 좋음)
  const isInverse = metric === "cpc" || metric === "frequency";

  if (isInverse) {
    if (current <= thresholds.good) return "good";
    if (current >= thresholds.warning) return trend === "up" ? "critical" : "warning";
    return "moderate";
  } else {
    if (current >= thresholds.good) return "good";
    if (current <= thresholds.warning) return trend === "down" ? "critical" : "warning";
    return "moderate";
  }
}

function parseDiagnosisJson(actionRow) {
  if (!actionRow) return {};
  const parse = (field) => {
    try { return JSON.parse(actionRow[field] || "null"); } catch { return null; }
  };
  return {
    root_cause: actionRow.reason,
    funnel_diagnosis: parse("funnel_diagnosis_json"),
    benchmark_comparison: parse("benchmark_comparison_json"),
    profitability: parse("profitability_json"),
    recommendations: parse("recommendations_json"),
  };
}

function buildAssessment(factors, funnelAnalysis, diagnosis) {
  const strengths = [];
  const weaknesses = [];
  const missedSignals = [];

  // Factor 기반 평가
  for (const [metric, data] of Object.entries(factors)) {
    if (!data?.verdict) continue;
    if (data.verdict === "good") {
      strengths.push(`${metric}: ${data.current} (양호)`);
    } else if (data.verdict === "critical") {
      weaknesses.push(`${metric}: ${data.current} (심각, 추세 ${data.trend})`);
    } else if (data.verdict === "warning") {
      weaknesses.push(`${metric}: ${data.current} (주의)`);
    }
  }

  // 퍼널 병목
  if (funnelAnalysis?.bottleneck) {
    weaknesses.push(`퍼널 병목: ${funnelAnalysis.bottleneck} 단계`);
  }

  // Frequency 급등 → 놓친 신호
  const freqData = factors.frequency;
  if (freqData?.trend === "up" && freqData?.current > 3) {
    missedSignals.push("Frequency 상승 추세 — 소재 피로 사전 감지 필요");
  }

  // ROAS 하락 추세 → 놓친 신호
  const roasData = factors.roas;
  if (roasData?.trend === "down") {
    missedSignals.push("ROAS 하락 추세 — 초기 예산 조정 또는 타겟 변경 시점을 놓침");
  }

  return { strengths, weaknesses, missed_signals: missedSignals };
}

function buildRecoveryPlan(pausedRow) {
  const resumeDate = pausedRow.cooling_days > 0
    ? new Date(new Date(pausedRow.created_at).getTime() + pausedRow.cooling_days * 86400000).toISOString().split("T")[0]
    : null;

  let strategies = [];
  try { strategies = JSON.parse(pausedRow.strategy_1st || "[]"); } catch { /* */ }

  return {
    status: pausedRow.status,
    cooling_days: pausedRow.cooling_days,
    resume_date: resumeDate,
    attempt_count: pausedRow.attempt_count,
    max_attempts: pausedRow.max_attempts,
    strategies,
  };
}

function emptyFactors() {
  const empty = { current: 0, avg: 0, trend: "flat", daily_values: [], verdict: "unknown" };
  return { roas: { ...empty }, ctr: { ...empty }, cpc: { ...empty }, frequency: { ...empty } };
}

function sum(arr, key) {
  return arr.reduce((s, d) => s + (d[key] || 0), 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

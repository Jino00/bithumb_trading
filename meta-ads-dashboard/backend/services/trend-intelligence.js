// 트렌드 인텔리전스 서비스 — 모든 지표를 세분화하여 트렌드 추적 + 동적 벤치마크 + 학습 기반 추천
// 스냅샷이 쌓일수록 우리만의 레퍼런스 데이터가 만들어지고,
// 의사결정의 근거(back up data)로 사용된다.
import { getDb } from "../db/database.js";
import { roundN } from "./biz-metrics.js";

// ─── 추적 대상 메트릭 정의 (광고 지표 + 자사몰 퍼널 지표) ───
const AD_METRICS = ["roas", "ctr", "cpc", "frequency", "cpa", "aov"];
const FUNNEL_METRICS = [
  "click_to_landing", "landing_to_view", "view_to_cart",
  "cart_to_checkout", "checkout_to_purchase", "click_to_purchase",
];
const ALL_METRICS = [...AD_METRICS, ...FUNNEL_METRICS];
const BENCHMARK_PERIODS = ["7d", "30d", "90d", "all"];

/**
 * 전체 벤치마크 + 트렌드 재계산 (스냅샷 후 자동 호출)
 * 스냅샷 데이터를 기반으로 모든 메트릭의 통계치를 재산출한다.
 */
export function recomputeAll() {
  const db = getDb();
  const result = { benchmarks: 0, trends: 0, effectiveness: 0 };

  result.benchmarks = recomputeBenchmarks(db);
  result.trends = recomputeMetricTrends(db);
  result.effectiveness = recomputeActionEffectiveness(db);

  return result;
}

// ─── 1. 동적 벤치마크 계산 ───

/**
 * 모든 메트릭에 대해 기간별 벤치마크(평균, 중앙값, 25/75/90 백분위수) 계산
 * 하드코딩된 기준값 대신, 우리 데이터에서 도출된 기준으로 판단한다.
 */
function recomputeBenchmarks(db) {
  const upsert = db.prepare(`
    INSERT INTO metric_benchmarks
      (metric_name, period, sample_count, avg_value, median_value,
       p25_value, p75_value, p90_value, min_value, max_value, std_dev, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(metric_name, period) DO UPDATE SET
      sample_count=excluded.sample_count, avg_value=excluded.avg_value,
      median_value=excluded.median_value, p25_value=excluded.p25_value,
      p75_value=excluded.p75_value, p90_value=excluded.p90_value,
      min_value=excluded.min_value, max_value=excluded.max_value,
      std_dev=excluded.std_dev, computed_at=excluded.computed_at
  `);

  let count = 0;
  const periodDays = { "7d": 7, "30d": 30, "90d": 90, "all": 9999 };

  const compute = db.transaction(() => {
    for (const metric of ALL_METRICS) {
      for (const period of BENCHMARK_PERIODS) {
        const days = periodDays[period];
        const since = getDateNDaysAgo(days);

        let values;
        if (AD_METRICS.includes(metric)) {
          values = extractAdMetricValues(db, metric, since);
        } else {
          values = extractFunnelMetricValues(db, metric, since);
        }

        if (values.length === 0) continue;

        const stats = computeStatistics(values);
        upsert.run(metric, period, values.length,
          stats.avg, stats.median, stats.p25, stats.p75, stats.p90,
          stats.min, stats.max, stats.stdDev);
        count++;
      }
    }
  });

  compute();
  return count;
}

/**
 * 광고 지표 값 추출 (스냅샷 테이블에서)
 */
function extractAdMetricValues(db, metric, since) {
  const columnMap = {
    roas: "roas", ctr: "ctr", cpc: "cpc",
    frequency: "frequency", cpa: "cpa", aov: "aov",
  };
  const col = columnMap[metric];
  if (!col) return [];

  const rows = db.prepare(`
    SELECT ${col} AS val FROM campaign_snapshots
    WHERE snapshot_date >= ? AND ${col} > 0
    ORDER BY val ASC
  `).all(since);

  return rows.map((r) => r.val);
}

/**
 * 퍼널 전환율 값 추출 (스냅샷 데이터에서 계산)
 */
function extractFunnelMetricValues(db, metric, since) {
  const rows = db.prepare(`
    SELECT clicks, landing_page_views, content_views,
           add_to_cart_count, initiate_checkout_count, purchases
    FROM campaign_snapshots
    WHERE snapshot_date >= ? AND clicks > 0
  `).all(since);

  return rows.map((r) => {
    const rate = computeSingleFunnelRate(r, metric);
    return rate;
  }).filter((v) => v > 0);
}

/**
 * 스냅샷 한 행에서 특정 퍼널 전환율 계산
 */
function computeSingleFunnelRate(row, metric) {
  const clicks = row.clicks || 0;
  const landing = row.landing_page_views || 0;
  const content = row.content_views || 0;
  const cart = row.add_to_cart_count || 0;
  const checkout = row.initiate_checkout_count || 0;
  const purchases = row.purchases || 0;

  switch (metric) {
    case "click_to_landing": return clicks > 0 ? (landing / clicks) * 100 : 0;
    case "landing_to_view": return landing > 0 ? (content / landing) * 100 : 0;
    case "view_to_cart": return content > 0 ? (cart / content) * 100 : 0;
    case "cart_to_checkout": return cart > 0 ? (checkout / cart) * 100 : 0;
    case "checkout_to_purchase": return checkout > 0 ? (purchases / checkout) * 100 : 0;
    case "click_to_purchase": return clicks > 0 ? (purchases / clicks) * 100 : 0;
    default: return 0;
  }
}

// ─── 2. 캠페인별 메트릭 트렌드 계산 ───

/**
 * 모든 active 캠페인의 각 메트릭에 대해 트렌드(방향, 이동평균, 변동성) 계산
 */
function recomputeMetricTrends(db) {
  const campaigns = db.prepare("SELECT id FROM campaigns WHERE source = 'meta'").all();
  if (campaigns.length === 0) return 0;

  const upsert = db.prepare(`
    INSERT INTO metric_trends
      (campaign_id, metric_name, trend_direction, change_7d, change_14d, change_30d,
       moving_avg_7d, moving_avg_14d, moving_avg_30d, current_value, volatility,
       percentile_rank, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(campaign_id, metric_name) DO UPDATE SET
      trend_direction=excluded.trend_direction,
      change_7d=excluded.change_7d, change_14d=excluded.change_14d, change_30d=excluded.change_30d,
      moving_avg_7d=excluded.moving_avg_7d, moving_avg_14d=excluded.moving_avg_14d,
      moving_avg_30d=excluded.moving_avg_30d, current_value=excluded.current_value,
      volatility=excluded.volatility, percentile_rank=excluded.percentile_rank,
      computed_at=excluded.computed_at
  `);

  let count = 0;

  const compute = db.transaction(() => {
    for (const { id: campaignId } of campaigns) {
      const snapshots = db.prepare(`
        SELECT * FROM campaign_snapshots
        WHERE campaign_id = ?
        ORDER BY snapshot_date ASC
      `).all(campaignId);

      if (snapshots.length < 2) continue;

      for (const metric of AD_METRICS) {
        const trend = computeMetricTrend(snapshots, metric);
        const rank = getPercentileRank(db, metric, trend.currentValue);

        upsert.run(
          campaignId, metric, trend.direction,
          trend.change7d, trend.change14d, trend.change30d,
          trend.ma7d, trend.ma14d, trend.ma30d,
          trend.currentValue, trend.volatility, rank
        );
        count++;
      }

      // 퍼널 메트릭 트렌드 (계산된 전환율)
      for (const metric of FUNNEL_METRICS) {
        const funnelValues = snapshots.map((s) => ({
          date: s.snapshot_date,
          value: computeSingleFunnelRate(s, metric),
        })).filter((v) => v.value > 0);

        if (funnelValues.length < 2) continue;

        const trend = computeTimeseriesTrend(funnelValues);
        const rank = getPercentileRank(db, metric, trend.currentValue);

        upsert.run(
          campaignId, metric, trend.direction,
          trend.change7d, trend.change14d, trend.change30d,
          trend.ma7d, trend.ma14d, trend.ma30d,
          trend.currentValue, trend.volatility, rank
        );
        count++;
      }
    }
  });

  compute();
  return count;
}

/**
 * 스냅샷 배열에서 특정 광고 메트릭의 트렌드 계산
 */
function computeMetricTrend(snapshots, metric) {
  const values = snapshots.map((s) => ({
    date: s.snapshot_date,
    value: s[metric] || 0,
  }));
  return computeTimeseriesTrend(values);
}

/**
 * 시계열 데이터에서 트렌드(방향, 이동평균, 변화율, 변동성) 계산
 */
function computeTimeseriesTrend(values) {
  if (values.length === 0) {
    return { direction: "insufficient_data", change7d: 0, change14d: 0, change30d: 0,
      ma7d: 0, ma14d: 0, ma30d: 0, currentValue: 0, volatility: 0 };
  }

  const current = values[values.length - 1].value;

  // 이동 평균 계산
  const ma7d = movingAverage(values, 7);
  const ma14d = movingAverage(values, 14);
  const ma30d = movingAverage(values, 30);

  // 변화율 계산 (N일 전 대비 %)
  const change7d = computeChangeRate(values, 7);
  const change14d = computeChangeRate(values, 14);
  const change30d = computeChangeRate(values, 30);

  // 변동성 (최근 7일 표준편차)
  const recent = values.slice(-7).map((v) => v.value);
  const volatility = recent.length > 1 ? stdDev(recent) : 0;

  // 방향 결정 (7일 이동평균 vs 14일 이동평균)
  let direction = "stable";
  if (ma7d > ma14d * 1.05) direction = "improving";
  else if (ma7d < ma14d * 0.95) direction = "declining";

  // 변화율 기반 보정
  if (Math.abs(change7d) > 15) {
    direction = change7d > 0 ? "improving" : "declining";
  }

  return {
    direction,
    change7d: roundN(change7d),
    change14d: roundN(change14d),
    change30d: roundN(change30d),
    ma7d: roundN(ma7d),
    ma14d: roundN(ma14d),
    ma30d: roundN(ma30d),
    currentValue: roundN(current),
    volatility: roundN(volatility),
  };
}

// ─── 3. 조치 효과 학습 ───

/**
 * improvement_log에서 조치 유형 + 진단 단계별 성공률을 집계
 * → 다음에 같은 병목이 발생하면 가장 효과적인 조치를 우선 추천
 */
function recomputeActionEffectiveness(db) {
  const measured = db.prepare(`
    SELECT id, action_type, action_description, result_verdict,
           before_roas, after_roas, before_ctr, after_ctr,
           root_cause, funnel_stage, strategy_applied
    FROM improvement_log
    WHERE result_verdict IS NOT NULL
  `).all();

  if (measured.length === 0) return 0;

  // 조치 유형별 집계 (root_cause 추가로 3차원 세분화)
  const stats = {};
  for (const row of measured) {
    const key = row.action_type;
    const stage = inferDiagnosisStage(row.action_type);
    const rootCause = row.root_cause || "unknown";

    // 기존 2차원 집계 (하위 호환)
    const compositeKey = `${key}|${stage}`;
    // 새 3차원 집계 (root_cause별 세분화)
    const detailedKey = `${key}|${stage}|${rootCause}`;

    // 기존 집계 유지
    if (!stats[compositeKey]) {
      stats[compositeKey] = {
        action_type: key, stage, rootCause: null,
        total: 0, improved: 0, unchanged: 0, worsened: 0,
        roasChanges: [], ctrChanges: [], logIds: [],
      };
    }
    accumulateStats(stats[compositeKey], row);

    // root_cause 세분화 집계 (root_cause가 있을 때만)
    if (rootCause !== "unknown") {
      if (!stats[detailedKey]) {
        stats[detailedKey] = {
          action_type: key, stage, rootCause,
          total: 0, improved: 0, unchanged: 0, worsened: 0,
          roasChanges: [], ctrChanges: [], logIds: [],
        };
      }
      accumulateStats(stats[detailedKey], row);
    }
  }

  // 시계열 데이터로 효과 발현 속도 + 안정성 보강
  enrichWithTimeSeries(db, stats);

  const upsert = db.prepare(`
    INSERT INTO action_effectiveness
      (action_type, diagnosis_stage, times_applied, times_improved, times_unchanged,
       times_worsened, avg_roas_change, avg_ctr_change, success_rate, root_cause, strategy,
       avg_days_to_effect, avg_stability_score, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(action_type, diagnosis_stage) DO UPDATE SET
      times_applied=excluded.times_applied, times_improved=excluded.times_improved,
      times_unchanged=excluded.times_unchanged, times_worsened=excluded.times_worsened,
      avg_roas_change=excluded.avg_roas_change, avg_ctr_change=excluded.avg_ctr_change,
      success_rate=excluded.success_rate, root_cause=excluded.root_cause,
      strategy=excluded.strategy, avg_days_to_effect=excluded.avg_days_to_effect,
      avg_stability_score=excluded.avg_stability_score, last_updated=excluded.last_updated
  `);

  let count = 0;
  const save = db.transaction(() => {
    for (const [, s] of Object.entries(stats)) {
      const avgRoasChange = s.roasChanges.length > 0
        ? s.roasChanges.reduce((a, b) => a + b, 0) / s.roasChanges.length : 0;
      const avgCtrChange = s.ctrChanges.length > 0
        ? s.ctrChanges.reduce((a, b) => a + b, 0) / s.ctrChanges.length : 0;
      const successRate = s.total > 0 ? s.improved / s.total : 0;

      upsert.run(
        s.action_type, s.stage, s.total, s.improved, s.unchanged,
        s.worsened, roundN(avgRoasChange), roundN(avgCtrChange), roundN(successRate),
        s.rootCause, null, roundN(s.avgDaysToEffect || 0), roundN(s.avgStability || 0)
      );
      count++;
    }
  });

  save();
  return count;
}

function accumulateStats(s, row) {
  s.total++;
  if (row.result_verdict === "improved") s.improved++;
  else if (row.result_verdict === "unchanged") s.unchanged++;
  else if (row.result_verdict === "worsened") s.worsened++;
  if (row.before_roas && row.after_roas) s.roasChanges.push(row.after_roas - row.before_roas);
  if (row.before_ctr && row.after_ctr) s.ctrChanges.push(row.after_ctr - row.before_ctr);
  if (row.id) s.logIds.push(row.id);
}

/**
 * improvement_daily_metrics 시계열 데이터로 효과 발현 속도 + 안정성 계산
 * - avg_days_to_effect: 효과(+ROAS)가 처음 나타나기까지 평균 일수
 * - avg_stability: 후반 3일 변화 / 전체 평균 변화 (1.0 = 안정적)
 */
function enrichWithTimeSeries(db, stats) {
  try {
    for (const [, s] of Object.entries(stats)) {
      if (!s.logIds || s.logIds.length === 0) continue;
      let totalDaysToEffect = 0;
      let totalStability = 0;
      let validCount = 0;

      for (const logId of s.logIds) {
        const daily = db.prepare(
          "SELECT day_number, roas_change FROM improvement_daily_metrics WHERE improvement_log_id = ? ORDER BY day_number"
        ).all(logId);
        if (daily.length < 2) continue;

        // 효과 발현 속도: roas_change가 처음으로 양수가 되는 day
        const firstPositive = daily.find(d => (d.roas_change || 0) > 0);
        if (firstPositive) totalDaysToEffect += firstPositive.day_number;

        // 안정성: 후반 3일 평균 / 전체 평균 (1.0에 가까울수록 안정)
        const allChanges = daily.map(d => d.roas_change || 0);
        const avgAll = allChanges.reduce((a, b) => a + b, 0) / allChanges.length;
        const lastThree = allChanges.slice(-3);
        const avgLast = lastThree.reduce((a, b) => a + b, 0) / lastThree.length;
        const stability = avgAll !== 0 ? Math.min(avgLast / avgAll, 2.0) : 1.0;
        totalStability += stability;
        validCount++;
      }

      s.avgDaysToEffect = validCount > 0 ? totalDaysToEffect / validCount : 0;
      s.avgStability = validCount > 0 ? totalStability / validCount : 0;
    }
  } catch (err) {
    console.warn("[TrendIntel] enrichWithTimeSeries failed:", err.message);
  }
}

/**
 * action_type에서 진단 단계를 추론
 */
function inferDiagnosisStage(actionType) {
  const stageMap = {
    creative_change: "광고 소재",
    copy_change: "광고 소재",
    creative_refresh: "광고 소재",
    targeting_change: "타겟팅",
    audience_expansion: "타겟팅",
    targeting_broaden: "타겟팅",
    landing_page_improvement: "랜딩 페이지",
    product_page_update: "상품 페이지",
    price_adjustment: "상품 페이지",
    checkout_optimization: "결제",
    cart_recovery: "장바구니",
    budget_change: "예산",
    budget_increase: "예산",
    budget_decrease: "예산",
    pause: "캠페인 운영",
    resume: "캠페인 운영",
    frequency_cap: "광고 피로",
  };
  return stageMap[actionType] || "기타";
}

// ─── 4. 외부 조회 API ───

/**
 * 전체 벤치마크 조회 (현재 우리 데이터 기반 기준값)
 */
export function getBenchmarks(period = "30d") {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM metric_benchmarks WHERE period = ?"
  ).all(period);

  const result = {};
  for (const row of rows) {
    result[row.metric_name] = {
      avg: row.avg_value,
      median: row.median_value,
      p25: row.p25_value,
      p75: row.p75_value,
      p90: row.p90_value,
      min: row.min_value,
      max: row.max_value,
      std_dev: row.std_dev,
      sample_count: row.sample_count,
      computed_at: row.computed_at,
    };
  }
  return { period, metrics: result };
}

/**
 * 캠페인별 메트릭 트렌드 조회
 */
export function getCampaignMetricTrends(campaignId) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM metric_trends WHERE campaign_id = ?"
  ).all(campaignId);

  const adTrends = {};
  const funnelTrends = {};

  for (const row of rows) {
    const trend = {
      direction: row.trend_direction,
      current: row.current_value,
      change_7d: row.change_7d,
      change_14d: row.change_14d,
      change_30d: row.change_30d,
      ma_7d: row.moving_avg_7d,
      ma_14d: row.moving_avg_14d,
      ma_30d: row.moving_avg_30d,
      volatility: row.volatility,
      percentile_rank: row.percentile_rank,
      computed_at: row.computed_at,
    };

    if (AD_METRICS.includes(row.metric_name)) {
      adTrends[row.metric_name] = trend;
    } else {
      funnelTrends[row.metric_name] = trend;
    }
  }

  return { campaign_id: campaignId, ad_metrics: adTrends, funnel_metrics: funnelTrends };
}

/**
 * 조치 효과 학습 데이터 조회 (어떤 조치가 가장 효과적인가?)
 */
export function getActionEffectiveness() {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM action_effectiveness ORDER BY success_rate DESC"
  ).all();

  return rows.map((r) => ({
    action_type: r.action_type,
    diagnosis_stage: r.diagnosis_stage,
    times_applied: r.times_applied,
    success_rate: `${Math.round(r.success_rate * 100)}%`,
    avg_roas_impact: r.avg_roas_change > 0
      ? `+${r.avg_roas_change.toFixed(2)}x` : `${r.avg_roas_change.toFixed(2)}x`,
    avg_ctr_impact: r.avg_ctr_change > 0
      ? `+${r.avg_ctr_change.toFixed(2)}%` : `${r.avg_ctr_change.toFixed(2)}%`,
    breakdown: {
      improved: r.times_improved,
      unchanged: r.times_unchanged,
      worsened: r.times_worsened,
    },
  }));
}

/**
 * 캠페인의 메트릭 건강도 리포트 — 벤치마크 대비 위치 평가
 * 각 지표가 우리 전체 평균 대비 어떤 위치에 있는지 한눈에 보여준다.
 */
export function getCampaignHealthReport(campaignId) {
  const db = getDb();
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) return null;

  const benchmarks = getBenchmarks("30d");
  const trends = getCampaignMetricTrends(campaignId);

  const report = {};
  for (const metric of AD_METRICS) {
    const bench = benchmarks.metrics[metric];
    const trend = trends.ad_metrics[metric];
    const value = campaign[metric] || 0;

    report[metric] = {
      current_value: value,
      benchmark_avg: bench?.avg || 0,
      benchmark_median: bench?.median || 0,
      vs_avg: bench?.avg > 0 ? roundN(((value - bench.avg) / bench.avg) * 100) : 0,
      position: getPosition(value, bench),
      trend_direction: trend?.direction || "unknown",
      trend_7d_change: trend?.change_7d || 0,
      volatility: trend?.volatility || 0,
    };
  }

  // 퍼널 메트릭 건강도
  const funnelReport = {};
  const clicks = campaign.clicks || 0;
  const funnelValues = {
    click_to_landing: clicks > 0 ? ((campaign.landing_page_views || 0) / clicks) * 100 : 0,
    landing_to_view: (campaign.landing_page_views || 0) > 0
      ? ((campaign.content_views || 0) / campaign.landing_page_views) * 100 : 0,
    view_to_cart: (campaign.content_views || 0) > 0
      ? ((campaign.add_to_cart_count || 0) / campaign.content_views) * 100 : 0,
    cart_to_checkout: (campaign.add_to_cart_count || 0) > 0
      ? ((campaign.initiate_checkout_count || 0) / campaign.add_to_cart_count) * 100 : 0,
    checkout_to_purchase: (campaign.initiate_checkout_count || 0) > 0
      ? ((campaign.purchase_count || 0) / campaign.initiate_checkout_count) * 100 : 0,
    click_to_purchase: clicks > 0 ? ((campaign.purchase_count || 0) / clicks) * 100 : 0,
  };

  for (const metric of FUNNEL_METRICS) {
    const bench = benchmarks.metrics[metric];
    const trend = trends.funnel_metrics[metric];
    const value = funnelValues[metric] || 0;

    funnelReport[metric] = {
      current_value: roundN(value),
      benchmark_avg: bench?.avg ? roundN(bench.avg) : 0,
      vs_avg: bench?.avg > 0 ? roundN(((value - bench.avg) / bench.avg) * 100) : 0,
      position: getPosition(value, bench),
      trend_direction: trend?.direction || "unknown",
      trend_7d_change: trend?.change_7d || 0,
    };
  }

  // 학습 기반 추천 (이 캠페인에 가장 효과적일 조치)
  const effectiveness = getActionEffectiveness();
  const topActions = effectiveness.filter((e) => e.times_applied >= 2).slice(0, 3);

  return {
    campaign_id: campaignId,
    campaign_name: campaign.name,
    ad_metrics: report,
    funnel_metrics: funnelReport,
    learned_recommendations: topActions.length > 0
      ? topActions.map((a) => `${a.action_type} (성공률 ${a.success_rate}, 평균 ROAS 변화 ${a.avg_roas_impact})`)
      : ["아직 충분한 학습 데이터가 없습니다. 조치를 기록하고 7일 후 효과를 측정하세요."],
    data_maturity: assessDataMaturity(db),
  };
}

/**
 * 데이터 성숙도 평가 — 학습에 필요한 데이터가 얼마나 쌓였는지
 */
export function assessDataMaturity(db) {
  const snapshotCount = db.prepare("SELECT COUNT(*) as cnt FROM campaign_snapshots").get().cnt;
  const improvementCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM improvement_log WHERE result_verdict IS NOT NULL"
  ).get().cnt;
  const uniqueDays = db.prepare(
    "SELECT COUNT(DISTINCT snapshot_date) as cnt FROM campaign_snapshots"
  ).get().cnt;

  let level = "초기";
  let description = "데이터 수집 시작 단계";

  if (uniqueDays >= 30 && improvementCount >= 10) {
    level = "성숙";
    description = "벤치마크 신뢰도 높음, 학습 기반 추천 가능";
  } else if (uniqueDays >= 14 && improvementCount >= 3) {
    level = "성장";
    description = "기본 벤치마크 형성됨, 트렌드 분석 가능";
  } else if (uniqueDays >= 7) {
    level = "발전";
    description = "7일 트렌드 분석 가능, 더 많은 데이터 필요";
  }

  return {
    level,
    description,
    snapshots: snapshotCount,
    unique_days: uniqueDays,
    measured_improvements: improvementCount,
    recommendation: uniqueDays < 7
      ? "매일 스냅샷이 자동 기록됩니다. 7일 후 트렌드 분석이 가능해집니다."
      : uniqueDays < 30
        ? "트렌드 분석이 활성화되었습니다. 30일 후 안정적인 벤치마크가 형성됩니다."
        : "충분한 데이터가 쌓였습니다. 벤치마크 대비 성과를 정밀 비교할 수 있습니다.",
  };
}

// ─── 5. 스마트 추천 (학습 데이터 기반) ───

/**
 * 캠페인의 현재 상태 + 학습 데이터를 결합하여 스마트 추천 생성
 * campaign-judge.js의 추천에 학습 데이터를 보강한다.
 */
export function getSmartRecommendations(campaignId) {
  const db = getDb();
  const campaign = db.prepare("SELECT * FROM campaigns WHERE id = ?").get(campaignId);
  if (!campaign) return [];

  const recommendations = [];
  const effectiveness = db.prepare(
    "SELECT * FROM action_effectiveness WHERE times_applied >= 2 ORDER BY success_rate DESC"
  ).all();

  if (effectiveness.length === 0) {
    return [{ type: "info", message: "아직 학습 데이터가 부족합니다. 개선 조치를 기록하면 다음에 더 정확한 추천이 가능합니다." }];
  }

  // 각 조치의 효과를 기반으로 추천 순위 매기기
  for (const eff of effectiveness) {
    if (eff.success_rate < 0.3) continue; // 성공률 30% 미만은 추천하지 않음

    const relevance = assessRelevance(campaign, eff);
    if (relevance <= 0) continue;

    recommendations.push({
      type: "learned",
      action_type: eff.action_type,
      diagnosis_stage: eff.diagnosis_stage,
      message: `${eff.action_type} (과거 ${eff.times_applied}회 적용, 성공률 ${Math.round(eff.success_rate * 100)}%)`,
      expected_impact: {
        roas: eff.avg_roas_change > 0 ? `+${eff.avg_roas_change.toFixed(2)}x` : `${eff.avg_roas_change.toFixed(2)}x`,
        ctr: eff.avg_ctr_change > 0 ? `+${eff.avg_ctr_change.toFixed(2)}%` : `${eff.avg_ctr_change.toFixed(2)}%`,
      },
      confidence: eff.times_applied >= 5 ? "high" : eff.times_applied >= 3 ? "medium" : "low",
      relevance_score: relevance,
    });
  }

  return recommendations.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 5);
}

/**
 * 현재 캠페인 상태에 대해 특정 조치가 얼마나 관련 있는지 평가
 */
function assessRelevance(campaign, effectiveness) {
  let score = 0;
  const stage = effectiveness.diagnosis_stage;

  if (stage === "광고 소재" && (campaign.ctr || 0) < 1.5) score += 3;
  if (stage === "타겟팅" && (campaign.cpc || 0) > 1500) score += 3;
  if (stage === "랜딩 페이지" && (campaign.ctr || 0) > 1.5 && (campaign.roas || 0) < 1) score += 4;
  if (stage === "상품 페이지" && (campaign.content_views || 0) > 0 && (campaign.add_to_cart_count || 0) === 0) score += 4;
  if (stage === "장바구니" && (campaign.add_to_cart_count || 0) > 0 && (campaign.initiate_checkout_count || 0) === 0) score += 5;
  if (stage === "결제" && (campaign.initiate_checkout_count || 0) > 0 && (campaign.purchase_count || 0) === 0) score += 5;
  if (stage === "광고 피로" && (campaign.frequency || 0) > 3) score += 3;

  // 성공률 가중치
  score *= effectiveness.success_rate;

  return roundN(score);
}

// ─── 유틸리티 ───

function getPercentileRank(db, metric, value) {
  const bench = db.prepare(
    "SELECT * FROM metric_benchmarks WHERE metric_name = ? AND period = '30d'"
  ).get(metric);

  if (!bench || bench.sample_count === 0) return 50;

  // 간략한 백분위수 추정 (p25, median, p75 기반 보간)
  if (value <= bench.p25_value) return 25 * (value / Math.max(bench.p25_value, 0.01));
  if (value <= bench.median_value) {
    return 25 + 25 * ((value - bench.p25_value) / Math.max(bench.median_value - bench.p25_value, 0.01));
  }
  if (value <= bench.p75_value) {
    return 50 + 25 * ((value - bench.median_value) / Math.max(bench.p75_value - bench.median_value, 0.01));
  }
  if (value <= bench.p90_value) {
    return 75 + 15 * ((value - bench.p75_value) / Math.max(bench.p90_value - bench.p75_value, 0.01));
  }
  return Math.min(99, 90 + 10 * ((value - bench.p90_value) / Math.max(bench.max_value - bench.p90_value, 0.01)));
}

function getPosition(value, bench) {
  if (!bench || bench.sample_count === 0) return "데이터 부족";
  if (value >= bench.p90) return "상위 10% (우수)";
  if (value >= bench.p75) return "상위 25% (양호)";
  if (value >= bench.median) return "평균 이상";
  if (value >= bench.p25) return "평균 이하";
  return "하위 25% (개선 필요)";
}

function computeStatistics(sortedValues) {
  const n = sortedValues.length;
  const sorted = [...sortedValues].sort((a, b) => a - b);

  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / n;

  return {
    avg: roundN(avg),
    median: roundN(percentile(sorted, 50)),
    p25: roundN(percentile(sorted, 25)),
    p75: roundN(percentile(sorted, 75)),
    p90: roundN(percentile(sorted, 90)),
    min: roundN(sorted[0]),
    max: roundN(sorted[n - 1]),
    stdDev: roundN(stdDev(sorted)),
  };
}

function percentile(sorted, p) {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function movingAverage(values, window) {
  const recent = values.slice(-window);
  if (recent.length === 0) return 0;
  return recent.reduce((s, v) => s + v.value, 0) / recent.length;
}

function computeChangeRate(values, daysAgo) {
  if (values.length < 2) return 0;
  const current = values[values.length - 1].value;
  const pastIndex = Math.max(0, values.length - 1 - daysAgo);
  const past = values[pastIndex].value;
  if (past === 0) return current > 0 ? 100 : 0;
  return ((current - past) / Math.abs(past)) * 100;
}

function stdDev(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// roundN() 삭제 → roundN() from biz-metrics.js (SSOT)

function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().substring(0, 10);
}

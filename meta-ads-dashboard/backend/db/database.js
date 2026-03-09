// SQLite 데이터베이스 설정 + 시드 데이터 관리
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, "meta_ads.db");

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initTables();
    seedIfEmpty();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      ctr REAL NOT NULL,
      roas REAL NOT NULL,
      cpc REAL NOT NULL,
      frequency REAL NOT NULL,
      daily_spend REAL DEFAULT 0,
      total_spend REAL DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      ai_verdict TEXT,
      ai_recommendation TEXT,
      ai_fix_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      page_url TEXT,
      insights TEXT,
      last_analyzed TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT,
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analysis_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      verdict TEXT,
      fix_type TEXT,
      reasoning TEXT,
      action_items TEXT,
      estimated_improvement TEXT,
      copy_alternatives TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS meta_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      app_id TEXT,
      app_secret TEXT,
      redirect_uri TEXT DEFAULT 'http://localhost:3001/api/meta/callback',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meta_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT DEFAULT 'default',
      access_token TEXT NOT NULL,
      token_type TEXT DEFAULT 'long_lived',
      expires_at TEXT,
      fb_user_id TEXT,
      fb_user_name TEXT,
      selected_ad_account_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meta_ad_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      account_name TEXT,
      currency TEXT,
      timezone TEXT,
      status INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ad_library_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_query TEXT NOT NULL,
      search_type TEXT DEFAULT 'keyword',
      ads_found INTEGER DEFAULT 0,
      trends TEXT,
      styles TEXT,
      pros_cons TEXT,
      messaging_patterns TEXT,
      key_takeaways TEXT,
      raw_analysis TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      platform_type TEXT NOT NULL,
      listing_url TEXT NOT NULL,
      listing_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      listing_id INTEGER,
      platform_type TEXT NOT NULL,
      review_count INTEGER DEFAULT 0,
      average_rating REAL,
      sentiment_summary TEXT,
      themes TEXT,
      strengths TEXT,
      weaknesses TEXT,
      notable_reviews TEXT,
      raw_analysis TEXT,
      analyzed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (listing_id) REFERENCES product_listings(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS product_review_aggregations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE,
      total_review_count INTEGER DEFAULT 0,
      overall_sentiment TEXT,
      cross_platform_themes TEXT,
      cross_platform_strengths TEXT,
      cross_platform_weaknesses TEXT,
      platform_comparison TEXT,
      actionable_insights TEXT,
      raw_aggregation TEXT,
      aggregated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scraped_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL,
      platform_review_id TEXT,
      reviewer_name TEXT,
      rating INTEGER,
      review_text TEXT NOT NULL,
      review_date TEXT,
      option_name TEXT,
      is_analyzed INTEGER DEFAULT 0,
      scraped_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (listing_id) REFERENCES product_listings(id) ON DELETE CASCADE,
      UNIQUE(listing_id, platform_review_id)
    );

    CREATE TABLE IF NOT EXISTS scrape_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL UNIQUE,
      total_review_count INTEGER DEFAULT 0,
      average_rating REAL,
      last_scraped_at TEXT,
      last_review_date TEXT,
      scrape_status TEXT DEFAULT 'idle',
      error_message TEXT,
      FOREIGN KEY (listing_id) REFERENCES product_listings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ad_copy_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      copy_type TEXT NOT NULL DEFAULT 'full',
      platform TEXT DEFAULT 'facebook',
      tone TEXT DEFAULT 'professional',
      generated_copies TEXT NOT NULL,
      review_context TEXT,
      ad_library_context TEXT,
      user_feedback TEXT,
      selected_copy_index INTEGER,
      campaign_id INTEGER,
      performance_data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
    );
  `);

  // ─── Cafe24 연동 테이블 ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS cafe24_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mall_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      redirect_uri TEXT DEFAULT 'http://localhost:3001/api/cafe24/callback',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cafe24_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mall_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT,
      refresh_token_expires_at TEXT,
      scopes TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cafe24_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      order_date TEXT NOT NULL,
      total_amount REAL NOT NULL,
      item_count INTEGER DEFAULT 1,
      product_names TEXT,
      payment_method TEXT,
      utm_source TEXT,
      utm_campaign TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS published_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_copy_generation_id INTEGER NOT NULL,
      copy_index INTEGER NOT NULL DEFAULT 0,
      meta_campaign_id TEXT,
      meta_adset_id TEXT,
      meta_creative_id TEXT,
      meta_ad_id TEXT,
      campaign_name TEXT NOT NULL,
      objective TEXT,
      daily_budget INTEGER,
      targeting TEXT,
      page_id TEXT,
      link_url TEXT,
      status TEXT DEFAULT 'PAUSED',
      publish_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (ad_copy_generation_id) REFERENCES ad_copy_generations(id) ON DELETE SET NULL
    );
  `);

  addColumnIfNotExists("campaigns", "meta_campaign_id", "TEXT");
  addColumnIfNotExists("campaigns", "source", "TEXT DEFAULT 'manual'");

  // 광고 카피 생성 — 미디어 첨부 지원
  addColumnIfNotExists("ad_copy_generations", "media_filename", "TEXT");
  addColumnIfNotExists("ad_copy_generations", "media_type", "TEXT");
  addColumnIfNotExists("ad_copy_generations", "media_emphasis", "TEXT");

  // 캠페인 퍼블리시 연동
  addColumnIfNotExists("ad_copy_generations", "published_campaign_id", "INTEGER");

  // Gemini 영상 분석 결과 저장
  addColumnIfNotExists("ad_copy_generations", "video_analysis_summary", "TEXT");
  addColumnIfNotExists("ad_copy_generations", "has_video_analysis", "INTEGER DEFAULT 0");

  // ─── Phase 4: 성과 히스토리 + 개선 추적 테이블 ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      meta_campaign_id TEXT,
      snapshot_date TEXT NOT NULL,
      roas REAL, ctr REAL, cpc REAL, frequency REAL,
      spend REAL, revenue REAL, purchases INTEGER,
      cpa REAL, aov REAL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(campaign_id, snapshot_date)
    );

    CREATE TABLE IF NOT EXISTS improvement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      action_description TEXT NOT NULL,
      before_roas REAL,
      after_roas REAL,
      before_ctr REAL,
      after_ctr REAL,
      result_verdict TEXT,
      measured_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Phase 1: ROAS 정상화 — 실제 매출/구매 데이터 컬럼
  addColumnIfNotExists("campaigns", "revenue", "REAL DEFAULT 0");
  addColumnIfNotExists("campaigns", "aov", "REAL DEFAULT 0");
  addColumnIfNotExists("campaigns", "cpa", "REAL DEFAULT 0");
  addColumnIfNotExists("campaigns", "purchase_count", "INTEGER DEFAULT 0");

  // ─── Cafe24 자사몰 퍼널 데이터 (Meta Pixel 추적 이벤트) ───
  addColumnIfNotExists("campaigns", "landing_page_views", "INTEGER DEFAULT 0");
  addColumnIfNotExists("campaigns", "content_views", "INTEGER DEFAULT 0");
  addColumnIfNotExists("campaigns", "add_to_cart_count", "INTEGER DEFAULT 0");
  addColumnIfNotExists("campaigns", "initiate_checkout_count", "INTEGER DEFAULT 0");

  // campaign_snapshots에도 퍼널 데이터 컬럼 추가
  addColumnIfNotExists("campaign_snapshots", "landing_page_views", "INTEGER DEFAULT 0");
  addColumnIfNotExists("campaign_snapshots", "content_views", "INTEGER DEFAULT 0");
  addColumnIfNotExists("campaign_snapshots", "add_to_cart_count", "INTEGER DEFAULT 0");
  addColumnIfNotExists("campaign_snapshots", "initiate_checkout_count", "INTEGER DEFAULT 0");

  // campaign_snapshots에 클릭 수 추가 (퍼널 전환율 계산에 필요)
  addColumnIfNotExists("campaign_snapshots", "clicks", "INTEGER DEFAULT 0");

  // ─── 제품 원가 테이블 (캠페인별 수익성 계산용) ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      meta_campaign_id TEXT,
      campaign_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      cost_price REAL NOT NULL,
      selling_price REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(campaign_name)
    );
  `);

  // ─── 일일 리뷰 + 액션 큐 (자동 캠페인 리뷰 → 승인 → 실행) ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date TEXT NOT NULL,
      total_campaigns INTEGER DEFAULT 0,
      actions_generated INTEGER DEFAULT 0,
      actions_approved INTEGER DEFAULT 0,
      actions_executed INTEGER DEFAULT 0,
      summary_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS action_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_run_id INTEGER,
      campaign_name TEXT NOT NULL,
      meta_campaign_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      current_value TEXT,
      proposed_value TEXT,
      reason TEXT NOT NULL,
      verdict TEXT,
      score INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      acted_at TEXT,
      executed_at TEXT,
      execution_result TEXT,
      FOREIGN KEY (review_run_id) REFERENCES review_runs(id)
    );

    CREATE TABLE IF NOT EXISTS notification_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ─── action_queue 진단 데이터 컬럼 (campaign-judge.js 결과 저장) ───
  addColumnIfNotExists("action_queue", "recommendations_json", "TEXT");
  addColumnIfNotExists("action_queue", "funnel_diagnosis_json", "TEXT");
  addColumnIfNotExists("action_queue", "smart_recommendations_json", "TEXT");
  addColumnIfNotExists("action_queue", "benchmark_comparison_json", "TEXT");
  addColumnIfNotExists("action_queue", "profitability_json", "TEXT");
  addColumnIfNotExists("action_queue", "adset_id", "TEXT");
  addColumnIfNotExists("action_queue", "improvement_log_id", "INTEGER");
  addColumnIfNotExists("action_queue", "trend_direction", "TEXT");

  // ─── 트렌드 인텔리전스: 동적 벤치마크 + 메트릭별 트렌드 ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS metric_benchmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_name TEXT NOT NULL,
      period TEXT NOT NULL,
      sample_count INTEGER DEFAULT 0,
      avg_value REAL DEFAULT 0,
      median_value REAL DEFAULT 0,
      p25_value REAL DEFAULT 0,
      p75_value REAL DEFAULT 0,
      p90_value REAL DEFAULT 0,
      min_value REAL DEFAULT 0,
      max_value REAL DEFAULT 0,
      std_dev REAL DEFAULT 0,
      computed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(metric_name, period)
    );

    CREATE TABLE IF NOT EXISTS metric_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      metric_name TEXT NOT NULL,
      trend_direction TEXT NOT NULL,
      change_7d REAL DEFAULT 0,
      change_14d REAL DEFAULT 0,
      change_30d REAL DEFAULT 0,
      moving_avg_7d REAL DEFAULT 0,
      moving_avg_14d REAL DEFAULT 0,
      moving_avg_30d REAL DEFAULT 0,
      current_value REAL DEFAULT 0,
      volatility REAL DEFAULT 0,
      percentile_rank REAL DEFAULT 0,
      computed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(campaign_id, metric_name)
    );

    CREATE TABLE IF NOT EXISTS paused_campaign_improvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      meta_campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      pause_reason TEXT,
      pause_rule_code TEXT,
      original_budget REAL,
      adset_id TEXT,
      review_run_id INTEGER,
      cooling_days INTEGER DEFAULT 3,
      status TEXT DEFAULT 'cooling',
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 2,
      strategy_1st TEXT,
      strategy_2nd TEXT,
      last_attempt_at TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trend_actionable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      benchmarks_json TEXT,
      strategies_json TEXT,
      algorithm_alerts_json TEXT,
      seasonal_context_json TEXT,
      formats_json TEXT,
      confidence TEXT DEFAULT 'low',
      fetched_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS action_effectiveness (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      diagnosis_stage TEXT NOT NULL,
      times_applied INTEGER DEFAULT 0,
      times_improved INTEGER DEFAULT 0,
      times_unchanged INTEGER DEFAULT 0,
      times_worsened INTEGER DEFAULT 0,
      avg_roas_change REAL DEFAULT 0,
      avg_ctr_change REAL DEFAULT 0,
      success_rate REAL DEFAULT 0,
      last_updated TEXT DEFAULT (datetime('now')),
      UNIQUE(action_type, diagnosis_stage)
    );
  `);
}

function addColumnIfNotExists(table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) as cnt FROM campaigns").get();
  if (count.cnt > 0) return;

  const insert = db.prepare(`
    INSERT INTO campaigns (name, status, ctr, roas, cpc, frequency, daily_spend, total_spend, impressions, clicks, conversions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const campaigns = [
    ["Summer Sale 2025", "active", 3.2, 4.1, 0.89, 2.1, 150, 4500, 168540, 5393, 432],
    ["Brand Awareness Q1", "active", 0.8, 1.4, 4.2, 6.8, 300, 9000, 214285, 1714, 85],
    ["Retargeting - Cart Abandoners", "active", 1.5, 2.3, 2.1, 4.2, 200, 6000, 285714, 4286, 214],
    ["Lookalike - Top Customers", "active", 1.1, 1.9, 2.8, 3.9, 250, 7500, 267857, 2946, 147],
    ["New Product Launch", "active", 2.8, 3.5, 1.1, 1.8, 180, 5400, 490909, 13745, 687],
  ];

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(...row);
    }
  });

  insertMany(campaigns);
}

export default getDb;

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

  addColumnIfNotExists("campaigns", "meta_campaign_id", "TEXT");
  addColumnIfNotExists("campaigns", "source", "TEXT DEFAULT 'manual'");

  // 광고 카피 생성 — 미디어 첨부 지원
  addColumnIfNotExists("ad_copy_generations", "media_filename", "TEXT");
  addColumnIfNotExists("ad_copy_generations", "media_type", "TEXT");
  addColumnIfNotExists("ad_copy_generations", "media_emphasis", "TEXT");
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

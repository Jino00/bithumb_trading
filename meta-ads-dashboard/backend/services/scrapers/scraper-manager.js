// Playwright 기반 리뷰 스크래퍼 관리자 — 플랫폼별 스크래퍼 분기 + 브라우저 관리
import { chromium } from "playwright";
import { scrapeNaverReviews } from "./naver-scraper.js";
import { scrapeCoupangReviews } from "./coupang-scraper.js";

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
      ],
    });
  }
  return browserInstance;
}

async function createStealthContext(browser) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: {
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", {
      get: () => ["ko-KR", "ko", "en-US", "en"],
    });
  });

  return context;
}

/**
 * 플랫폼별 리뷰 스크래핑 실행
 * @param {object} listing - { id, platform_type, listing_url, listing_name }
 * @param {string|null} lastReviewDate - 이전에 스크래핑한 마지막 리뷰 날짜 (ISO)
 * @returns {{ totalReviewCount, averageRating, reviews[] }}
 */
export async function scrapeListing(listing, lastReviewDate = null) {
  const browser = await getBrowser();
  const context = await createStealthContext(browser);

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    const scrapers = {
      naver_smartstore: scrapeNaverReviews,
      coupang: scrapeCoupangReviews,
    };

    const scraper = scrapers[listing.platform_type];
    if (!scraper) {
      console.log(`[Scraper] No scraper for platform: ${listing.platform_type}, skipping`);
      return null;
    }

    console.log(`[Scraper] Starting ${listing.platform_type} scrape for: ${listing.listing_name}`);
    const result = await scraper(page, listing.listing_url, lastReviewDate);
    console.log(`[Scraper] Done: ${result.totalReviewCount} total reviews, ${result.reviews.length} new scraped`);

    return result;
  } catch (err) {
    console.error(`[Scraper] Failed for ${listing.platform_type}:`, err.message);
    throw err;
  } finally {
    await context.close();
  }
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

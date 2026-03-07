// 네이버 스마트스토어 리뷰 스크래퍼 — 모든 옵션의 리뷰를 순회하며 수집
const MAX_PAGES = 10;
const REVIEW_SELECTOR = "li.YEtwtZFLDz";
const REVIEW_TEXT_SELECTOR = "div._3z_dv4oeUH, span._3z_dv4oeUH";
const REVIEW_DATE_SELECTOR = "span._2L3vDiadT9";
const REVIEW_RATING_SELECTOR = "em._15NU42F3kT";
const REVIEWER_SELECTOR = "strong._2AX8XiJQST";
const REVIEW_OPTION_SELECTOR = "span._1mJhFMbRDf";
const TOTAL_COUNT_SELECTOR = "strong.filter_sort_group__Y8sba em";
const PAGE_NEXT_SELECTOR = "a.fAUKm1ewwo._2Ar8-aEUTq";

/**
 * 네이버 스마트스토어 리뷰 스크래핑
 * @param {import('playwright').Page} page
 * @param {string} url - 상품 URL
 * @param {string|null} lastReviewDate - 이 날짜 이후 리뷰만 수집
 * @returns {{ totalReviewCount, averageRating, reviews[] }}
 */
export async function scrapeNaverReviews(page, url, lastReviewDate) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // 리뷰 탭으로 스크롤/클릭
  await scrollToReviewSection(page);

  // 총 리뷰 수 추출
  const totalReviewCount = await extractTotalCount(page);

  // 평균 평점 추출
  const averageRating = await extractAverageRating(page);

  // 최신순 정렬
  await sortByLatest(page);

  // 리뷰 수집 (페이지네이션)
  const reviews = await collectReviews(page, lastReviewDate);

  return { totalReviewCount, averageRating, reviews };
}

async function scrollToReviewSection(page) {
  try {
    // "리뷰" 또는 "구매평" 탭 클릭
    const reviewTab = await page.$('a[href*="review"], button:has-text("리뷰"), a:has-text("구매평")');
    if (reviewTab) {
      await reviewTab.scrollIntoViewIfNeeded();
      await reviewTab.click();
      await page.waitForTimeout(2000);
    } else {
      // 페이지 하단으로 스크롤하여 리뷰 섹션 찾기
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(500);
      }
    }
  } catch {
    // 이미 리뷰 섹션이 보이는 경우
  }
}

async function extractTotalCount(page) {
  try {
    // 방법 1: 필터 영역의 총 수
    const countEl = await page.$(TOTAL_COUNT_SELECTOR);
    if (countEl) {
      const text = await countEl.textContent();
      return parseInt(text.replace(/[^0-9]/g, ""), 10) || 0;
    }

    // 방법 2: "전체 N" 또는 "리뷰 N건" 패턴
    const allText = await page.textContent("body");
    const match = allText.match(/(?:전체|리뷰|구매평)\s*[\(（]?\s*([\d,]+)\s*[\)）]?/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ""), 10) || 0;
    }
  } catch {
    // 무시
  }
  return 0;
}

async function extractAverageRating(page) {
  try {
    // "4.71" 같은 평균 평점 찾기
    const ratingEl = await page.$('strong[class*="average"], em[class*="average"], span[class*="score"]');
    if (ratingEl) {
      const text = await ratingEl.textContent();
      const num = parseFloat(text);
      if (num > 0 && num <= 5) return num;
    }

    // 텍스트 기반 검색
    const allText = await page.textContent("body");
    const match = allText.match(/(\d\.\d{1,2})\s*[/／]\s*5/);
    if (match) return parseFloat(match[1]);
  } catch {
    // 무시
  }
  return null;
}

async function sortByLatest(page) {
  try {
    const latestBtn = await page.$('a:has-text("최신순"), button:has-text("최신순")');
    if (latestBtn) {
      await latestBtn.click();
      await page.waitForTimeout(2000);
    }
  } catch {
    // 이미 최신순이거나 정렬 불가
  }
}

async function collectReviews(page, lastReviewDate) {
  const reviews = [];
  const cutoffDate = lastReviewDate ? new Date(lastReviewDate) : null;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const pageReviews = await extractReviewsFromPage(page);

    let reachedOldReview = false;
    for (const review of pageReviews) {
      // 증분 체크: 이전에 본 리뷰보다 오래된 리뷰면 중단
      if (cutoffDate && review.reviewDate) {
        const reviewDate = new Date(review.reviewDate);
        if (reviewDate <= cutoffDate) {
          reachedOldReview = true;
          break;
        }
      }
      reviews.push(review);
    }

    if (reachedOldReview || pageReviews.length === 0) break;

    // 다음 페이지
    const hasNext = await goToNextPage(page);
    if (!hasNext) break;
  }

  return reviews;
}

async function extractReviewsFromPage(page) {
  const reviews = [];

  try {
    // 리뷰 요소들 수집
    const reviewEls = await page.$$(REVIEW_SELECTOR);
    if (reviewEls.length === 0) {
      // 대체 셀렉터 시도
      const altReviewEls = await page.$$('div[class*="review_item"], li[class*="review"]');
      for (const el of altReviewEls) {
        const review = await extractSingleReview(el, page);
        if (review) reviews.push(review);
      }
      return reviews;
    }

    for (const el of reviewEls) {
      const review = await extractSingleReview(el, page);
      if (review) reviews.push(review);
    }
  } catch (err) {
    console.error("[Naver Scraper] Error extracting reviews:", err.message);
  }

  return reviews;
}

async function extractSingleReview(el, page) {
  try {
    // 리뷰 텍스트
    const textEl = await el.$(REVIEW_TEXT_SELECTOR) || await el.$('span[class*="text"], p[class*="text"]');
    const reviewText = textEl ? (await textEl.textContent()).trim() : "";
    if (!reviewText) return null;

    // 날짜
    const dateEl = await el.$(REVIEW_DATE_SELECTOR) || await el.$('span[class*="date"]');
    let reviewDate = null;
    if (dateEl) {
      const dateText = (await dateEl.textContent()).trim();
      reviewDate = parseKoreanDate(dateText);
    }

    // 평점
    let rating = null;
    const ratingEl = await el.$(REVIEW_RATING_SELECTOR) || await el.$('em[class*="rating"], span[class*="star"]');
    if (ratingEl) {
      const ratingText = await ratingEl.textContent();
      rating = parseInt(ratingText, 10) || null;
    }

    // 작성자
    const reviewerEl = await el.$(REVIEWER_SELECTOR) || await el.$('strong[class*="name"], span[class*="user"]');
    const reviewerName = reviewerEl ? (await reviewerEl.textContent()).trim() : null;

    // 옵션
    const optionEl = await el.$(REVIEW_OPTION_SELECTOR) || await el.$('span[class*="option"]');
    const optionName = optionEl ? (await optionEl.textContent()).trim() : null;

    // 고유 ID 생성 (날짜 + 작성자 + 텍스트 앞 20자)
    const platformReviewId = `naver_${reviewDate || "nodate"}_${(reviewerName || "anon").slice(0, 5)}_${reviewText.slice(0, 20)}`;

    return { platformReviewId, reviewerName, rating, reviewText, reviewDate, optionName };
  } catch {
    return null;
  }
}

async function goToNextPage(page) {
  try {
    const nextBtn = await page.$(PAGE_NEXT_SELECTOR) || await page.$('a:has-text("다음"), button[class*="next"]');
    if (nextBtn) {
      await nextBtn.click();
      await page.waitForTimeout(2000);
      return true;
    }
  } catch {
    // 다음 페이지 없음
  }
  return false;
}

function parseKoreanDate(text) {
  // "2025.01.15." → "2025-01-15"
  const dotMatch = text.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (dotMatch) {
    return `${dotMatch[1]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[3].padStart(2, "0")}`;
  }

  // "25.01.15" → "2025-01-15"
  const shortMatch = text.match(/(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (shortMatch) {
    return `20${shortMatch[1]}-${shortMatch[2].padStart(2, "0")}-${shortMatch[3].padStart(2, "0")}`;
  }

  return null;
}

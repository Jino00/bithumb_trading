// 쿠팡 리뷰 스크래퍼 — 봇 감지 대응 + 페이지네이션 처리
const MAX_PAGES = 10;
const DELAY_MIN_MS = 1500;
const DELAY_MAX_MS = 3000;

/**
 * 쿠팡 리뷰 스크래핑
 * @param {import('playwright').Page} page
 * @param {string} url - 상품 URL
 * @param {string|null} lastReviewDate - 이 날짜 이후 리뷰만 수집
 * @returns {{ totalReviewCount, averageRating, reviews[] }}
 */
export async function scrapeCoupangReviews(page, url, lastReviewDate) {
  // 쿠팡 봇 감지 우회: 랜덤 딜레이로 접근
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await randomDelay(page);

  // 리뷰 섹션으로 스크롤
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

async function randomDelay(page) {
  const ms = DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
  await page.waitForTimeout(ms);
}

async function scrollToReviewSection(page) {
  try {
    // "상품평" 탭 클릭
    const reviewTab = await page.$('li.tab-titles__item:has-text("상품평"), a:has-text("상품평")');
    if (reviewTab) {
      await reviewTab.scrollIntoViewIfNeeded();
      await reviewTab.click();
      await randomDelay(page);
    } else {
      // 스크롤하여 리뷰 섹션 찾기
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(300);
      }
      await randomDelay(page);
    }
  } catch {
    // 이미 리뷰 섹션이 보이는 경우
  }
}

async function extractTotalCount(page) {
  try {
    // 방법 1: "상품평 (14,549)" 패턴
    const allText = await page.textContent("body");
    const match = allText.match(/상품평\s*[\(（]?\s*([\d,]+)\s*[\)）]/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ""), 10) || 0;
    }

    // 방법 2: "전체 14,549건"
    const match2 = allText.match(/전체\s+([\d,]+)\s*건/);
    if (match2) {
      return parseInt(match2[1].replace(/,/g, ""), 10) || 0;
    }

    // 방법 3: 셀렉터 기반
    const countEl = await page.$('span.count, em.count, span[class*="review-count"]');
    if (countEl) {
      const text = await countEl.textContent();
      return parseInt(text.replace(/[^0-9]/g, ""), 10) || 0;
    }
  } catch {
    // 무시
  }
  return 0;
}

async function extractAverageRating(page) {
  try {
    // "4.5" 형태의 평균 평점
    const ratingEl = await page.$('span.star-score em, div.sdp-review__article__order__star__number, span[class*="average"]');
    if (ratingEl) {
      const text = await ratingEl.textContent();
      const num = parseFloat(text);
      if (num > 0 && num <= 5) return num;
    }

    // 텍스트 기반 검색
    const allText = await page.textContent("body");
    const match = allText.match(/(\d\.\d)\s*점/);
    if (match) return parseFloat(match[1]);
  } catch {
    // 무시
  }
  return null;
}

async function sortByLatest(page) {
  try {
    const latestBtn = await page.$('button:has-text("최신순"), a:has-text("최신순"), span:has-text("최신순")');
    if (latestBtn) {
      await latestBtn.click();
      await randomDelay(page);
    }
  } catch {
    // 기본 정렬 사용
  }
}

async function collectReviews(page, lastReviewDate) {
  const reviews = [];
  const cutoffDate = lastReviewDate ? new Date(lastReviewDate) : null;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const pageReviews = await extractReviewsFromPage(page);

    let reachedOldReview = false;
    for (const review of pageReviews) {
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
    await randomDelay(page);
  }

  return reviews;
}

async function extractReviewsFromPage(page) {
  const reviews = [];

  try {
    // 쿠팡 리뷰 요소 셀렉터들
    const reviewEls = await page.$$('article.sdp-review__article__list, div[class*="review-content"], section.js_reviewArticle');
    if (reviewEls.length === 0) {
      // 대체 셀렉터
      const altEls = await page.$$('div.sdp-review__article__list__review, div[class*="review-item"]');
      for (const el of altEls) {
        const review = await extractSingleReview(el);
        if (review) reviews.push(review);
      }
      return reviews;
    }

    for (const el of reviewEls) {
      const review = await extractSingleReview(el);
      if (review) reviews.push(review);
    }
  } catch (err) {
    console.error("[Coupang Scraper] Error extracting reviews:", err.message);
  }

  return reviews;
}

async function extractSingleReview(el) {
  try {
    // 리뷰 텍스트
    const textEl = await el.$('div.sdp-review__article__list__review__content, div[class*="review-content__text"], span[class*="review__content"]');
    const reviewText = textEl ? (await textEl.textContent()).trim() : "";
    if (!reviewText || reviewText.length < 5) return null;

    // 날짜
    const dateEl = await el.$('div.sdp-review__article__list__review__writer span:last-child, span[class*="date"], time');
    let reviewDate = null;
    if (dateEl) {
      const dateText = (await dateEl.textContent()).trim();
      reviewDate = parseCoupangDate(dateText);
    }

    // 평점
    let rating = null;
    const ratingEl = await el.$('div.sdp-review__article__list__info__product-info__star-orange, em[class*="rating"], span[class*="star"]');
    if (ratingEl) {
      // 쿠팡은 width 스타일로 별점 표시하는 경우가 많음
      const style = await ratingEl.getAttribute("style");
      if (style) {
        const widthMatch = style.match(/width:\s*([\d.]+)%/);
        if (widthMatch) {
          rating = Math.round(parseFloat(widthMatch[1]) / 20);
        }
      }
      // 직접 텍스트인 경우
      if (!rating) {
        const text = await ratingEl.textContent();
        const num = parseInt(text, 10);
        if (num > 0 && num <= 5) rating = num;
      }
    }

    // 작성자
    const reviewerEl = await el.$('span.sdp-review__article__list__review__writer__name, span[class*="reviewer"], span[class*="user-name"]');
    const reviewerName = reviewerEl ? (await reviewerEl.textContent()).trim() : null;

    // 고유 ID 생성
    const platformReviewId = `coupang_${reviewDate || "nodate"}_${(reviewerName || "anon").slice(0, 5)}_${reviewText.slice(0, 20)}`;

    return { platformReviewId, reviewerName, rating, reviewText, reviewDate, optionName: null };
  } catch {
    return null;
  }
}

async function goToNextPage(page) {
  try {
    const nextBtn = await page.$('button.sdp-review__article__page__next, a[class*="next"], button:has-text("다음")');
    if (nextBtn) {
      const isDisabled = await nextBtn.getAttribute("disabled");
      if (isDisabled) return false;
      await nextBtn.click();
      await randomDelay(page);
      return true;
    }
  } catch {
    // 다음 페이지 없음
  }
  return false;
}

function parseCoupangDate(text) {
  // "2025.01.15" → "2025-01-15"
  const dotMatch = text.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (dotMatch) {
    return `${dotMatch[1]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[3].padStart(2, "0")}`;
  }

  // "2025-01-15" 그대로
  const dashMatch = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dashMatch) {
    return `${dashMatch[1]}-${dashMatch[2].padStart(2, "0")}-${dashMatch[3].padStart(2, "0")}`;
  }

  return null;
}

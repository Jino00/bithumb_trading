// 공용 Claude API 클라이언트 — web_search 지원, 3개 라우트에서 공유
import fetch from "node-fetch";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Claude API 호출 (web_search 도구 포함)
 * @param {string} prompt - 사용자 프롬프트
 * @param {string} systemPrompt - 시스템 프롬프트
 * @param {Function} [fallbackFn] - API 키 없거나 실패 시 호출할 fallback 함수
 * @param {object} [options] - 추가 옵션 (max_tokens 등)
 * @returns {string} Claude 응답 텍스트
 */
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 30000; // rate limit 시 30초 대기

export async function callClaude(prompt, systemPrompt, fallbackFn = null, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return fallbackFn ? fallbackFn(prompt) : "";
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: options.model || "claude-sonnet-4-20250514",
          max_tokens: options.max_tokens || 4000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_BASE_DELAY_MS * attempt;
        console.log(`[Claude API] Rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs / 1000}s...`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        console.error("Claude API error:", await response.text());
        return fallbackFn ? fallbackFn(prompt) : "";
      }

      const data = await response.json();
      return data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    } catch (err) {
      console.error(`Claude API call failed (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS);
        continue;
      }
      return fallbackFn ? fallbackFn(prompt) : "";
    }
  }

  return fallbackFn ? fallbackFn(prompt) : "";
}

/**
 * Claude API 호출 (도구 없이 — 스크래핑된 리뷰 분석용, 더 저렴/빠름)
 */
export async function callClaudeNoTools(prompt, systemPrompt, fallbackFn = null, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return fallbackFn ? fallbackFn(prompt) : "";
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: options.model || "claude-sonnet-4-20250514",
          max_tokens: options.max_tokens || 4000,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_BASE_DELAY_MS * attempt;
        console.log(`[Claude API NoTools] Rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs / 1000}s...`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        console.error("Claude API (no tools) error:", await response.text());
        return fallbackFn ? fallbackFn(prompt) : "";
      }

      const data = await response.json();
      return data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    } catch (err) {
      console.error(`Claude API (no tools) failed (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS);
        continue;
      }
      return fallbackFn ? fallbackFn(prompt) : "";
    }
  }

  return fallbackFn ? fallbackFn(prompt) : "";
}

/**
 * Claude API 호출 (Vision — 이미지 분석 포함)
 * @param {string} prompt - 텍스트 프롬프트
 * @param {string} systemPrompt - 시스템 프롬프트
 * @param {object} imageData - { base64: string, mediaType: string }
 * @param {Function} [fallbackFn] - API 키 없거나 실패 시 호출할 fallback 함수
 * @param {object} [options] - 추가 옵션
 * @returns {string} Claude 응답 텍스트
 */
export async function callClaudeWithVision(prompt, systemPrompt, imageData, fallbackFn = null, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return fallbackFn ? fallbackFn(prompt) : "";
  }

  // 멀티모달 content 블록 구성: 이미지 + 텍스트
  const contentBlocks = [];
  if (imageData?.base64) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageData.mediaType || "image/jpeg",
        data: imageData.base64,
      },
    });
  }
  contentBlocks.push({ type: "text", text: prompt });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: options.model || "claude-sonnet-4-20250514",
          max_tokens: options.max_tokens || 4000,
          system: systemPrompt,
          messages: [{ role: "user", content: contentBlocks }],
        }),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_BASE_DELAY_MS * attempt;
        console.log(`[Claude Vision] Rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitMs / 1000}s...`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        console.error("Claude Vision API error:", await response.text());
        return fallbackFn ? fallbackFn(prompt) : "";
      }

      const data = await response.json();
      return data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    } catch (err) {
      console.error(`Claude Vision API failed (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS);
        continue;
      }
      return fallbackFn ? fallbackFn(prompt) : "";
    }
  }

  return fallbackFn ? fallbackFn(prompt) : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claude 응답에서 JSON 파싱 (코드블록/원문 모두 지원)
 * @param {string} text - Claude 응답 텍스트
 * @param {*} fallback - 파싱 실패 시 반환값
 * @returns {object} 파싱된 JSON 객체
 */
export function parseClaudeJson(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

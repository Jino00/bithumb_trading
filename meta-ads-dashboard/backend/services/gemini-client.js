// Gemini API 클라이언트 — 비디오 분석용, claude-client.js 패턴 준수
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import path from "path";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5000;
const FILE_POLL_INTERVAL_MS = 5000;
const FILE_POLL_TIMEOUT_MS = 300000; // 5분 대기 최대 (대용량 영상 처리 지원)

const MIME_MAP = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiKey() {
  const key = process.env.GOOGLE_GEMINI_API_KEY;
  if (!key || key === "your_key_here") return null;
  return key;
}

/**
 * Gemini File API에 비디오 업로드 + 처리 완료 대기
 * @param {string} filePath - 비디오 파일 절대 경로
 * @returns {Promise<{data: {fileUri: string, mimeType: string, fileName: string} | null, error: string | null}>}
 */
export async function uploadToGeminiFileAPI(filePath) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { data: null, error: "GOOGLE_GEMINI_API_KEY가 설정되지 않았습니다." };
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_MAP[ext] || "video/mp4";
  const displayName = path.basename(filePath);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Gemini File API] 업로드 시작: ${displayName} (attempt ${attempt}/${MAX_RETRIES})`);

      const fileManager = new GoogleAIFileManager(apiKey);
      const uploadResult = await fileManager.uploadFile(filePath, {
        mimeType,
        displayName,
      });

      console.log(`[Gemini File API] 업로드 완료. 처리 대기 중... (${uploadResult.file.name})`);

      // 처리 완료까지 폴링
      let file = uploadResult.file;
      const startTime = Date.now();

      while (file.state === FileState.PROCESSING) {
        if (Date.now() - startTime > FILE_POLL_TIMEOUT_MS) {
          return { data: null, error: `파일 처리 시간 초과 (${FILE_POLL_TIMEOUT_MS / 1000}초)` };
        }
        await sleep(FILE_POLL_INTERVAL_MS);
        file = await fileManager.getFile(file.name);
        console.log(`[Gemini File API] 처리 상태: ${file.state}`);
      }

      if (file.state === FileState.FAILED) {
        return { data: null, error: "Gemini 파일 처리 실패" };
      }

      console.log(`[Gemini File API] 파일 준비 완료: ${file.uri}`);
      return {
        data: { fileUri: file.uri, mimeType: file.mimeType, fileName: file.name },
        error: null,
      };
    } catch (err) {
      console.error(`[Gemini File API] 업로드 실패 (attempt ${attempt}/${MAX_RETRIES}):`, err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      return { data: null, error: err.message };
    }
  }

  return { data: null, error: "최대 재시도 횟수 초과" };
}

/**
 * Gemini로 비디오 분석 요청
 * @param {string} fileUri - Gemini File API URI
 * @param {string} mimeType - 비디오 MIME 타입
 * @param {string} analysisPrompt - 분석 지시 프롬프트
 * @returns {Promise<{data: string | null, error: string | null}>}
 */
export async function analyzeVideoWithGemini(fileUri, mimeType, analysisPrompt) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { data: null, error: "GOOGLE_GEMINI_API_KEY가 설정되지 않았습니다." };
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[Gemini Video] 분석 요청 (attempt ${attempt}/${MAX_RETRIES})`);

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      const result = await model.generateContent([
        {
          fileData: { fileUri, mimeType },
        },
        { text: analysisPrompt },
      ]);

      const responseText = result.response.text();
      if (!responseText) {
        return { data: null, error: "Gemini 응답이 비어 있습니다." };
      }

      console.log(`[Gemini Video] 분석 완료. 응답 길이: ${responseText.length}자`);
      return { data: responseText, error: null };
    } catch (err) {
      console.error(`[Gemini Video] 분석 실패 (attempt ${attempt}/${MAX_RETRIES}):`, err.message);

      // Rate limit 처리
      if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED")) {
        const waitMs = RETRY_BASE_DELAY_MS * attempt * 2;
        console.log(`[Gemini Video] Rate limited, ${waitMs / 1000}초 대기...`);
        await sleep(waitMs);
        continue;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      return { data: null, error: err.message };
    }
  }

  return { data: null, error: "최대 재시도 횟수 초과" };
}

/**
 * Gemini File API에서 파일 삭제 (정리용, fire-and-forget)
 * @param {string} fileName - Gemini 파일 이름 (files/xxx 형태)
 */
export async function deleteGeminiFile(fileName) {
  const apiKey = getApiKey();
  if (!apiKey || !fileName) return;

  try {
    const fileManager = new GoogleAIFileManager(apiKey);
    await fileManager.deleteFile(fileName);
    console.log(`[Gemini File API] 파일 삭제 완료: ${fileName}`);
  } catch (err) {
    console.warn(`[Gemini File API] 파일 삭제 실패 (무시): ${err.message}`);
  }
}

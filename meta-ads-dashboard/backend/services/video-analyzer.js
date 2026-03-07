// 비디오 전체 분석 서비스 — Gemini File API 업로드 → 비디오 분석 → 구조화된 리포트 반환
import { uploadToGeminiFileAPI, analyzeVideoWithGemini, deleteGeminiFile } from "./gemini-client.js";
import { parseClaudeJson } from "./claude-client.js";

const VIDEO_ANALYSIS_PROMPT = `이 비디오를 광고 카피 작성을 위해 상세히 분석해주세요.

다음 항목을 JSON 형식으로 반환하세요:

{
  "summary": "영상 전체 요약 (2-3문장. 어떤 제품/서비스를, 어떤 방식으로 보여주는 영상인지)",
  "scenes": [
    {"timestamp": "0:00-0:05", "description": "장면 설명"},
    {"timestamp": "0:05-0:12", "description": "장면 설명"}
  ],
  "narration": "나레이션/음성 내용을 전사 (음성이 없으면 '음성 없음')",
  "textOverlays": ["화면에 표시된 텍스트1", "텍스트2"],
  "emotionalArc": "시청자의 감정 흐름 설명 (예: 호기심 → 놀라움 → 신뢰 → 구매 욕구)",
  "productFeatures": ["영상에서 강조하는 제품 특징1", "특징2", "특징3"],
  "visualStyle": "시각적 스타일 설명 (색감, 촬영 방식, 편집 스타일, 분위기)",
  "targetAudience": "이 영상의 추정 타겟 오디언스",
  "adCopyHints": [
    "광고 카피에 활용할 수 있는 핵심 포인트1",
    "핵심 포인트2",
    "핵심 포인트3"
  ]
}

주의사항:
- 반드시 위 JSON 형식으로만 응답하세요 (마크다운 코드블록 없이 순수 JSON)
- 한국어로 작성하세요
- 영상의 모든 시각적/청각적 요소를 빠짐없이 분석하세요
- 광고 카피 작성에 도움이 되는 구체적인 인사이트를 제공하세요`;

/**
 * 비디오를 Gemini로 전체 분석
 * @param {string} videoPath - 비디오 파일 절대 경로
 * @returns {Promise<{data: object | null, error: string | null}>}
 */
export async function analyzeVideo(videoPath) {
  console.log(`[Video Analyzer] 비디오 분석 시작: ${videoPath}`);
  const startTime = Date.now();

  // Step 1: Gemini File API에 업로드
  const uploadResult = await uploadToGeminiFileAPI(videoPath);
  if (uploadResult.error) {
    console.warn(`[Video Analyzer] 업로드 실패: ${uploadResult.error}`);
    return { data: null, error: `영상 업로드 실패: ${uploadResult.error}` };
  }

  const { fileUri, mimeType, fileName } = uploadResult.data;

  // Step 2: 영상 분석 요청
  const analysisResult = await analyzeVideoWithGemini(fileUri, mimeType, VIDEO_ANALYSIS_PROMPT);

  // Step 3: 파일 정리 (fire-and-forget)
  deleteGeminiFile(fileName).catch(() => {});

  if (analysisResult.error) {
    console.warn(`[Video Analyzer] 분석 실패: ${analysisResult.error}`);
    return { data: null, error: `영상 분석 실패: ${analysisResult.error}` };
  }

  // Step 4: JSON 파싱
  const report = parseClaudeJson(analysisResult.data, null);
  if (!report) {
    console.warn("[Video Analyzer] JSON 파싱 실패, 원본 텍스트를 summary로 사용");
    return {
      data: {
        summary: analysisResult.data.substring(0, 500),
        scenes: [],
        narration: "",
        textOverlays: [],
        emotionalArc: "",
        productFeatures: [],
        visualStyle: "",
        targetAudience: "",
        adCopyHints: [],
        _rawText: analysisResult.data,
      },
      error: null,
    };
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Video Analyzer] 분석 완료 (${elapsed}초). 장면 수: ${report.scenes?.length || 0}`);

  return { data: report, error: null };
}

/**
 * VideoAnalysisReport를 Claude 프롬프트용 텍스트로 포맷팅
 * @param {object} report - analyzeVideo()의 결과 데이터
 * @returns {string} 포맷된 텍스트 (프롬프트 삽입용)
 */
export function formatVideoAnalysisForPrompt(report) {
  if (!report) return "";

  // 원본 텍스트만 있는 경우 (파싱 실패 fallback)
  if (report._rawText) {
    return `## 🎬 영상 분석 리포트 (Gemini AI 분석)\n\n${report._rawText}`;
  }

  let text = "## 🎬 영상 분석 리포트 (Gemini AI 분석)\n\n";

  if (report.summary) {
    text += `### 영상 요약\n${report.summary}\n\n`;
  }

  if (report.scenes?.length > 0) {
    text += "### 장면 구성\n";
    for (const scene of report.scenes) {
      text += `- [${scene.timestamp}] ${scene.description}\n`;
    }
    text += "\n";
  }

  if (report.narration && report.narration !== "음성 없음") {
    text += `### 나레이션/음성 내용\n${report.narration}\n\n`;
  }

  if (report.textOverlays?.length > 0) {
    text += "### 화면 텍스트 (OCR)\n";
    for (const overlay of report.textOverlays) {
      text += `- ${overlay}\n`;
    }
    text += "\n";
  }

  if (report.emotionalArc) {
    text += `### 감정 흐름\n${report.emotionalArc}\n\n`;
  }

  if (report.productFeatures?.length > 0) {
    text += "### 제품 특징 (영상에서 확인)\n";
    for (const feature of report.productFeatures) {
      text += `- ${feature}\n`;
    }
    text += "\n";
  }

  if (report.visualStyle) {
    text += `### 시각적 스타일\n${report.visualStyle}\n\n`;
  }

  if (report.targetAudience) {
    text += `### 추정 타겟 오디언스\n${report.targetAudience}\n\n`;
  }

  if (report.adCopyHints?.length > 0) {
    text += "### 광고 카피 활용 포인트\n";
    for (const hint of report.adCopyHints) {
      text += `- ${hint}\n`;
    }
    text += "\n";
  }

  return text;
}

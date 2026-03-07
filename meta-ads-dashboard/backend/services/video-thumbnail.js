// 비디오 파일에서 대표 프레임 추출 — Claude Vision은 이미지만 분석 가능
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * 비디오에서 대표 프레임 1장 추출 (10% 지점)
 * @param {string} videoPath - 비디오 파일 절대 경로
 * @param {string} outputDir - 썸네일 저장 디렉터리
 * @returns {Promise<string>} 추출된 썸네일 이미지 경로
 */
export async function extractVideoThumbnail(videoPath, outputDir) {
  const basename = path.basename(videoPath, path.extname(videoPath));
  const thumbnailFilename = `${basename}-thumb.jpg`;
  const thumbnailPath = path.join(outputDir, thumbnailFilename);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ["10%"],
        filename: thumbnailFilename,
        folder: outputDir,
        size: "1280x?",
      })
      .on("end", () => {
        console.log(`[Video] Thumbnail extracted: ${thumbnailFilename}`);
        resolve(thumbnailPath);
      })
      .on("error", (err) => {
        console.error(`[Video] Thumbnail extraction failed:`, err.message);
        reject(new Error(`비디오 프레임 추출 실패: ${err.message}`));
      });
  });
}

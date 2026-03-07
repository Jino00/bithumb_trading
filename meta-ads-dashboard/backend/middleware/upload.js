// 광고 카피 생성용 미디어 파일 업로드 미들웨어 — multer 설정
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

// uploads 디렉터리 자동 생성
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `media-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if ([...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("지원하지 않는 파일 형식입니다. (JPG, PNG, WebP, GIF, MP4, MOV만 가능)"), false);
  }
};

export const uploadMedia = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}).single("media");

export function isVideoFile(mimetype) {
  return ALLOWED_VIDEO_TYPES.includes(mimetype);
}

export function isImageFile(mimetype) {
  return ALLOWED_IMAGE_TYPES.includes(mimetype);
}

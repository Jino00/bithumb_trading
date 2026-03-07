// 데이터 파이프라인 통합 체크 서비스 — 4가지 조치 상태를 한번에 진단
import { getDb } from "../db/database.js";
import { diagnosePixel } from "./pixel-diagnostics.js";
import { diagnoseUtmStatus } from "./utm-manager.js";
import { crossValidate } from "./data-cross-validator.js";

/**
 * 데이터 파이프라인 4가지 핵심 조치 상태를 통합 진단
 *
 * 1. Meta Pixel 표준 이벤트 설치 상태
 * 2. UTM 파라미터 설정 상태
 * 3. Cafe24 OAuth 연동 상태
 * 4. 크로스 검증 결과 (데이터 품질 점수)
 */
export async function checkPipeline() {
  const db = getDb();

  // 1. Meta 연결 상태
  const metaCred = db.prepare("SELECT * FROM meta_credentials WHERE user_id = 'default'").get();
  const metaConnected = !!metaCred && (!metaCred.expires_at || new Date(metaCred.expires_at) > new Date());

  // 2. Cafe24 연결 상태
  const cafe24Cred = db.prepare("SELECT * FROM cafe24_credentials WHERE id = 1").get();
  const cafe24Connected = !!cafe24Cred;

  // 3. Pixel 진단 (Meta 연결 시에만)
  let pixelStatus = { status: "skipped", reason: "Meta 미연결" };
  if (metaConnected) {
    try {
      const pixelResult = await diagnosePixel();
      pixelStatus = {
        status: pixelResult.overall_status,
        pixel_count: pixelResult.pixel_info?.pixel_count || 0,
        events: pixelResult.event_status,
        funnel_empty: pixelResult.funnel_check?.funnel_empty || true,
        issues: pixelResult.issues,
      };
    } catch (err) {
      pixelStatus = { status: "error", error: err.message };
    }
  }

  // 4. UTM 진단 (Meta 연결 시에만)
  let utmStatus = { status: "skipped", reason: "Meta 미연결" };
  if (metaConnected) {
    try {
      const utmResult = await diagnoseUtmStatus();
      if (utmResult.error) {
        utmStatus = { status: "error", error: utmResult.error };
      } else {
        utmStatus = {
          status: utmResult.summary.coverage_pct >= 80 ? "good" : utmResult.summary.coverage_pct > 0 ? "partial" : "missing",
          coverage_pct: utmResult.summary.coverage_pct,
          total_campaigns: utmResult.summary.total_campaigns,
          with_utm: utmResult.summary.with_utm,
          without_utm: utmResult.summary.without_utm,
        };
      }
    } catch (err) {
      utmStatus = { status: "error", error: err.message };
    }
  }

  // 5. 크로스 검증
  const endDate = new Date().toISOString().substring(0, 10);
  const startDate = new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10);

  let validationStatus;
  try {
    const validationResult = crossValidate(startDate, endDate);
    validationStatus = {
      quality_score: validationResult.quality_score.score,
      grade: validationResult.quality_score.grade,
      discrepancy_count: validationResult.discrepancies.length,
      critical_issues: validationResult.discrepancies.filter((d) => d.severity === "critical").length,
      corrected_roas: validationResult.corrected_metrics.corrected_roas,
      confidence: validationResult.corrected_metrics.confidence,
    };
  } catch (err) {
    validationStatus = { quality_score: 0, grade: "F", error: err.message };
  }

  // 6. 통합 체크리스트
  const checklist = [
    {
      id: "meta_connection",
      title: "Meta Ads 계정 연결",
      status: metaConnected ? "done" : "todo",
      priority: 1,
      action: metaConnected ? null : "Settings → Meta OAuth 연동",
    },
    {
      id: "pixel_installation",
      title: "Meta Pixel 표준 이벤트 설치",
      status: pixelStatus.status === "healthy" ? "done"
        : pixelStatus.status === "critical" ? "todo"
        : pixelStatus.status === "warning" ? "partial"
        : "unknown",
      priority: 2,
      action: pixelStatus.funnel_empty
        ? "Cafe24 관리자 → 외부 서비스 연동 → Meta Pixel 설정"
        : null,
      details: pixelStatus.events || null,
    },
    {
      id: "utm_setup",
      title: "UTM 파라미터 설정",
      status: utmStatus.status === "good" ? "done"
        : utmStatus.status === "partial" ? "partial"
        : utmStatus.status === "missing" ? "todo"
        : "unknown",
      priority: 3,
      action: utmStatus.coverage_pct < 80
        ? "UTM 자동 설정 API 호출 (/api/meta/utm/apply)"
        : null,
      details: utmStatus.coverage_pct !== undefined
        ? { coverage: `${utmStatus.coverage_pct}%` }
        : null,
    },
    {
      id: "cafe24_connection",
      title: "Cafe24 자사몰 연동",
      status: cafe24Connected ? "done" : "todo",
      priority: 4,
      action: cafe24Connected ? null : "Settings → Cafe24 OAuth 연동",
    },
  ];

  const completedSteps = checklist.filter((c) => c.status === "done").length;
  const totalSteps = checklist.length;

  // 7. 전체 진행률 + 다음 조치
  const nextAction = checklist.find((c) => c.status === "todo" || c.status === "partial");

  return {
    progress: {
      completed: completedSteps,
      total: totalSteps,
      percentage: Math.round((completedSteps / totalSteps) * 100),
    },
    checklist,
    next_action: nextAction
      ? { title: nextAction.title, action: nextAction.action, priority: nextAction.priority }
      : null,
    connections: {
      meta: metaConnected,
      cafe24: cafe24Connected,
    },
    pixel: pixelStatus,
    utm: utmStatus,
    validation: validationStatus,
    checked_at: new Date().toISOString(),
  };
}

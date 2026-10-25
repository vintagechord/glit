import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDeskResults } from "./review-desk";
import { renderReviewSummaryEmail, type ReviewSummaryEmailContent, type ReviewSummaryEmailRow } from "@/lib/email";
import { inspectOnlineMvBundleReadiness, type OnlineMvBundleState } from "@/lib/email-attachments";
import { getStationReviewDisplayStatus } from "@/lib/station-review-display";
import { broadcastRatingLabels } from "@/lib/broadcast-rating";
import { RATING_LABELS, isRatingCode } from "@/lib/mv-assets";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import { hasPublishedSubmissionResult } from "@/lib/submission-certificate";

export type ReviewSummaryEmailPreview = {
  subject: string; html: string; recipientMasked: string | null;
  revision: string; updatedAt: string; canSend: boolean;
  missingAssets: string[]; warnings: string[]; attachmentCount: 0 | 3;
};
export class ReviewEmailPreviewError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = "ReviewEmailPreviewError"; }
}
type Snapshot = Awaited<ReturnType<typeof loadDeskResults>>;
export type ReviewEmailContext = {
  db: SupabaseClient;
  submission: OnlineMvBundleState & { id: string; updated_at: string };
  recipient: string | null;
  link: string;
};
export function maskReviewRecipient(email: string | null) {
  if (!email) return null;
  const [name, domain] = email.split("@");
  if (!name || !domain) return null;
  return `${name.slice(0, Math.min(2, Math.max(1, name.length - 1)))}***@${domain}`;
}

export function buildReviewSummaryContent(snapshot: Snapshot, link: string): ReviewSummaryEmailContent {
  const submission = snapshot.submission;
  const type = snapshot.type as ReviewSummaryEmailContent["kind"];
  let completedCount = 0;
  let rows: ReviewSummaryEmailRow[];
  if (type === "MV_DISTRIBUTION") {
    const rating = submission.mv_desired_rating || submission.mv_rating;
    const valid = isRatingCode(rating) && hasPublishedSubmissionResult(submission);
    completedCount = valid ? 1 : 0;
    rows = [{ name: "영상물등급위원회", status: valid ? RATING_LABELS[rating] : "결과 대기", tone: rating === "REJECT" ? "rejected" : valid ? "approved" : "waiting", detail: valid && rating !== "REJECT" ? "온라인 공개용 뮤직비디오 등급" : null }];
  } else {
    rows = snapshot.stations.map(station => {
      const display = getStationReviewDisplayStatus({ ...station.review, station }, { albumTracks: type === "ALBUM" ? snapshot.tracks : undefined, showPartialTrackBreakdown: true });
      if (display.isComplete) completedCount++;
      const tone: ReviewSummaryEmailRow["tone"] = display.key === "APPROVED" ? "approved" : display.key === "REJECTED" ? "rejected" : display.needsAttention ? "attention" : ["IN_REVIEW", "WAITING_RESULT"].includes(display.key) ? "progress" : "waiting";
      let detail: string | null = null;
      if (type === "ALBUM") {
        const counts = display.summary.counts;
        const parts = [counts.approved ? `${counts.approved}곡 적격` : null, counts.rejected ? `${counts.rejected}곡 부적격` : null, counts.pending ? `${counts.pending}곡 결과 대기` : null].filter(Boolean);
        detail = parts.join(" · ") || (station.trackIds.length ? `심의 대상 ${station.trackIds.length}곡` : null);
      } else if (display.key === "APPROVED") {
        detail = station.review.age_rating ? broadcastRatingLabels[station.review.age_rating] ?? "연령 등급 확인 필요" : "연령 등급 확인 필요";
      }
      return { name: station.name || station.code || "방송사", status: type === "MV_BROADCAST" && display.key === "APPROVED" ? "적격" : display.label, tone, detail };
    });
  }
  return {
    title: submission.title ?? "제목 미입력", artist: submission.artist_name,
    kind: type, updatedAt: submission.updated_at, link, rows, completedCount,
    attachmentCount: type === "MV_DISTRIBUTION" && (submission.mv_desired_rating || submission.mv_rating) !== "REJECT" ? 3 : 0,
  };
}

/** Server-only preparation; callers must authorize the administrator first. */
export async function prepareReviewSummaryPreview(context: ReviewEmailContext) {
  const snapshot = await loadDeskResults(context.db, context.submission.id);
  if (snapshot.submission.updated_at !== context.submission.updated_at) throw new ReviewEmailPreviewError("미리보기를 준비하는 동안 심의 내용이 변경되었습니다. 다시 불러와주세요.", 409, "CONFLICT");
  if (!["ALBUM", "MV_BROADCAST", "MV_DISTRIBUTION"].includes(snapshot.type)) throw new ReviewEmailPreviewError("심의 접수 유형을 확인해주세요.", 400, "INVALID_TYPE");
  const content = buildReviewSummaryContent(snapshot, context.link);
  const warnings: string[] = [];
  if (!context.recipient) warnings.push("수신 이메일을 확인하지 못했습니다.");
  if (getEmailDeliveryMode() !== "transactional") warnings.push("이메일 발송 설정이 준비되지 않았습니다.");
  if (snapshot.submission.status === "DRAFT") warnings.push("제출되지 않은 신청에는 심의 현황을 보낼 수 없습니다.");
  if (!content.rows.length) warnings.push("신청 방송사 목록을 확인해주세요.");
  if (snapshot.type === "MV_BROADCAST" && content.rows.some(row => row.detail === "연령 등급 확인 필요")) warnings.push("적격으로 저장된 방송사의 연령 등급을 먼저 입력해주세요.");
  const missingAssets = snapshot.type === "MV_DISTRIBUTION" ? inspectOnlineMvBundleReadiness({ ...snapshot.submission, certificate_b2_path: context.submission.certificate_b2_path }).missing : [];
  const rendered = renderReviewSummaryEmail(content);
  const revision = createHash("sha256").update(JSON.stringify([
    snapshot.revision, content, context.recipient, context.submission.certificate_b2_path ?? null,
  ])).digest("hex");
  const preview: ReviewSummaryEmailPreview = {
    ...rendered, recipientMasked: maskReviewRecipient(context.recipient), revision,
    updatedAt: snapshot.submission.updated_at, canSend: !warnings.length && !missingAssets.length,
    missingAssets, warnings, attachmentCount: content.attachmentCount,
  };
  return { snapshot, content, preview };
}

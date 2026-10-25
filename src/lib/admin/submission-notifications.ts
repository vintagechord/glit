import { createHash } from "node:crypto";
import { resolveSubmissionNotificationRecipient } from "./notification-recipient";

import { sendResultEmail, sendReviewSummaryEmail, sendSubmissionUpdateEmail } from "@/lib/email";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildUrl, getBaseUrl } from "@/lib/url";
import { EmailAttachmentError, inspectOnlineMvBundleReadiness, prepareOnlineMvAttachmentRefs } from "@/lib/email-attachments";
import { RATING_LABELS, isRatingCode } from "@/lib/mv-assets";
import { prepareReviewSummaryPreview, ReviewEmailPreviewError } from "./review-email-preview";
export { ReviewEmailPreviewError } from "./review-email-preview";
export type { ReviewSummaryEmailPreview } from "./review-email-preview";

export type SubmissionNotificationOutcome = {
  deliveredCount: number;
  skippedCount: number;
  failedCount: number;
  recipientCount: number;
  queuedCount?: number;
  uncertainCount?: number;
  replayed?: boolean;
  warning?: string;
  pendingAssets?: boolean;
  error?: string;
  errorCode?: "CONFLICT" | "NOT_READY" | "LOAD_FAILED" | "INVALID_REQUEST";
};

const emptyOutcome = (): SubmissionNotificationOutcome => ({
  deliveredCount: 0, skippedCount: 0, failedCount: 0, recipientCount: 0,
});

async function loadContext(submissionId: string) {
  const db = createAdminClient();
  const { data: submission, error } = await db.from("submissions")
    .select("id, title, artist_name, type, user_id, guest_token, applicant_email, applicant_phone, guest_email, guest_phone, updated_at, status, result_status, result_notified_at, mv_desired_rating, mv_rating, certificate_b2_path, certificate_original_name")
    .eq("id", submissionId).maybeSingle();
  if (error || !submission) return null;

  const { recipient, phone } = await resolveSubmissionNotificationRecipient(db, submission);
  const link = buildUrl(!submission.user_id && submission.guest_token?.length >= 8
    ? `/track/${encodeURIComponent(submission.guest_token)}`
    : `/dashboard/submissions/${submission.id}`, getBaseUrl());
  return { db, submission, recipient, phone, link };
}

type Context = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

async function deliver(
  submissionId: string,
  send: (context: Context, email: string) => Promise<{ ok: boolean; skipped?: boolean; queued?: boolean; status?: string }>,
  kakao: (context: Context) => { title: string; message: string },
): Promise<SubmissionNotificationOutcome> {
  const outcome = emptyOutcome();
  try {
    const context = await loadContext(submissionId);
    if (!context) return { ...outcome, warning: "변경사항은 저장되었지만 수신 정보를 확인하지 못해 이메일을 보내지 못했습니다." };
    outcome.recipientCount = context.recipient ? 1 : 0;
    if (!context.recipient) {
      outcome.warning = "변경사항은 저장되었습니다. 수신 이메일을 확인하지 못해 안내 메일을 보내지 못했습니다.";
    } else if (getEmailDeliveryMode() === "manual") {
      outcome.skippedCount = 1;
      outcome.warning = "변경사항은 저장되었습니다. 자동 이메일 발송은 보류 중입니다. 고객에게 별도로 안내해주세요.";
    } else {
      const result = await send(context, context.recipient).catch(() => ({ ok: false }));
      if (result.ok) outcome.deliveredCount = 1;
      else if ("queued" in result && result.queued) outcome.queuedCount = 1;
      else if ("skipped" in result && result.skipped) outcome.skippedCount = 1;
      else outcome.failedCount = 1;
      if (!result.ok) outcome.warning = "status" in result && result.status === "uncertain"
        ? "변경사항은 저장되었습니다. 발송 업체의 접수 여부를 확인해야 합니다. 이메일 발송 내역에서 확인해주세요."
        : outcome.queuedCount
          ? "변경사항은 저장되었습니다. 이메일은 자동 재시도 예정입니다. 이메일 발송 내역에서 확인할 수 있습니다."
          : outcome.skippedCount
        ? "변경사항은 저장되었습니다. 이메일 발송 설정을 확인한 뒤 고객에게 별도로 안내해주세요."
        : "변경사항은 저장되었지만 이메일 발송에 실패했습니다. 이메일 발송 내역에서 확인해주세요.";
    }
    // Optional Kakao failures must not change an already committed save or
    // conceal the email outcome. No raw result notes are sent through this path.
    await sendKakaoOfficialNotification({ phone: context.phone, ...kakao(context), link: context.link }).catch(() => undefined);
    return outcome;
  } catch {
    return { ...outcome, warning: "변경사항은 저장되었지만 이메일 안내를 완료하지 못했습니다. 고객에게 별도로 안내해주세요." };
  }
}

/** Called only after an authorized, committed customer-visible change.
 * Provider acceptance is not proof of inbox delivery. Delivery retries use the shared outbox.
 */
export function sendSubmissionUpdateNotificationById(input: {
  submissionId: string; headline: string; summary: string; subject?: string; changeKey?: string; markResultNotified?: boolean;
}) {
  return deliver(input.submissionId, (context, email) => sendSubmissionUpdateEmail({
    email, title: context.submission.title ?? "제목 미입력",
    artist: context.submission.artist_name ?? null,
    kind: context.submission.type?.startsWith("MV") ? "MV" : "ALBUM",
    headline: input.headline, summary: input.summary, subject: input.subject, link: context.link,
    submissionId: context.submission.id, markResultNotified: input.markResultNotified,
    idempotencyKey: `submission-update-${createHash("sha256").update(JSON.stringify([
      input.submissionId, input.changeKey ?? context.submission.updated_at,
      input.headline, input.summary, email,
    ])).digest("hex")}`,
  }), () => ({ title: input.headline, message: input.summary }));
}

export function sendSubmissionResultNotificationById(input: {
  submissionId: string; resultStatus: "APPROVED" | "REJECTED" | "NEEDS_FIX"; resultMemo?: string; changeKey?: string;
}) {
  return deliver(input.submissionId, (context, email) => sendResultEmail({
    email, title: context.submission.title ?? "제목 미입력",
    artist: context.submission.artist_name ?? null, resultStatus: input.resultStatus,
    // Full result details stay behind the existing account/guest access check.
    resultMemo: null, link: context.link, submissionId: context.submission.id, markResultNotified: true,
    idempotencyKey: `submission-result-${createHash("sha256").update(JSON.stringify([
      input.submissionId, input.changeKey ?? context.submission.updated_at, input.resultStatus, email,
    ])).digest("hex")}`,
  }), () => ({ title: "심의 결과가 업데이트되었습니다.", message: "신청 내역에서 변경된 심의 결과를 확인해주세요." }));
}

/** Legacy explicit online-only notification API. Save handlers must not call it.
 * New preview/send controls use sendReviewSummaryNotificationById below. */
export async function sendOnlineMvResultNotificationById(input: { submissionId: string; forceResendKey?: string }): Promise<SubmissionNotificationOutcome> {
  const context = await loadContext(input.submissionId).catch(() => null);
  if (!context) return { ...emptyOutcome(), warning: "결과는 저장되었지만 신청 정보를 확인하지 못해 안내하지 못했습니다." };
  const readiness = inspectOnlineMvBundleReadiness(context.submission);
  if (!readiness.ready) return { ...emptyOutcome(), pendingAssets: true, warning: `결과는 저장되었습니다. ${readiness.missing.join(" ")} 등급과 필증이 준비되면 3개 첨부파일을 함께 안내합니다.` };
  if (readiness.rejected) return sendSubmissionResultNotificationById({ submissionId: input.submissionId, resultStatus: "REJECTED", changeKey: input.forceResendKey || `${context.submission.updated_at}:REJECT` });
  if (!context.recipient || getEmailDeliveryMode() === "manual") {
    return { ...emptyOutcome(), recipientCount: context.recipient ? 1 : 0, skippedCount: context.recipient ? 1 : 0, warning: context.recipient ? "결과는 저장되었습니다. 자동 이메일 발송이 보류 중입니다." : "결과는 저장되었습니다. 수신 이메일을 확인하지 못했습니다." };
  }
  try {
    const refs = await prepareOnlineMvAttachmentRefs(context.submission, context.db);
    const ratingLabel = isRatingCode(readiness.rating) ? RATING_LABELS[readiness.rating] : readiness.rating;
    return deliver(input.submissionId, (latest, email) => sendSubmissionUpdateEmail({
      email, title: latest.submission.title ?? "제목 미입력", artist: latest.submission.artist_name, kind: "MV",
      headline: `영등위 심의 결과: ${ratingLabel}`,
      summary: `확정 등급은 ${ratingLabel}입니다. 등급 이미지, 등급 표시 사용 예시 PDF, 영등위 심의필증을 첨부했습니다. 개인 결과 페이지에서도 같은 세 파일을 다운로드할 수 있습니다. 사용 예시에 따라 등급을 표시해주세요.`,
      subject: `[onside] 영등위 심의 결과 및 첨부파일 — ${ratingLabel}`,
      link: latest.link, submissionId: input.submissionId, markResultNotified: true,
      idempotencyKey: `online-mv-bundle-${createHash("sha256").update(JSON.stringify([
        input.submissionId, readiness.rating, refs.map(r => [r.kind, r.objectKey, r.sha256]), email, input.forceResendKey || null,
      ])).digest("hex")}`, attachmentRefs: refs,
    }), () => ({ title: "영등위 심의 결과가 준비되었습니다.", message: "이메일과 신청 내역에서 확정 등급과 첨부파일을 확인해주세요." }));
  } catch (error) {
    return { ...emptyOutcome(), recipientCount: 1, failedCount: 1, warning: `결과는 저장되었습니다. ${error instanceof EmailAttachmentError ? error.message : "첨부파일 안내를 완료하지 못했습니다. 이메일 발송 내역을 확인하고 다시 안내해주세요."}` };
  }
}

const reviewUuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const reviewRequestKey = (submissionId: string, requestId: string) => `review-summary-${createHash("sha256").update(JSON.stringify([submissionId.toLowerCase(), requestId.toLowerCase()])).digest("hex")}`;
function summaryDeliveryOutcome(result: { ok: boolean; queued?: boolean; skipped?: boolean; status?: string }): SubmissionNotificationOutcome {
  const outcome: SubmissionNotificationOutcome = { ...emptyOutcome(), recipientCount: 1 };
  if (result.ok) outcome.deliveredCount = 1;
  else if (result.status === "uncertain") { outcome.uncertainCount = 1; outcome.warning = "발송 업체의 접수 여부를 확인해야 합니다. 중복 발송 전에 이메일 발송 내역을 확인해주세요."; }
  else if (result.queued) { outcome.queuedCount = 1; outcome.warning = "이메일이 발송 대기열에 등록되었습니다. 자동 재시도 상태는 이메일 발송 내역에서 확인할 수 있습니다."; }
  else if (result.skipped) { outcome.skippedCount = 1; outcome.warning = "이메일을 보내지 못했습니다. 발송 설정을 확인해주세요."; }
  else { outcome.failedCount = 1; outcome.warning = "이메일 발송에 실패했습니다. 이메일 발송 내역을 확인하고 다시 시도해주세요."; }
  return outcome;
}
async function findReviewRequestReceipt(submissionId: string, requestId: string) {
  const db = createAdminClient();
  const requestKey = reviewRequestKey(submissionId, requestId);
  // The shared outbox hashes recipient + logical key. Read only the private
  // receipt metadata for this submission so retries also work after an address
  // change. Never return an address or old mail body to the preview client.
  for (let offset = 0; offset < 2000; offset += 100) {
    const { data, error } = await db.from("email_outbox").select("status,idempotency_key,recipient_email")
      .eq("submission_id", submissionId).eq("operation", "review result")
      .order("created_at", { ascending: false }).range(offset, offset + 99);
    if (error) throw new Error("Receipt lookup unavailable");
    for (const row of data ?? []) {
      const key = createHash("sha256").update(`review result\0${String(row.recipient_email).toLowerCase()}\0${requestKey}`).digest("hex");
      if (key === row.idempotency_key) return { ...summaryDeliveryOutcome({ ok: row.status === "accepted", queued: ["pending", "sending", "retry"].includes(row.status), status: row.status }), replayed: true };
    }
    if (!data || data.length < 100) return null;
  }
  // Do not create a potentially duplicate send if older receipts cannot be
  // conclusively checked within the bounded lookup.
  throw new Error("Receipt lookup bound exceeded");
}
async function loadPreparedReviewSummary(submissionId: string) {
  if (!reviewUuid.test(submissionId)) throw new ReviewEmailPreviewError("접수 ID를 확인해주세요.", 400, "INVALID_REQUEST");
  const context = await loadContext(submissionId);
  if (!context) throw new ReviewEmailPreviewError("신청과 수신 정보를 불러오지 못했습니다.", 503, "LOAD_FAILED");
  const prepared = await prepareReviewSummaryPreview(context);
  return { context, ...prepared };
}

/** The caller authorizes the administrator. Preview never writes files or queues mail. */
export async function getReviewSummaryEmailPreviewById(input: { submissionId: string }) {
  try { return (await loadPreparedReviewSummary(input.submissionId)).preview; }
  catch (error) {
    if (error instanceof ReviewEmailPreviewError) throw error;
    throw new ReviewEmailPreviewError("이메일 미리보기를 불러오지 못했습니다. 다시 시도해주세요.", 503, "LOAD_FAILED");
  }
}

/** Explicit user action only. A save must never call this operation automatically.
 * requestId is stable for one button request/retry; a deliberate resend gets a new UUID.
 */
export async function sendReviewSummaryNotificationById(input: {
  submissionId: string; requestId: string; expectedRevision?: string; expectedUpdatedAt?: string;
}): Promise<SubmissionNotificationOutcome> {
  const fail = (errorCode: NonNullable<SubmissionNotificationOutcome["errorCode"]>, error: string, extra: Partial<SubmissionNotificationOutcome> = {}): SubmissionNotificationOutcome => ({ ...emptyOutcome(), errorCode, error, warning: error, ...extra });
  if (!reviewUuid.test(input.submissionId) || !reviewUuid.test(input.requestId) ||
    (input.expectedRevision !== undefined && !/^[a-f\d]{64}$/.test(input.expectedRevision)) ||
    (input.expectedUpdatedAt !== undefined && Number.isNaN(Date.parse(input.expectedUpdatedAt)))) {
    return fail("INVALID_REQUEST", "이메일 발송 요청과 미리보기 정보를 확인해주세요.");
  }
  try {
    const receipt = await findReviewRequestReceipt(input.submissionId, input.requestId);
    if (receipt) return receipt;
    const prepared = await loadPreparedReviewSummary(input.submissionId);
    const { context, preview, content, snapshot } = prepared;
    if ((input.expectedRevision && preview.revision !== input.expectedRevision) || (input.expectedUpdatedAt && preview.updatedAt !== input.expectedUpdatedAt)) {
      return fail("CONFLICT", "미리보기 이후 심의 내용이나 수신 정보가 변경되었습니다. 새 미리보기를 확인한 뒤 보내주세요.");
    }
    if (!preview.canSend || !context.recipient) return fail("NOT_READY", [...preview.warnings, ...preview.missingAssets].join(" ") || "이메일 발송 준비를 확인해주세요.", { pendingAssets: preview.missingAssets.length > 0, recipientCount: context.recipient ? 1 : 0 });
    const refs = content.attachmentCount === 3 ? await prepareOnlineMvAttachmentRefs({ ...snapshot.submission, certificate_b2_path: context.submission.certificate_b2_path, certificate_original_name: context.submission.certificate_original_name }, context.db) : undefined;
    // Preparing three files can take time. Re-read before queueing so changes to
    // results, recipient, access link or rendered content invalidate this preview.
    const latest = await loadPreparedReviewSummary(input.submissionId);
    if (latest.preview.revision !== preview.revision || !latest.preview.canSend) return fail("CONFLICT", "이메일을 준비하는 동안 심의 내용이나 수신 정보가 변경되었습니다. 새 미리보기를 확인한 뒤 보내주세요.");
    const result = await sendReviewSummaryEmail({
      email: context.recipient, submissionId: input.submissionId, content,
      idempotencyKey: reviewRequestKey(input.submissionId, input.requestId),
      // An aggregate progress notice must not manufacture a published final result.
      markResultNotified: Boolean(snapshot.submission.result_status || ["RESULT_READY", "COMPLETED"].includes(snapshot.submission.status)),
      ...(refs ? { attachmentRefs: refs } : {}),
    });
    return summaryDeliveryOutcome(result);
  } catch (error) {
    if (error instanceof EmailAttachmentError) return fail("NOT_READY", error.message, { failedCount: 1, pendingAssets: true });
    if (error instanceof ReviewEmailPreviewError && error.code === "CONFLICT") return fail("CONFLICT", error.message);
    return fail("LOAD_FAILED", "이메일 발송 준비를 완료하지 못했습니다. 새 미리보기를 확인하고 다시 시도해주세요.", { failedCount: 1 });
  }
}

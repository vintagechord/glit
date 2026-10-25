import { createHash } from "node:crypto";
import { resolveSubmissionNotificationRecipient } from "./notification-recipient";

import { sendResultEmail, sendSubmissionUpdateEmail } from "@/lib/email";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildUrl, getBaseUrl } from "@/lib/url";
import { EmailAttachmentError, inspectOnlineMvBundleReadiness, prepareOnlineMvAttachmentRefs } from "@/lib/email-attachments";
import { RATING_LABELS, isRatingCode } from "@/lib/mv-assets";

export type SubmissionNotificationOutcome = {
  deliveredCount: number;
  skippedCount: number;
  failedCount: number;
  recipientCount: number;
  queuedCount?: number;
  warning?: string;
  pendingAssets?: boolean;
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

/** Grade-save and certificate-save call the same bundle operation. The key is
 * based on the exact immutable assets, so the two UI paths cannot double-send. */
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

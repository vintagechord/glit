import { createHash } from "node:crypto";
import { z } from "zod";

import { sendResultEmail, sendSubmissionUpdateEmail } from "@/lib/email";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildUrl, getBaseUrl } from "@/lib/url";

export type SubmissionNotificationOutcome = {
  deliveredCount: number;
  skippedCount: number;
  failedCount: number;
  recipientCount: number;
  warning?: string;
};

const emptyOutcome = (): SubmissionNotificationOutcome => ({
  deliveredCount: 0, skippedCount: 0, failedCount: 0, recipientCount: 0,
});

async function loadContext(submissionId: string) {
  const db = createAdminClient();
  const { data: submission, error } = await db.from("submissions")
    .select("id, title, artist_name, type, user_id, guest_token, applicant_email, applicant_phone, guest_email, guest_phone, updated_at")
    .eq("id", submissionId).maybeSingle();
  if (error || !submission) return null;

  let email: string | null = null;
  let phone: string | null = null;
  if (submission.user_id) {
    // The account email is authoritative. Never substitute an unverified
    // applicant address or include a legacy guest access token for a member.
    const member = await db.auth.admin.getUserById(submission.user_id);
    if (!member.error) email = member.data.user?.email ?? null;
    const profile = await db.from("profiles").select("phone")
      .eq("user_id", submission.user_id).maybeSingle();
    phone = profile.data?.phone ?? null;
  } else {
    email = submission.guest_email || submission.applicant_email || null;
    phone = submission.guest_phone || submission.applicant_phone || null;
  }
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const recipient = z.string().email().safeParse(normalizedEmail).success ? normalizedEmail : null;
  const link = buildUrl(!submission.user_id && submission.guest_token?.length >= 8
    ? `/track/${encodeURIComponent(submission.guest_token)}`
    : `/dashboard/submissions/${submission.id}`, getBaseUrl());
  return { db, submission, recipient, phone, link };
}

type Context = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

async function deliver(
  submissionId: string,
  send: (context: Context, email: string) => Promise<{ ok: boolean; skipped?: boolean }>,
  kakao: (context: Context) => { title: string; message: string },
  markResult = false,
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
      else if ("skipped" in result && result.skipped) outcome.skippedCount = 1;
      else outcome.failedCount = 1;
      if (!result.ok) outcome.warning = outcome.skippedCount
        ? "변경사항은 저장되었습니다. 이메일 발송 설정을 확인한 뒤 고객에게 별도로 안내해주세요."
        : "변경사항은 저장되었지만 이메일 발송에 실패했습니다. 고객에게 별도로 안내해주세요.";
      if (result.ok && markResult) {
        const { error } = await context.db.from("submissions")
          .update({ result_notified_at: new Date().toISOString() }).eq("id", submissionId);
        if (error) outcome.warning = "이메일은 발송 업체에 접수되었지만 발송 기록 저장에 실패했습니다.";
      }
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
 * Provider acceptance is not proof of inbox delivery. There is no retry queue.
 */
export function sendSubmissionUpdateNotificationById(input: {
  submissionId: string; headline: string; summary: string; subject?: string; changeKey?: string;
}) {
  return deliver(input.submissionId, (context, email) => sendSubmissionUpdateEmail({
    email, title: context.submission.title ?? "제목 미입력",
    artist: context.submission.artist_name ?? null,
    kind: context.submission.type?.startsWith("MV") ? "MV" : "ALBUM",
    headline: input.headline, summary: input.summary, subject: input.subject, link: context.link,
    idempotencyKey: `submission-update-${createHash("sha256").update(JSON.stringify([
      input.submissionId, input.changeKey ?? context.submission.updated_at,
      input.headline, input.summary, email,
    ])).digest("hex")}`,
  }), () => ({ title: input.headline, message: input.summary }));
}

export function sendSubmissionResultNotificationById(input: {
  submissionId: string; resultStatus: "APPROVED" | "REJECTED" | "NEEDS_FIX"; resultMemo?: string;
}) {
  return deliver(input.submissionId, (context, email) => sendResultEmail({
    email, title: context.submission.title ?? "제목 미입력",
    artist: context.submission.artist_name ?? null, resultStatus: input.resultStatus,
    // Full result details stay behind the existing account/guest access check.
    resultMemo: null, link: context.link,
  }), () => ({ title: "심의 결과가 업데이트되었습니다.", message: "신청 내역에서 변경된 심의 결과를 확인해주세요." }), true);
}

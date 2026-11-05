import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { isEmailLessSocialMember } from "@/lib/member-notification-email";

export type RecipientSource = "member_account" | "member_notification" | "application" | "guest" | "none";

export type SubmissionRecipientState = {
  recipient: string | null;
  source: RecipientSource;
  /** The submission column an administrator may set; null when it would not be used. */
  editField: "guest_email" | "applicant_email" | null;
  /** Why the address cannot be changed here, when editField is null. */
  lockedReason: string | null;
  /** Addresses from the same member's other applications. */
  suggestions: string[];
};

type RecipientSubmission = {
  id: string;
  user_id?: string | null;
  guest_email?: string | null;
  applicant_email?: string | null;
};

export const notificationEmailSchema = z.string().trim().toLowerCase().max(200).email();

const validEmail = (value?: string | null) => {
  const parsed = notificationEmailSchema.safeParse(value ?? "");
  return parsed.success ? parsed.data : null;
};

export const recipientSourceLabels: Record<RecipientSource, string> = {
  member_account: "회원 계정 이메일",
  member_notification: "회원이 저장한 알림 이메일",
  application: "이 신청서의 신청자 이메일",
  guest: "비회원 신청 이메일",
  none: "등록된 이메일 없음",
};

/**
 * Mirrors resolveSubmissionNotificationRecipient, and also says which column
 * an administrator can fill so the result mail reaches the customer. Account
 * addresses and a member's own saved address are never overridden here.
 */
export async function describeSubmissionRecipient(
  db: SupabaseClient,
  submission: RecipientSubmission,
): Promise<SubmissionRecipientState> {
  if (!submission.user_id) {
    const recipient = validEmail(submission.guest_email) ?? validEmail(submission.applicant_email);
    return { recipient, source: recipient ? "guest" : "none", editField: "guest_email", lockedReason: null, suggestions: [] };
  }

  const member = await db.auth.admin.getUserById(submission.user_id);
  if (member.error || !member.data.user) {
    throw new Error("Member lookup unavailable");
  }
  const user = member.data.user;
  const accountEmail = validEmail(user.email);
  if (accountEmail) {
    return {
      recipient: accountEmail, source: "member_account", editField: null,
      lockedReason: "회원 계정 이메일로 발송됩니다. 다른 주소로 바꾸려면 회원이 계정 이메일을 변경해야 합니다.",
      suggestions: [],
    };
  }
  if (!isEmailLessSocialMember(user)) {
    return {
      recipient: null, source: "none", editField: null,
      lockedReason: "이메일 없는 회원 계정이라 자동 안내 메일을 보낼 수 없습니다. 고객에게 직접 안내해주세요.",
      suggestions: [],
    };
  }

  const [profile, others] = await Promise.all([
    db.from("profiles").select("notification_email").eq("user_id", submission.user_id).maybeSingle(),
    db.from("submissions").select("applicant_email, updated_at").eq("user_id", submission.user_id)
      .neq("id", submission.id).not("applicant_email", "is", null)
      .order("updated_at", { ascending: false }).limit(20),
  ]);
  if (profile.error) throw new Error("Notification email lookup unavailable");
  const suggestions = [...new Set(((others.data ?? []) as Array<{ applicant_email: string | null }>)
    .map((row) => validEmail(row.applicant_email)).filter((value): value is string => Boolean(value)))];

  const saved = validEmail(profile.data?.notification_email);
  if (saved) {
    return {
      recipient: saved, source: "member_notification", editField: null,
      lockedReason: "회원이 내 정보에 저장한 알림 이메일로 발송됩니다.",
      suggestions: [],
    };
  }
  const applicant = validEmail(submission.applicant_email);
  return {
    recipient: applicant,
    source: applicant ? "application" : "none",
    editField: "applicant_email",
    lockedReason: null,
    suggestions: suggestions.filter((value) => value !== applicant),
  };
}

export type SaveRecipientResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

/** Stores the address in the column the result mail reads. Payment, status
 * and review data are untouched. */
export async function saveSubmissionNotificationEmail(
  db: SupabaseClient,
  input: { submissionId: string; email: string; actorUserId: string },
): Promise<SaveRecipientResult> {
  const email = notificationEmailSchema.safeParse(input.email);
  if (!email.success) return { ok: false, error: "이메일 주소 형식을 확인해주세요." };

  const { data: submission, error } = await db.from("submissions")
    .select("id, user_id, guest_email, applicant_email").eq("id", input.submissionId).maybeSingle();
  if (error) return { ok: false, error: "접수 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." };
  if (!submission) return { ok: false, error: "접수를 찾을 수 없습니다." };

  let state: SubmissionRecipientState;
  try {
    state = await describeSubmissionRecipient(db, submission as RecipientSubmission);
  } catch {
    return { ok: false, error: "회원 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
  if (!state.editField) return { ok: false, error: state.lockedReason ?? "이 접수의 수신 이메일은 여기서 바꿀 수 없습니다." };
  const current = (submission as Record<string, string | null>)[state.editField];
  if (validEmail(current) === email.data) return { ok: true, changed: false };

  const { error: updateError } = await db.from("submissions")
    .update({ [state.editField]: email.data }).eq("id", input.submissionId);
  if (updateError) return { ok: false, error: "수신 이메일을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };

  // Customers can read their events, so the message carries no address.
  await db.from("submission_events").insert({
    submission_id: input.submissionId,
    actor_user_id: input.actorUserId,
    event_type: "ADMIN_CONTACT",
    message: "관리자가 결과 안내를 받을 이메일을 등록했습니다.",
  });
  return { ok: true, changed: true };
}

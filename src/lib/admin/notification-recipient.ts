import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getMemberNotificationEmail } from "@/lib/member-notification-email";

type SubmissionContact = {
  user_id?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  applicant_email?: string | null;
  applicant_phone?: string | null;
};

/** Auth owns a member's address; email-less social members use their application contact. */
export async function resolveSubmissionNotificationRecipient(db: SupabaseClient, submission: SubmissionContact) {
  let email: string | null = null;
  let phone: string | null = null;
  if (submission.user_id) {
    const member = await db.auth.admin.getUserById(submission.user_id);
    if (!member.error) email = getMemberNotificationEmail(member.data.user, submission.applicant_email);
    const profile = await db.from("profiles").select("phone").eq("user_id", submission.user_id).maybeSingle();
    phone = profile.data?.phone ?? null;
  } else {
    email = submission.guest_email || submission.applicant_email || null;
    phone = submission.guest_phone || submission.applicant_phone || null;
  }
  const normalized = email?.trim().toLowerCase() ?? "";
  return { recipient: z.string().email().safeParse(normalized).success ? normalized : null, phone };
}

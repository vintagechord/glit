import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

type MemberIdentity = {
  id?: string;
  email?: string | null;
  app_metadata?: { provider?: unknown; providers?: unknown };
  identities?: { provider: string }[];
};

const emailAddress = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return z.string().email().safeParse(normalized).success ? normalized : null;
};

export function isEmailLessSocialMember(user: MemberIdentity | null | undefined) {
  if (!user?.id || user.email?.trim()) return false;
  const providers = [
    user.app_metadata?.provider,
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(user.identities?.map(identity => identity.provider) ?? []),
  ];
  return providers.some(provider => ["google", "kakao", "custom:naver"].includes(String(provider)));
}

/** Use only with a verified server-side Auth user, never browser metadata.
 * Email-less social members prefer their saved profile address, then the
 * application's contact. Missing users never use historical contacts.
 */
export function getMemberNotificationEmail(user: MemberIdentity | null | undefined, applicantEmail?: string | null, notificationEmail?: string | null) {
  if (!user) return null;
  if (user.email?.trim()) return emailAddress(user.email);
  if (!isEmailLessSocialMember(user)) return null;
  return emailAddress(notificationEmail?.trim() ? notificationEmail : applicantEmail);
}

export async function resolveMemberNotificationEmail(db: SupabaseClient, user: MemberIdentity | null | undefined, applicantEmail?: string | null) {
  if (!user?.id || !isEmailLessSocialMember(user)) return getMemberNotificationEmail(user, applicantEmail);
  const { data, error } = await db.from("profiles").select("notification_email").eq("user_id", user.id).maybeSingle();
  // A failed lookup must not send to an older application address instead of
  // the member's potentially newer saved address. Callers can safely retry.
  if (error) throw new Error("Notification email lookup unavailable");
  return getMemberNotificationEmail(user, applicantEmail, data?.notification_email);
}

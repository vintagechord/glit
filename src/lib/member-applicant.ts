import type { SupabaseClient, User } from "@supabase/supabase-js";

import { socialDisplayName } from "@/features/auth/social-contract";
import { getMemberNotificationEmail } from "@/lib/member-notification-email";

export type MemberApplicant = { name: string; email: string; phone: string };

/**
 * Contact defaults for a signed-in member's application form: the saved
 * profile wins, then the details given at signup; absent values stay empty.
 */
export async function loadMemberApplicant(db: Pick<SupabaseClient, "from">, user: User): Promise<MemberApplicant> {
  const profile = (await db.from("profiles").select("name,phone,notification_email").eq("user_id", user.id).maybeSingle()).data;
  return {
    name: profile?.name ?? socialDisplayName(user),
    email: getMemberNotificationEmail(user, undefined, profile?.notification_email) ?? "",
    phone: profile?.phone ?? (typeof user.user_metadata?.phone === "string" ? user.user_metadata.phone : user.phone ?? ""),
  };
}

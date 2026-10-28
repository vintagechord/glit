import { z } from "zod";

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

/** Use only with a verified server-side Auth user, never browser metadata.
 * An email-less social member's declared application contact receives that
 * application's notices. Missing users/lookups never use historical contacts.
 */
export function getMemberNotificationEmail(user: MemberIdentity | null | undefined, applicantEmail?: string | null) {
  if (!user) return null;
  if (user.email?.trim()) return emailAddress(user.email);
  if (!user.id) return null;
  const providers = [
    user.app_metadata?.provider,
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(user.identities?.map(identity => identity.provider) ?? []),
  ];
  return providers.some(provider => ["google", "kakao", "custom:naver"].includes(String(provider)))
    ? emailAddress(applicantEmail) : null;
}

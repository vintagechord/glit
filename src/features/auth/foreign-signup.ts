type AuthUserLike = {
  id?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  identities?: Array<{ provider?: string | null }> | null;
  app_metadata?: { provider?: unknown; providers?: unknown; signupVerificationFlow?: unknown } | null;
};

/**
 * GoTrue's public /auth/v1/signup stays open (social sign-in needs new users),
 * so anyone holding the anon key can create an unconfirmed email account for
 * someone else's address. This app never uses that endpoint: it creates
 * accounts with admin.createUser and the SIGNUP_VERIFICATION_FLOW marker
 * (passed in as appFlowMarker; account-lookup.ts is server-only).
 * With mailer_autoconfirm off, such a foreign account cannot have signed in
 * and owns no data, yet it blocked the real owner's signup.
 *
 * True only for an email-only account that was never confirmed (by email or
 * phone), never signed in and lacks this app's marker. Confirmed, social,
 * signed-in and marked pending accounts are always kept.
 */
export function isUnclaimedForeignSignup(user: AuthUserLike | null | undefined, email: string, appFlowMarker: string) {
  if (!user?.id || typeof user.email !== "string") return false;
  if (user.email.trim().toLowerCase() !== email.trim().toLowerCase()) return false;
  if (user.email_confirmed_at || user.phone_confirmed_at || user.confirmed_at || user.last_sign_in_at) return false;
  if (user.app_metadata?.signupVerificationFlow === appFlowMarker) return false;
  const providers = [
    ...(user.identities ?? []).map((identity) => identity?.provider),
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    user.app_metadata?.provider,
  ].filter((provider) => provider !== undefined && provider !== null);
  return providers.every((provider) => provider === "email");
}

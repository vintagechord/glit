import type { SupabaseClient } from "@supabase/supabase-js";

/** How a member signs in, as administrators read it. Supabase stores Naver
 * (custom OIDC) as "custom:naver". */
export const SIGN_IN_METHOD_LABELS: Record<string, string> = {
  email: "이메일",
  "custom:naver": "네이버",
  naver: "네이버",
  kakao: "카카오",
  google: "구글",
};

/** Bauhaus palette, black border, readable contrast (no pastels). */
export const SIGN_IN_METHOD_TONES: Record<string, string> = {
  email: "bg-[#111111] text-white",
  "custom:naver": "bg-[#1f8a4c] text-white",
  naver: "bg-[#1f8a4c] text-white",
  kakao: "bg-[#f2cf27] text-[#111111]",
  google: "bg-[#1556a4] text-white",
};

export const signInMethodLabel = (provider: string | null | undefined) =>
  provider ? SIGN_IN_METHOD_LABELS[provider] ?? provider : "확인 불가";

export type MemberAccount = {
  userId: string;
  email: string | null;
  /** The method the account was created with. */
  signupProvider: string | null;
  /** Every linked sign-in method, sign-up method first. */
  providers: string[];
};

type AccountRow = { user_id?: unknown; email?: unknown; signup_provider?: unknown; providers?: unknown };

/** Emails and sign-in methods for up to 200 members. Falls back to emails
 * only when the sign-in method function is not deployed yet. */
export async function loadMemberAccounts(db: Pick<SupabaseClient, "rpc">, userIds: string[]) {
  const ids = [...new Set(userIds)].slice(0, 200);
  const accounts = new Map<string, MemberAccount>();
  if (!ids.length) return { accounts, error: null as string | null, methodsUnavailable: false };
  const { data, error } = await db.rpc("admin_auth_user_accounts", { p_user_ids: ids });
  if (!error) {
    for (const row of (data ?? []) as AccountRow[]) {
      const userId = String(row.user_id ?? "");
      if (!userId) continue;
      const providers = Array.isArray(row.providers) ? row.providers.map(String).filter(Boolean) : [];
      const signupProvider = typeof row.signup_provider === "string" && row.signup_provider ? row.signup_provider : providers[0] ?? null;
      accounts.set(userId, { userId, email: typeof row.email === "string" ? row.email : null, signupProvider, providers });
    }
    return { accounts, error: null, methodsUnavailable: false };
  }
  const fallback = await db.rpc("admin_auth_user_emails", { p_user_ids: ids });
  if (fallback.error) return { accounts, error: fallback.error.message, methodsUnavailable: true };
  for (const row of (fallback.data ?? []) as AccountRow[]) {
    const userId = String(row.user_id ?? "");
    if (userId) accounts.set(userId, { userId, email: typeof row.email === "string" ? row.email : null, signupProvider: null, providers: [] });
  }
  return { accounts, error: null, methodsUnavailable: true };
}

type AuthUserLike = {
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
  identities?: Array<{ provider?: unknown; created_at?: unknown }> | null;
} | null | undefined;

/** The same reading for one Auth user object (admin getUserById), matching
 * the SQL function: earliest identity first, app metadata as the fallback. */
export function memberSignInFromAuthUser(user: AuthUserLike): Pick<MemberAccount, "signupProvider" | "providers"> {
  if (!user) return { signupProvider: null, providers: [] };
  const identities = (user.identities ?? [])
    .filter((identity) => typeof identity?.provider === "string" && identity.provider)
    .map((identity) => ({ provider: String(identity.provider), at: Date.parse(String(identity.created_at ?? "")) }))
    .sort((a, b) => (Number.isFinite(a.at) ? a.at : Infinity) - (Number.isFinite(b.at) ? b.at : Infinity) || a.provider.localeCompare(b.provider));
  const fromIdentities = [...new Set(identities.map((identity) => identity.provider))];
  const appProviders = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers.map(String).filter(Boolean) : [];
  const appProvider = typeof user.app_metadata?.provider === "string" && user.app_metadata.provider ? user.app_metadata.provider : null;
  const providers = fromIdentities.length ? fromIdentities : [...new Set([...(appProvider ? [appProvider] : []), ...appProviders])];
  return { signupProvider: fromIdentities[0] ?? appProvider ?? providers[0] ?? null, providers };
}

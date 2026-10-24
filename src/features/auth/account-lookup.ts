import "server-only";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { getServiceRoleKey, getSupabaseEnv } from "@/lib/supabase/env";

export const SIGNUP_VERIFICATION_FLOW = "email_password_v1";
export type AccountLookup = { id: string; email: string; email_confirmed_at?: string | null; signupVerificationFlow?: string };

/** Read-only lookup: never issue a recovery token just to check an account. */
export async function findAccountByEmail(email: string): Promise<AccountLookup | null> {
  const { url } = getSupabaseEnv();
  const key = getServiceRoleKey();
  const normalized = email.trim().toLowerCase();
  // GoTrue's admin endpoint supports filter; the JS SDK's listUsers wrapper
  // currently only exposes pagination. Treat filter results as candidates.
  // https://github.com/supabase/auth/blob/master/internal/api/admin.go
  for (let page = 1; page <= 5; page += 1) {
    const endpoint = new URL(`${url}/auth/v1/admin/users`);
    endpoint.searchParams.set("filter", normalized);
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("per_page", "100");
    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      redirect: "error",
    }, 10_000);
    if (!response.ok) throw Object.assign(new Error("Account lookup unavailable"), { status: response.status });
    const payload = await response.json() as { users?: Array<AccountLookup & { app_metadata?: { signupVerificationFlow?: unknown } }> };
    if (!Array.isArray(payload.users)) throw new Error("Invalid account lookup response");
    const account = payload.users.find((user) => typeof user.email === "string" && user.email.trim().toLowerCase() === normalized);
    if (account && typeof account.id === "string") {
      return { id: account.id, email: account.email, email_confirmed_at: account.email_confirmed_at,
        ...(account.app_metadata?.signupVerificationFlow === SIGNUP_VERIFICATION_FLOW ? { signupVerificationFlow: SIGNUP_VERIFICATION_FLOW } : {}),
      };
    }
    if (payload.users.length < 100) return null;
  }
  // Fail closed if the filter is unavailable/too broad. Do not treat a
  // truncated lookup as proof that an account does not exist.
  throw new Error("Account lookup result limit exceeded");
}

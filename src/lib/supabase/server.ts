import { createServerClient } from "@supabase/ssr";
import { AuthError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { requiresSocialSignupCompletion } from "@/features/auth/social-contract";

import { getSupabaseEnv } from "./env";

export async function createServerSupabase({
  allowIncompleteSocialSignup = false,
  appendPkceFlowIdToRedirects = false,
}: {
  allowIncompleteSocialSignup?: boolean;
  appendPkceFlowIdToRedirects?: boolean;
} = {}) {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    global: { fetch: fetchWithTimeout },
    ...(appendPkceFlowIdToRedirects ? {
      auth: { experimental: { appendPkceFlowIdToRedirects: true } },
    } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set({ name, value, ...options });
          });
        } catch {
          // Server Components cannot always mutate cookies.
        }
      },
    },
  });

  if (!allowIncompleteSocialSignup) {
    const getVerifiedUser = supabase.auth.getUser.bind(supabase.auth);
    supabase.auth.getUser = async (...args) => {
      const result = await getVerifiedUser(...args);
      if (!result.error && result.data.user && requiresSocialSignupCompletion(result.data.user)) {
        return {
          data: { user: null },
          error: new AuthError("회원가입 동의를 완료해주세요.", 403, "social_signup_incomplete"),
        };
      }
      return result;
    };
  }
  return supabase;
}

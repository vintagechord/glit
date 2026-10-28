import { getBaseUrl } from "@/lib/url";
import { requiresSocialSignupCompletion } from "@/features/auth/social-contract";
import { createSocialCallbackClient, ensureSocialProfile } from "@/features/auth/social-callback";
import { consumeSocialLinkIntent } from "@/features/auth/social-link";
import { isSocialPrefetch, socialLoginError, socialNavigation, socialNoContent, socialProfileResult, socialRedirect } from "@/features/auth/social-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const HEAD = socialNoContent;

export async function GET(request: Request) {
  if (isSocialPrefetch(request)) return socialNoContent();
  const search = new URL(request.url).searchParams;
  const navigation = socialNavigation(search);
  const linking = search.get("flow") === "link";
  const intent = linking ? await consumeSocialLinkIntent(search.get("intent")) : null;
  const english = intent?.english ?? navigation.english;
  const fail = (error: "cancelled" | "expired" | "failed" | "profile") => linking
    ? socialProfileResult(english, error === "expired" ? "link-expired" : "link-failed")
    : socialLoginError(error, english, navigation.next);
  // Cancellation and malformed callbacks never exchange or sign out a session.
  if (search.has("error") || search.has("error_code")) {
    return linking && search.get("error_code") === "identity_already_exists"
      ? socialProfileResult(english, "link-conflict") : fail("cancelled");
  }
  const code = search.get("code");
  const flowId = search.get("sb_flow_id");
  if (!code || !/^[A-Za-z0-9_-]{1,2048}$/.test(code) || !flowId || !/^[A-Za-z0-9_-]{1,200}$/.test(flowId) ||
    (!linking && search.get("flow") !== "social") || (linking && (!intent || intent.flowId !== flowId))) return fail("expired");
  try {
    const { supabase, commit } = await createSocialCallbackClient();
    if (intent) {
      const { data: { user }, error } = await supabase.auth.getUser();
      // getUser can rotate the existing session. Keep that legitimate refresh
      // even if the separate linking exchange below fails or changes accounts.
      commit();
      if (error || !user || user.id !== intent.userId || requiresSocialSignupCompletion(user)) return fail("expired");
    }
    const { data, error } = await supabase.auth.exchangeCodeForSession(code, { flowId });
    if (error || !data.user || !data.session) return fail("expired");
    if (intent && data.user.id !== intent.userId) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      return socialProfileResult(english, "link-conflict");
    }
    if (!(await ensureSocialProfile(supabase, data.user))) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      return fail("profile");
    }
    commit();
    if (intent) return socialProfileResult(english);
    if (requiresSocialSignupCompletion(data.user)) {
      const completion = new URL(`${english ? "/en" : ""}/complete-signup`, getBaseUrl());
      completion.searchParams.set("next", navigation.next);
      return socialRedirect(completion);
    }
    return socialRedirect(new URL(navigation.next, getBaseUrl()));
  } catch { return fail("failed"); }
}

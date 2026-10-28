import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getAuthReturnPath } from "./navigation";
import { isSocialAuthorizeUrl, type SocialProvider } from "./social-contract";

export const socialProviderOptions = (provider: SocialProvider) => provider.id === "kakao"
  // Singular scope replaces GoTrue's default profile-photo scope.
  ? { queryParams: { scope: "profile_nickname" } }
  : {};

export async function prepareSocialSignIn(provider: SocialProvider, next: string, english: boolean, origin: string) {
  const { url } = getSupabaseEnv();
  const supabase = await createServerSupabase({ appendPkceFlowIdToRedirects: true, allowIncompleteSocialSignup: true });
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("flow", "social");
  callback.searchParams.set("next", getAuthReturnPath(next, english) ?? `${english ? "/en" : ""}/mypage`);
  if (english) callback.searchParams.set("locale", "en");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.provider,
    options: { redirectTo: callback.toString(), skipBrowserRedirect: true, ...socialProviderOptions(provider) },
  });
  return !error && data.url && isSocialAuthorizeUrl(data.url, url, provider.provider) ? data.url : null;
}

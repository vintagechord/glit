import { getSocialProvider, isSocialLinkAuthorizeUrl, requiresSocialSignupCompletion } from "@/features/auth/social-contract";
import { getSocialAvailability } from "@/features/auth/social";
import { socialProviderOptions } from "@/features/auth/social-launch";
import { createSocialLinkToken, saveSocialLinkIntent } from "@/features/auth/social-link";
import { socialLoginError, socialNavigation, socialProfileResult, socialRedirect, socialResponseHeaders } from "@/features/auth/social-http";
import { createServerSupabase } from "@/lib/supabase/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { readBoundedBodyBytes } from "@/lib/request-body";
import { getBaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const origin = getBaseUrl();
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return new Response(null, { status: 403, headers: socialResponseHeaders });
  }
  // Native forms send only two small fields; don't accept arbitrary upload bodies.
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) {
    return new Response(null, { status: 400, headers: socialResponseHeaders });
  }
  const body = await readBoundedBodyBytes(request, 8192);
  if (!body.ok) return new Response(null, { status: body.reason === "too_large" ? 413 : 400, headers: socialResponseHeaders });
  const text = new TextDecoder().decode(body.bytes);
  const { english, next } = socialNavigation(new URLSearchParams(text));
  const provider = getSocialProvider((await context.params).provider);
  if (!provider) return socialProfileResult(english, "link-unavailable");
  try {
    const supabase = await createServerSupabase({ appendPkceFlowIdToRedirects: true });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user || requiresSocialSignupCompletion(user)) return socialLoginError("expired", english, next);
    const limited = consumeRateLimit({ namespace: "social-identity-link", identifier: user.id, limit: 10, windowMs: 600_000 });
    if (!limited.allowed || !(await getSocialAvailability())[provider.id]) return socialProfileResult(english, "link-unavailable");
    const token = createSocialLinkToken();
    const callback = new URL("/auth/callback", origin);
    callback.searchParams.set("flow", "link");
    callback.searchParams.set("intent", token);
    if (english) callback.searchParams.set("locale", "en");
    const { data, error: linkError } = await supabase.auth.linkIdentity({ provider: provider.provider, options: {
      redirectTo: callback.toString(), skipBrowserRedirect: true, ...socialProviderOptions(provider),
    } });
    if (linkError || !data.url || !data.flowId) {
      return socialProfileResult(english, linkError?.code === "manual_linking_disabled" ? "link-unavailable" : linkError?.code === "identity_already_exists" ? "link-conflict" : "link-failed");
    }
    if (!isSocialLinkAuthorizeUrl(data.url, getSupabaseEnv().url, provider.id)) return socialProfileResult(english, "link-failed");
    await saveSocialLinkIntent({ userId: user.id, provider: provider.id, token, flowId: data.flowId, english });
    return socialRedirect(data.url);
  } catch { return socialProfileResult(english, "link-failed"); }
}

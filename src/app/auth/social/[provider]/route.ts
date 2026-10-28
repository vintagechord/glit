import { getSocialProvider } from "@/features/auth/social-contract";
import { getSocialAvailability } from "@/features/auth/social";
import { prepareSocialSignIn } from "@/features/auth/social-launch";
import { isSocialPrefetch, socialLoginError, socialNavigation, socialNoContent, socialRedirect } from "@/features/auth/social-http";
import { getBaseUrl } from "@/lib/url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const HEAD = socialNoContent;

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  if (isSocialPrefetch(request)) return socialNoContent();
  const url = new URL(request.url);
  const { english, next } = socialNavigation(url.searchParams);
  const provider = getSocialProvider((await context.params).provider);
  if (!provider) return socialLoginError("unavailable", english, next);
  const origin = getBaseUrl();
  if (url.origin !== origin) {
    const canonical = new URL(`/auth/social/${provider.id}`, origin);
    canonical.searchParams.set("next", next);
    if (english) canonical.searchParams.set("locale", "en");
    return socialRedirect(canonical);
  }
  try {
    if (!(await getSocialAvailability())[provider.id]) return socialLoginError("unavailable", english, next);
    const destination = await prepareSocialSignIn(provider, next, english, origin);
    return destination ? socialRedirect(destination) : socialLoginError("failed", english, next);
  } catch { return socialLoginError("failed", english, next); }
}

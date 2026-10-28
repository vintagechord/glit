import type { User } from "@supabase/supabase-js";

export const socialProviders = [
  { id: "google", provider: "google", label: "Google" },
  { id: "naver", provider: "custom:naver", label: "네이버" },
  { id: "kakao", provider: "kakao", label: "카카오" },
] as const;

export type SocialProvider = (typeof socialProviders)[number];
export type SocialProviderId = SocialProvider["id"];
export type SocialAvailability = Record<SocialProviderId, boolean>;
export const emptySocialAvailability = (): SocialAvailability => ({ google: false, naver: false, kakao: false });
export const getSocialProvider = (value: string) => socialProviders.find(provider => provider.id === value) ?? null;

type ConsentUser = Pick<User, "app_metadata"> & Partial<Pick<User, "identities">>;

export function hasRequiredSignupConsent(user: ConsentUser | null | undefined) {
  const consent = user?.app_metadata?.signupConsent;
  return Boolean(consent && typeof consent === "object" &&
    consent.age14OrOlder === true && consent.terms === true && consent.privacy === true && consent.refund === true &&
    typeof consent.acceptedAt === "string" && Number.isFinite(Date.parse(consent.acceptedAt)));
}

export function requiresSocialSignupCompletion(user: ConsentUser | null | undefined) {
  if (!user || hasRequiredSignupConsent(user)) return false;
  const providers = new Set([
    ...(user.identities ?? []).map(identity => identity.provider),
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    user.app_metadata?.provider,
  ]);
  // Existing email members predate recorded consent. Native verified-email
  // linking must not turn those accounts into new, unfinished registrations.
  if (providers.has("email")) return false;
  return socialProviders.some(provider => providers.has(provider.provider));
}

export function socialDisplayName(user: Pick<User, "user_metadata">) {
  for (const key of ["name", "full_name", "display_name", "nickname", "preferred_username"]) {
    const value = user.user_metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 100);
  }
  return "";
}

export function isSocialAuthorizeUrl(value: string, authOrigin: string, provider: SocialProvider["provider"]) {
  try {
    const url = new URL(value);
    return url.origin === new URL(authOrigin).origin && !url.username && !url.password &&
      !url.hash && url.pathname === "/auth/v1/authorize" && url.searchParams.getAll("provider").length === 1 && url.searchParams.get("provider") === provider &&
      url.searchParams.getAll("code_challenge_method").length === 1 && url.searchParams.getAll("code_challenge").length === 1 &&
      url.searchParams.get("code_challenge_method") === "s256" &&
      /^[A-Za-z0-9_-]{43,128}$/.test(url.searchParams.get("code_challenge") ?? "");
  } catch { return false; }
}

export function isSocialLinkAuthorizeUrl(value: string, authOrigin: string, provider: SocialProviderId) {
  const allowed = {
    google: { origin: "https://accounts.google.com", paths: ["/o/oauth2/v2/auth", "/o/oauth2/auth"] },
    naver: { origin: "https://nid.naver.com", paths: ["/oauth2/authorize"] },
    kakao: { origin: "https://kauth.kakao.com", paths: ["/oauth/authorize"] },
  } as const;
  try {
    const url = new URL(value);
    const { origin, paths } = allowed[provider];
    const callback = new URL("/auth/v1/callback", authOrigin).toString();
    return url.origin === origin && (paths as readonly string[]).includes(url.pathname) && !url.username && !url.password && !url.hash &&
      url.searchParams.getAll("redirect_uri").length === 1 && url.searchParams.get("redirect_uri") === callback &&
      url.searchParams.getAll("state").length === 1 && Boolean(url.searchParams.get("state"));
  } catch { return false; }
}

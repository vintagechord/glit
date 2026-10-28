import "server-only";
import { getBaseUrl } from "@/lib/url";
import { getAuthReturnPath } from "./navigation";

export const socialResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export function socialRedirect(destination: string | URL) {
  return new Response(null, { status: 303, headers: { ...socialResponseHeaders, Location: destination.toString() } });
}

export const socialNoContent = () => new Response(null, { status: 204, headers: socialResponseHeaders });
export const isSocialPrefetch = (request: Request) => request.headers.get("purpose") === "prefetch" || request.headers.get("sec-purpose")?.includes("prefetch") || request.headers.has("next-router-prefetch");

export function socialNavigation(search: URLSearchParams) {
  const english = search.get("locale") === "en";
  const next = getAuthReturnPath(search.get("next"), english) ?? `${english ? "/en" : ""}/mypage`;
  return { english, next };
}

export function socialLoginError(error: "cancelled" | "expired" | "unavailable" | "failed" | "profile", english: boolean, next: string) {
  const url = new URL(`${english ? "/en" : ""}/login`, getBaseUrl());
  url.searchParams.set("social_error", error);
  url.searchParams.set("next", getAuthReturnPath(next, english) ?? `${english ? "/en" : ""}/mypage`);
  return socialRedirect(url);
}

export function socialProfileResult(english: boolean, error?: "link-unavailable" | "link-failed" | "link-expired" | "link-conflict") {
  const url = new URL(`${english ? "/en" : ""}/mypage/profile`, getBaseUrl());
  url.searchParams.set(error ? "social_error" : "social_link", error ?? "success");
  return socialRedirect(url);
}

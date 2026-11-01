/**
 * Signed-in members opening the lookup chooser belong on their dashboard. An
 * explicit guest-code lookup (`?mode=guest`) stays, since a member may still
 * have an earlier guest application. Applied by the proxy so /track itself
 * can be served from the CDN.
 */
export function trackMemberRedirectPath(pathname: string, search: URLSearchParams): string | null {
  if (pathname !== "/track" && pathname !== "/en/track") return null;
  if (search.get("mode") === "guest") return null;
  return pathname === "/en/track" ? "/en/dashboard" : "/dashboard";
}

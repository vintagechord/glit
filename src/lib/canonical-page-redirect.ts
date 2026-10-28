const LEGACY_HOST = "glit-b1yn.onrender.com";

const pagePaths = new Set([
  "/", "/about", "/guide", "/forms", "/faq", "/support", "/studio",
  "/login", "/signup", "/forgot-password", "/confirm-email", "/reset-password",
  "/complete-signup", "/privacy", "/terms", "/subscription", "/karaoke-request",
]);
const pageTrees = ["/admin", "/dashboard", "/mypage", "/track", "/submissions", "/magazine", "/apply"];
const paymentResults = new Set(["success", "fail", "cancel", "error"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLegacyPaymentReceipt(pagePath: string, search: URLSearchParams): boolean {
  const payment = search.getAll("payment");
  if (payment.length !== 1 || !paymentResults.has(payment[0])) return false;
  if (pagePath === "/mypage/orders") {
    const focus = search.getAll("focus");
    return focus.length === 1 && uuidPattern.test(focus[0]);
  }
  if (pagePath.startsWith("/dashboard/submissions/")) {
    return uuidPattern.test(pagePath.slice("/dashboard/submissions/".length));
  }
  if (/^\/track\/[a-z0-9_-]{8,120}$/i.test(pagePath)) return true;
  if (pagePath === "/karaoke-request") {
    const requestId = search.getAll("requestId");
    return requestId.length === 0 || (requestId.length === 1 && uuidPattern.test(requestId[0]));
  }
  return false;
}

type PageRequest = {
  method: string;
  host: string | null;
  pathname: string;
  search: string;
};

/** Move old browser entry pages while keeping actions, callbacks and workers on their original host. */
export function getCanonicalPageRedirect(request: PageRequest, configuredOrigin: string): URL | null {
  if ((request.method !== "GET" && request.method !== "HEAD") ||
      request.host?.toLowerCase() !== LEGACY_HOST) return null;

  let destination: URL;
  try { destination = new URL(configuredOrigin); } catch { return null; }
  if (destination.protocol !== "https:" || destination.username || destination.password ||
      destination.host === LEGACY_HOST) return null;

  const pagePath = request.pathname === "/en" ? "/" : request.pathname.replace(/^\/en(?=\/)/, "");
  const normalizedPagePath = pagePath.length > 1 ? pagePath.replace(/\/$/, "") : pagePath;
  if (!pagePaths.has(normalizedPagePath) &&
      !pageTrees.some((tree) => normalizedPagePath === tree || normalizedPagePath.startsWith(`${tree}/`))) return null;

  // Assign separately so a path can never replace the configured origin.
  destination.pathname = request.pathname;
  if (destination.pathname !== request.pathname) return null;
  destination.search = request.search;
  // An in-flight legacy checkout must reach its receipt with the original
  // host's session/grant cookies. This query is only a migration hint: returning
  // null leaves all existing proxy and page authorization checks in place.
  if (isLegacyPaymentReceipt(normalizedPagePath, destination.searchParams)) return null;
  // Fragments never reach the server. Leaving Location without one lets the
  // browser retain the original fragment, including legacy recovery links.
  destination.hash = "";
  return destination;
}

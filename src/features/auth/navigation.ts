import { getSafeInternalPath } from "@/lib/safe-internal-path";

export function getAuthReturnPath(value: string | null | undefined, english = false) {
  const safe = getSafeInternalPath(value);
  if (!safe || safe.length > 2048) return null;
  const url = new URL(safe, "https://onside-internal.invalid");
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { return null; }
  if (decodedPath.startsWith("//") || decodedPath.includes("\\") || /[\u0000-\u001f\u007f]/.test(decodedPath)) return null;
  const decodedWithoutLocale = decodedPath.replace(/^\/en(?=\/|$)/, "") || "/";
  if (/^\/(auth|login|signup|complete-signup|forgot-password|reset-password|find-id|confirm-email)(\/|$)/.test(decodedWithoutLocale)) return null;
  const pathname = url.pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  // These destinations have locale aliases. Keep the draft/cart query and hash
  // intact while allowing a language switch on an authentication screen.
  if (/^\/(dashboard|mypage|track)(\/|$)/.test(pathname)) {
    return `${english ? "/en" : ""}${pathname}${url.search}${url.hash}`;
  }
  return safe;
}

export function getAuthPageHref(page: "login" | "signup" | "forgot-password" | "reset-password" | "confirm-email", nextPath?: string | null, english = false, signupSuccess = false) {
  const query = new URLSearchParams();
  const next = getAuthReturnPath(nextPath, english);
  if (next) query.set("next", next);
  if (signupSuccess) query.set("signup", "success");
  return `${english ? "/en" : ""}/${page}${query.size ? `?${query}` : ""}`;
}

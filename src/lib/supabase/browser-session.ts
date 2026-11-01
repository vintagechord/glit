// Supabase SSR keeps the session in script-readable cookies named
// sb-<project-ref>-auth-token (split into .0, .1 … when large). The PKCE
// verifier cookie (…-auth-token-code-verifier) is not a session.
const AUTH_COOKIE = /(?:^|;\s*)sb-[a-z0-9]+-auth-token(?:\.\d+)?=/i;

/** Whether this browser holds a Supabase session cookie, without loading the SDK. */
export function hasBrowserAuthCookie(
  cookie = typeof document === "undefined" ? "" : document.cookie,
) {
  return AUTH_COOKIE.test(cookie);
}

type BrowserSupabase = ReturnType<typeof import("@/lib/supabase/client")["createClient"]>;
let browserSupabase: Promise<BrowserSupabase> | null = null;

/**
 * Loads the Supabase browser SDK on first use, so guests (no session cookie)
 * never download or parse it. The SDK itself keeps one client per page.
 */
export function loadBrowserSupabase() {
  browserSupabase ??= import("@/lib/supabase/client").then(({ createClient }) => createClient());
  browserSupabase.catch(() => {
    browserSupabase = null;
  });
  return browserSupabase;
}

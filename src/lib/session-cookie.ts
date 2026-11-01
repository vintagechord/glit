// Supabase SSR keeps the session in script-readable cookies named
// sb-<project-ref>-auth-token (split into .0, .1 … when large). The PKCE
// verifier cookie (…-auth-token-code-verifier) is not a session.
export const SESSION_COOKIE_SOURCE = String.raw`(?:^|;\s*)sb-[a-z0-9]+-auth-token(?:\.\d+)?=`;

/**
 * Runs inline at the top of <body>, before anything below it is painted.
 * Static pages cannot know the visitor, so this flag lets CSS choose the
 * signed-in or guest first paint (see [data-home-panel] in globals.css).
 */
export const SESSION_COOKIE_FLAG_SCRIPT =
  `(function(){try{if(/${SESSION_COOKIE_SOURCE}/i.test(document.cookie))document.documentElement.setAttribute("data-session","1")}catch(e){}})();`;

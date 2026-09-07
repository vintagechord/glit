import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "./env";

export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  const isRecoveryPage = typeof window !== "undefined" && /^\/(?:en\/)?reset-password\/?$/.test(window.location.pathname);
  return createBrowserClient(url, anonKey, {
    // The recovery screen exchanges links explicitly and displays its own
    // errors. Automatic detection would race it and consume one-time tokens.
    auth: { detectSessionInUrl: !isRecoveryPage },
  });
}

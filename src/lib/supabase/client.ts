import { createBrowserClient } from "@supabase/ssr";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

import { getSupabaseEnv } from "./env";

export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient(url, anonKey, {
    global: { fetch: fetchWithTimeout },
    // All recovery credentials are exchanged by the recovery screen. Keep
    // this fixed for the shared browser singleton: its first caller can be a
    // layout on another route, and later client options would be ignored.
    auth: { detectSessionInUrl: false },
  });
}

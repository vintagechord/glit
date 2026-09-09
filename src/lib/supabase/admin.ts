import { createClient, type SupabaseClientOptions } from "@supabase/supabase-js";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

import { getServiceRoleKey, getSupabaseEnv } from "./env";

type AdminClientOptions = SupabaseClientOptions<"public">;

export function createAdminClient(options?: AdminClientOptions) {
  const { url } = getSupabaseEnv();
  const serviceKey = getServiceRoleKey();

  return createClient(url, serviceKey, {
    ...options,
    global: {
      ...options?.global,
      fetch: (input, init) => fetchWithTimeout(input, init, 20_000, options?.global?.fetch),
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      ...options?.auth,
    },
  });
}

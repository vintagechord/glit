import { createClient, type SupabaseClientOptions } from "@supabase/supabase-js";

import { getServiceRoleKey, getSupabaseEnv } from "./env";

type AdminClientOptions = SupabaseClientOptions<"public">;

export function createAdminClient(options?: AdminClientOptions) {
  const { url } = getSupabaseEnv();
  const serviceKey = getServiceRoleKey();

  return createClient(url, serviceKey, {
    ...options,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      ...options?.auth,
    },
  });
}

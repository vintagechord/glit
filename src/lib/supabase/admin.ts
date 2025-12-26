import { createClient } from "@supabase/supabase-js";

import { getServiceRoleKey, getSupabaseEnv } from "./env";

export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const serviceKey = getServiceRoleKey();

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

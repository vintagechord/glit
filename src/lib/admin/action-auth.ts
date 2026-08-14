import type { User } from "@supabase/supabase-js";

import { requireAdminForApi } from "@/lib/admin/api-auth";

/**
 * Authorize a privileged Server Action before it creates a service-role client
 * or performs any other side effect. Server Actions are public HTTP endpoints;
 * page/proxy authorization alone is not a security boundary.
 */
export async function requireAdminAction(): Promise<User> {
  const auth = await requireAdminForApi();
  if (!auth.ok) {
    throw new Error(auth.error);
  }
  return auth.user;
}

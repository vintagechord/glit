import { redirect } from "next/navigation";

import { requireAdminForApi } from "@/lib/admin/api-auth";

/**
 * Authorize a server-rendered admin page before it creates a service-role
 * client. Layouts and proxy checks are useful UX guards, but data access must
 * retain its own authorization boundary.
 */
export async function requireAdminPage() {
  const auth = await requireAdminForApi();
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login?next=%2Fadmin" : "/dashboard");
  }
  return auth.user;
}

import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { requireAdminForApi } from "@/lib/admin/api-auth";

export default async function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const auth = await requireAdminForApi();

  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login?next=%2Fadmin" : "/dashboard");
  }

  return children;
}

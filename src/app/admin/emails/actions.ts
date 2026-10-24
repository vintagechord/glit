"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function retryEmailAction(form: FormData) {
  const auth = await requireAdminForApi();
  if (!auth.ok) throw new Error(auth.error);
  const parsed = z.string().uuid().safeParse(form.get("id"));
  if (!parsed.success) redirect("/admin/emails?notice=invalid");
  const allowUncertain = form.get("allowUncertain") === "on";
  const db = createAdminClient();
  let failed = true;
  try {
    const result = await db.rpc("retry_email_outbox", { p_id: parsed.data, p_allow_uncertain: allowUncertain });
    failed = Boolean(result.error);
  } catch {
    // Keep the error category in the UI; do not expose SQL/provider details.
  }
  revalidatePath("/admin/emails");
  redirect(`/admin/emails?notice=${failed ? "failed" : "queued"}`);
}

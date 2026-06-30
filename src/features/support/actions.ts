"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

const statusSchema = z.object({
  inquiryId: z.string().uuid(),
  status: z.enum(["NEW", "REVIEWING", "ANSWERED", "CLOSED"]),
  adminMemo: z.string().trim().max(2000).optional(),
});

async function requireAdmin() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/inquiries");
  }

  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error) {
    console.error("[support-inquiries][action] admin check failed", error);
  }

  if (isAdmin !== true) {
    redirect("/");
  }
}

export async function updateSupportInquiryFormAction(formData: FormData) {
  await requireAdmin();

  const parsed = statusSchema.safeParse({
    inquiryId: String(formData.get("inquiryId") ?? ""),
    status: String(formData.get("status") ?? ""),
    adminMemo: String(formData.get("adminMemo") ?? ""),
  });

  if (!parsed.success) {
    redirect("/admin/inquiries?error=invalid");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("support_inquiries")
    .update({
      status: parsed.data.status,
      admin_memo: parsed.data.adminMemo || null,
    })
    .eq("id", parsed.data.inquiryId);

  if (error) {
    console.error("[support-inquiries][action] update failed", error);
    redirect("/admin/inquiries?error=save_failed");
  }

  redirect("/admin/inquiries?saved=1");
}

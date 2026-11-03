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

/** Saving keeps the admin on the filtered page they were reading. */
const safeInquiriesReturnPath = (value: FormDataEntryValue | null) => {
  const raw = typeof value === "string" ? value.trim() : "";
  try {
    const url = new URL(raw || "/admin/inquiries", "https://onside.local");
    if (url.origin !== "https://onside.local" || url.pathname !== "/admin/inquiries") return "/admin/inquiries";
    const params = new URLSearchParams();
    for (const key of ["status", "page"]) {
      const param = url.searchParams.get(key);
      if (param && /^[A-Z0-9_]{1,20}$/.test(param)) params.set(key, param);
    }
    const query = params.toString();
    return query ? `/admin/inquiries?${query}` : "/admin/inquiries";
  } catch {
    return "/admin/inquiries";
  }
};

const withFlag = (path: string, key: "saved" | "error", value: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

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

  const returnPath = safeInquiriesReturnPath(formData.get("returnTo"));
  if (!parsed.success) {
    redirect(withFlag(returnPath, "error", "invalid"));
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
    redirect(withFlag(returnPath, "error", "save_failed"));
  }

  redirect(withFlag(returnPath, "saved", "1"));
}

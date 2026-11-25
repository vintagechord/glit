"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminAction } from "@/lib/admin/action-auth";
import { CUSTOMER_CONTACTED_EVENT } from "@/lib/admin/unread-customer-mail";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 연락 완료 on 메일 미확인 고객: staff reached the customer another way. The
 * application leaves the list until a newer mail goes unread for 3 days.
 */
export async function markCustomerContactedAction(form: FormData): Promise<void> {
  const admin = await requireAdminAction();
  const submissionId = z.string().uuid().safeParse(form.get("submissionId"));
  if (!submissionId.success) redirect("/admin?contact=error#unread-mail");
  const { error } = await createAdminClient().from("submission_events").insert({
    submission_id: submissionId.data,
    actor_user_id: admin.id,
    event_type: CUSTOMER_CONTACTED_EVENT,
    message: "메일 미확인 고객에게 관리자가 직접 연락했습니다.",
  });
  revalidatePath("/admin");
  redirect(error ? "/admin?contact=error#unread-mail" : "/admin?contact=saved#unread-mail");
}

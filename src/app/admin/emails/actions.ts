"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAdminSubmissionDetailPath } from "@/lib/admin/submission-navigation";

export async function retryEmailAction(form: FormData) {
  const auth = await requireAdminForApi();
  if (!auth.ok) throw new Error(auth.error);
  const parsed = z.string().uuid().safeParse(form.get("id"));
  // A retry from a submission's detail page returns there; the email list
  // on that page shows only that submission's customer mail.
  const submission = z.string().uuid().safeParse(form.get("submissionId"));
  const backToSubmission = (state: Record<string, string>) => `${buildAdminSubmissionDetailPath({
    submissionId: submission.success ? submission.data : "", returnTo: String(form.get("returnTo") ?? ""), state,
  })}#customer-emails`;
  if (!parsed.success) redirect(submission.success ? backToSubmission({ saved: "error", savedError: "재발송할 메일을 확인해주세요." }) : "/admin/emails?notice=invalid");
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
  if (submission.success) {
    revalidatePath(`/admin/submissions/${submission.data}`);
    redirect(backToSubmission(failed
      ? { saved: "error", savedError: "재발송을 등록하지 못했습니다. 현재 상태와 유효 기간을 확인해주세요." }
      : { saved: "email_retry" }));
  }
  redirect(`/admin/emails?notice=${failed ? "failed" : "queued"}`);
}

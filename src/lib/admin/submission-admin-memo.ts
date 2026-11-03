import type { createAdminClient } from "@/lib/supabase/admin";

type Db = Pick<ReturnType<typeof createAdminClient>, "from">;

/** Staff notes live in submission_admin_memos, which only the service role
 * can read. submissions.admin_memo is kept for old RPCs but is always null
 * (20261103160000_submission_admin_memos.sql), so customers never see notes. */
export const SUBMISSION_ADMIN_MEMO_TABLE = "submission_admin_memos";

export const normalizeAdminMemo = (value?: string | null) => value?.trim() || null;

export async function loadSubmissionAdminMemo(db: Db, submissionId: string): Promise<{ memo: string | null; error: boolean }> {
  const { data, error } = await db.from(SUBMISSION_ADMIN_MEMO_TABLE)
    .select("memo")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error) return { memo: null, error: true };
  const memo = (data as { memo?: unknown } | null)?.memo;
  return { memo: typeof memo === "string" ? normalizeAdminMemo(memo) : null, error: false };
}

/** Replaces the whole note, as the admin edit form shows it in full. An empty
 * note removes the row. */
export async function saveSubmissionAdminMemo(db: Db, submissionId: string, memo?: string | null): Promise<{ error: boolean }> {
  const value = normalizeAdminMemo(memo);
  const table = db.from(SUBMISSION_ADMIN_MEMO_TABLE);
  const { error } = value
    ? await table.upsert({ submission_id: submissionId, memo: value, updated_at: new Date().toISOString() }, { onConflict: "submission_id" })
    : await table.delete().eq("submission_id", submissionId);
  return { error: Boolean(error) };
}

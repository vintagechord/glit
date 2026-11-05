import type { SupabaseClient } from "@supabase/supabase-js";

export type UploadRecordItem = {
  id: string;
  name: string | null;
  sizeLabel: string;
  statusLabel: string;
  completed: boolean;
  createdAt: string;
};

export type SubmissionUploadRecord = {
  attempts: number;
  completed: number;
  unfinished: number;
  items: UploadRecordItem[];
  error: boolean;
};

const multipartLabels: Record<string, string> = {
  ACTIVE: "업로드 중 또는 중단",
  COMPLETING: "완료 처리 중",
  COMPLETED: "업로드 완료",
  ABORTING: "중단 정리 중",
  ABORTED: "중단됨",
  FAILED: "실패",
};

const sizeLabel = (bytes: number | null | undefined) => {
  if (!bytes || bytes <= 0) return "크기 미상";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
};

/**
 * Upload requests that reached the server for one application. Every
 * browser upload starts with a grant, so "none" means the customer never
 * started one. Large files use kept multipart grants; small-file grants are
 * purged a day after completion or at expiry.
 */
export async function loadSubmissionUploadRecord(db: SupabaseClient, submissionId: string): Promise<SubmissionUploadRecord> {
  const [multipart, single] = await Promise.all([
    db.from("multipart_upload_grants")
      .select("id, original_name, declared_size_bytes, status, created_at")
      .eq("submission_id", submissionId).order("created_at", { ascending: false }).limit(50),
    db.from("upload_put_grants")
      .select("id, original_name, declared_size_bytes, status, created_at")
      .eq("submission_id", submissionId).order("created_at", { ascending: false }).limit(50),
  ]);
  if (multipart.error || single.error) return { attempts: 0, completed: 0, unfinished: 0, items: [], error: true };

  type GrantRow = { id: string; original_name: string | null; declared_size_bytes: number | null; status: string; created_at: string };
  const items: UploadRecordItem[] = [
    ...((multipart.data ?? []) as GrantRow[]).map((row) => ({
      id: `m-${row.id}`, name: row.original_name, sizeLabel: sizeLabel(row.declared_size_bytes),
      statusLabel: multipartLabels[row.status] ?? row.status, completed: row.status === "COMPLETED", createdAt: row.created_at,
    })),
    ...((single.data ?? []) as GrantRow[]).map((row) => ({
      id: `p-${row.id}`, name: row.original_name, sizeLabel: sizeLabel(row.declared_size_bytes),
      statusLabel: row.status === "COMPLETED" ? "업로드 완료" : "업로드 대기·미완료", completed: row.status === "COMPLETED", createdAt: row.created_at,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const completed = items.filter((item) => item.completed).length;
  return { attempts: items.length, completed, unfinished: items.length - completed, items, error: false };
}

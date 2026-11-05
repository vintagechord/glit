import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerViewRecord = {
  firstViewedAt: string;
  lastViewedAt: string;
  viewCount: number;
  lastDownloadAt: string | null;
  downloadCount: number;
};

type ViewRow = {
  submission_id: string; first_viewed_at: string; last_viewed_at: string;
  view_count: number; last_download_at: string | null; download_count: number;
};

const toRecord = (row: ViewRow): CustomerViewRecord => ({
  firstViewedAt: row.first_viewed_at,
  lastViewedAt: row.last_viewed_at,
  viewCount: Number(row.view_count ?? 0),
  lastDownloadAt: row.last_download_at,
  downloadCount: Number(row.download_count ?? 0),
});

/** The customer's visits to their result page; read after authorizing an administrator. */
export async function loadCustomerViewRecords(db: Pick<SupabaseClient, "from">, submissionIds: string[]) {
  const ids = [...new Set(submissionIds)].slice(0, 200);
  if (!ids.length) return { records: new Map<string, CustomerViewRecord>(), error: false };
  const { data, error } = await db.from("submission_customer_views")
    .select("submission_id, first_viewed_at, last_viewed_at, view_count, last_download_at, download_count")
    .in("submission_id", ids);
  if (error) return { records: new Map<string, CustomerViewRecord>(), error: true };
  return { records: new Map(((data ?? []) as ViewRow[]).map((row) => [row.submission_id, toRecord(row)])), error: false };
}

/** Whether the customer opened the page (or a result file) after the result notice. */
export function viewedAfterNotice(record: CustomerViewRecord | undefined, notifiedAt: string | null | undefined) {
  if (!record || !notifiedAt) return false;
  const notice = Date.parse(notifiedAt);
  return Date.parse(record.lastViewedAt) >= notice || (record.lastDownloadAt ? Date.parse(record.lastDownloadAt) >= notice : false);
}

import { deleteObjectAllVersions, getB2Config } from "@/lib/b2";
import { getStorageLogId } from "@/lib/guest-storage-owner";
export { PURGE_BATCH_LIMIT } from "@/lib/admin/customer-file-purge-limits";
import { isRatingCode } from "@/lib/mv-assets";
import { hasPublishedSubmissionResult } from "@/lib/submission-certificate";
import { parseSubmissionB2ObjectRefs } from "@/lib/submission-file-cleanup";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = Pick<ReturnType<typeof createAdminClient>, "from">;

/** Only files a customer uploaded. Certificates, rating marks, the usage
 * guide and result-email copies live elsewhere and are never touched. */
export const CUSTOMER_FILE_KINDS = ["AUDIO", "VIDEO", "LYRICS", "ETC"] as const;

const FINAL_STATION_STATUSES = new Set(["APPROVED", "REJECTED"]);
const OPEN_SUPPLEMENT_STATUSES = new Set(["OPEN", "SUBMITTED"]);
const FINISHED_SUBMISSION_STATUSES = new Set(["RESULT_READY", "COMPLETED"]);
const PAGE_SIZE = 1000;
const ID_CHUNK = 100;
const DELETE_CONCURRENCY = 4;
// Object keys are long; small batches keep the PostgREST URL well under limits.
const KEY_LOOKUP_CHUNK = 10;

export type PurgeSubmissionRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  type: string | null;
  status: string | null;
  payment_status: string | null;
  result_status: string | null;
  result_notified_at: string | null;
  mv_desired_rating: string | null;
  updated_at: string | null;
};
type ReviewRow = { submission_id: string; status: string | null; updated_at: string | null };
type SupplementFileRow = { id: string; object_key: string | null; size_bytes: number | null; purged_at: string | null };
type SupplementRequestRow = {
  submission_id: string;
  status: string | null;
  revisions?: Array<{ files?: SupplementFileRow[] | null }> | null;
};
type UploadRow = {
  id: string;
  submission_id: string;
  kind: string | null;
  storage_provider: string | null;
  object_key: string | null;
  size: number | null;
  purged_at: string | null;
};

export type PurgeFile = { source: "upload" | "supplement"; id: string; objectKey: string; sizeBytes: number };
export type PurgeCandidate = {
  submissionId: string;
  title: string | null;
  artistName: string | null;
  type: string | null;
  refunded: boolean;
  finishedAt: string | null;
  files: PurgeFile[];
  totalBytes: number;
};
export type PurgeResult = {
  submissionId: string;
  ok: boolean;
  deletedFiles: number;
  failedFiles: number;
  freedBytes: number;
  error?: string;
};

/**
 * When the files stopped being needed, or null while they may still be:
 * unpaid, a supplement request still open, an online music video without a
 * published rating, or any broadcaster result still outstanding (an online
 * music video order can include Mnet/ETN reviews that use the same video).
 * A refund stops the review outright, so a refunded submission always
 * qualifies.
 */
export function reviewFinishedAt(
  submission: PurgeSubmissionRow,
  reviews: ReviewRow[],
  supplementRequests: Pick<SupplementRequestRow, "status">[],
): string | null {
  if (submission.payment_status === "REFUNDED") return submission.updated_at ?? submission.result_notified_at ?? null;
  if (submission.payment_status !== "PAID") return null;
  if (supplementRequests.some((request) => OPEN_SUPPLEMENT_STATUSES.has(request.status ?? ""))) return null;
  if (submission.type === "MV_DISTRIBUTION") {
    if (!isRatingCode(submission.mv_desired_rating) || !hasPublishedSubmissionResult(submission)) return null;
  } else if (!FINISHED_SUBMISSION_STATUSES.has(submission.status ?? "")) {
    return null;
  }
  if (reviews.some((review) => !FINAL_STATION_STATUSES.has(review.status ?? ""))) return null;
  const latestReview = reviews
    .map((review) => review.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  return submission.result_notified_at ?? latestReview ?? submission.updated_at ?? null;
}

const isSupplementKeyOf = (objectKey: string, prefix: string, submissionId: string) => {
  const base = `${prefix.replace(/\/+$/, "")}/supplements/${submissionId}/`;
  return objectKey.startsWith(base) &&
    objectKey.slice(base.length).split("/").every((part) => part && part !== "." && part !== "..");
};

/** Files still stored for one finished submission, in the customer namespaces only. */
export function selectPurgeFiles(
  submissionId: string,
  uploads: UploadRow[],
  supplementFiles: SupplementFileRow[],
  prefix: string,
): PurgeFile[] {
  const live = uploads.filter((row) =>
    row.submission_id === submissionId &&
    !row.purged_at &&
    (CUSTOMER_FILE_KINDS as readonly string[]).includes(row.kind ?? ""));
  const scopedKeys = new Set(parseSubmissionB2ObjectRefs(live, prefix).map((ref) => ref.objectKey));
  return [
    ...live
      .filter((row) => scopedKeys.has(String(row.object_key ?? "").trim()))
      .map((row) => ({ source: "upload" as const, id: row.id, objectKey: String(row.object_key).trim(), sizeBytes: Number(row.size) || 0 })),
    ...supplementFiles
      .filter((row) => !row.purged_at && row.object_key && isSupplementKeyOf(row.object_key, prefix, submissionId))
      .map((row) => ({ source: "supplement" as const, id: row.id, objectKey: String(row.object_key), sizeBytes: Number(row.size_bytes) || 0 })),
  ];
}

const chunk = <T,>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));

async function selectPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "query failed");
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

const submissionColumns =
  "id, title, artist_name, type, status, payment_status, result_status, result_notified_at, mv_desired_rating, updated_at";

/**
 * Finished paid submissions and refunded submissions that still hold
 * customer files, oldest first. Passing ids limits the scan to those
 * submissions (the purge path re-checks with this instead of trusting the
 * browser).
 */
export async function loadPurgeCandidates(db: AdminClient, onlyIds?: string[]): Promise<PurgeCandidate[]> {
  const { prefix } = getB2Config();
  const submissions = await selectPages<PurgeSubmissionRow>((from, to) => {
    let query = db.from("submissions").select(submissionColumns).or(
      "payment_status.eq.REFUNDED,and(payment_status.eq.PAID,or(status.in.(RESULT_READY,COMPLETED),result_status.not.is.null,result_notified_at.not.is.null))",
    );
    if (onlyIds) query = query.in("id", onlyIds);
    return query.order("id").range(from, to);
  });

  const candidates: PurgeCandidate[] = [];
  for (const ids of chunk(submissions.map((row) => row.id), ID_CHUNK)) {
    const [reviews, requests, uploads] = await Promise.all([
      selectPages<ReviewRow>((from, to) =>
        db.from("station_reviews").select("id, submission_id, status, updated_at").in("submission_id", ids).order("id").range(from, to)),
      selectPages<SupplementRequestRow>((from, to) =>
        db.from("submission_supplement_requests")
          .select("id, submission_id, status, revisions:submission_supplement_revisions(files:submission_supplement_files(id, object_key, size_bytes, purged_at))")
          .in("submission_id", ids).order("id").range(from, to)),
      selectPages<UploadRow>((from, to) =>
        db.from("submission_files").select("id, submission_id, kind, storage_provider, object_key, size, purged_at")
          .in("submission_id", ids).is("purged_at", null).order("id").range(from, to)),
    ]);
    for (const submission of submissions.filter((row) => ids.includes(row.id))) {
      const ownRequests = requests.filter((request) => request.submission_id === submission.id);
      const finishedAt = reviewFinishedAt(
        submission,
        reviews.filter((review) => review.submission_id === submission.id),
        ownRequests,
      );
      if (!finishedAt) continue;
      const files = selectPurgeFiles(
        submission.id,
        uploads,
        ownRequests.flatMap((request) => (request.revisions ?? []).flatMap((revision) => revision.files ?? [])),
        prefix,
      );
      if (!files.length) continue;
      candidates.push({
        submissionId: submission.id,
        title: submission.title,
        artistName: submission.artist_name,
        type: submission.type,
        refunded: submission.payment_status === "REFUNDED",
        finishedAt,
        files,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      });
    }
  }
  return candidates.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
}

/** Upload keys another live row or an in-flight upload still points at. */
async function findSharedKeys(db: AdminClient, submissionId: string, keys: string[]) {
  const shared = new Set<string>();
  for (const part of chunk(Array.from(new Set(keys)), KEY_LOOKUP_CHUNK)) {
    const [others, staged] = await Promise.all([
      db.from("submission_files").select("object_key").in("object_key", part).neq("submission_id", submissionId).is("purged_at", null),
      db.from("submission_upload_staging").select("object_key").in("object_key", part),
    ]);
    if (others.error || staged.error) throw new Error("shared reference check failed");
    for (const row of [...(others.data ?? []), ...(staged.data ?? [])]) {
      shared.add(String((row as { object_key?: string }).object_key ?? ""));
    }
  }
  return shared;
}

async function updatePurgeColumn(
  db: AdminClient,
  files: Array<Pick<PurgeFile, "source" | "id">>,
  values: { purged_at?: string | null; purge_confirmed_at?: string | null },
) {
  const uploads = files.filter((file) => file.source === "upload").map((file) => file.id);
  const supplements = files.filter((file) => file.source === "supplement").map((file) => file.id);
  for (const [table, ids] of [["submission_files", uploads], ["submission_supplement_files", supplements]] as const) {
    for (const part of chunk(ids, ID_CHUNK)) {
      const { error } = await db.from(table).update(values).in("id", part);
      if (error) throw new Error(`${table} update failed`);
    }
  }
}

const setPurgedAt = (db: AdminClient, files: PurgeFile[], value: string | null) =>
  updatePurgeColumn(db, files, { purged_at: value });

/** The stored versions are gone. Until this is written a marked row counts
 * as interrupted and resumeInterruptedPurges deletes it again. */
const confirmPurged = (db: AdminClient, files: Array<Pick<PurgeFile, "source" | "id">>) =>
  updatePurgeColumn(db, files, { purge_confirmed_at: new Date().toISOString() });

const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)}GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))}MB`;

/**
 * Deletes the customer files of finished submissions. Rows are marked first,
 * so a download can never be offered for an object that is already gone; a
 * file whose storage delete fails is unmarked again and stays retryable, and
 * one whose delete was cut off is finished by resumeInterruptedPurges.
 */
export async function purgeCustomerFiles(
  db: AdminClient,
  submissionIds: string[],
  actorUserId: string,
  deleteAllVersions: (objectKey: string) => Promise<number> = deleteObjectAllVersions,
): Promise<PurgeResult[]> {
  const requested = Array.from(new Set(submissionIds));
  const candidates = new Map((await loadPurgeCandidates(db, requested)).map((candidate) => [candidate.submissionId, candidate]));
  const results: PurgeResult[] = [];

  for (const submissionId of requested) {
    const empty = { submissionId, deletedFiles: 0, failedFiles: 0, freedBytes: 0 };
    const candidate = candidates.get(submissionId);
    if (!candidate) {
      results.push({ ...empty, ok: false, error: "심의가 끝나지 않았거나(환불 건 제외) 삭제할 고객 파일이 없습니다." });
      continue;
    }
    try {
      const shared = await findSharedKeys(
        db,
        submissionId,
        candidate.files.filter((file) => file.source === "upload").map((file) => file.objectKey),
      );
      const files = candidate.files.filter((file) => !shared.has(file.objectKey));
      try {
        await setPurgedAt(db, files, new Date().toISOString());
      } catch (error) {
        await setPurgedAt(db, files, null).catch(() => undefined);
        throw error;
      }

      const keys = Array.from(new Set(files.map((file) => file.objectKey)));
      const failedKeys = new Set<string>();
      for (const batch of chunk(keys, DELETE_CONCURRENCY)) {
        const settled = await Promise.allSettled(batch.map((key) => deleteAllVersions(key)));
        settled.forEach((outcome, index) => {
          if (outcome.status === "fulfilled") return;
          failedKeys.add(batch[index]);
          console.error("[customer-file-purge] storage delete failed", {
            objectKeyId: getStorageLogId(batch[index]),
            errorName: outcome.reason instanceof Error ? outcome.reason.name : "UnknownError",
          });
        });
      }
      const failed = files.filter((file) => failedKeys.has(file.objectKey));
      if (failed.length) await setPurgedAt(db, failed, null);
      const deleted = files.filter((file) => !failedKeys.has(file.objectKey));
      const freedBytes = deleted.reduce((sum, file) => sum + file.sizeBytes, 0);
      // An unconfirmed row is deleted again later, which finds nothing to remove.
      if (deleted.length) await confirmPurged(db, deleted).catch(() => undefined);

      if (deleted.length) {
        await db.from("submission_events").insert({
          submission_id: submissionId,
          actor_user_id: actorUserId,
          event_type: "CUSTOMER_FILES_PURGED",
          message: `${candidate.refunded ? "환불 후" : "심의 완료 후"} 고객 업로드 파일 ${deleted.length}개(${formatBytes(freedBytes)})를 삭제했습니다.`,
        });
      }
      results.push({
        submissionId,
        ok: failed.length === 0,
        deletedFiles: deleted.length,
        failedFiles: failed.length,
        freedBytes,
        ...(failed.length ? { error: "일부 파일을 저장소에서 삭제하지 못했습니다. 다시 시도해주세요." } : {}),
      });
    } catch (error) {
      console.error("[customer-file-purge] submission skipped", {
        submissionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      results.push({ ...empty, ok: false, error: "파일 정보를 갱신하지 못해 삭제하지 않았습니다." });
    }
  }
  return results;
}

/** A marked row older than this whose delete never confirmed was cut off. */
export const INTERRUPTED_PURGE_AGE_MS = 15 * 60 * 1000;

type MarkedRow = { id: string; submission_id?: string | null; storage_provider?: string | null; kind?: string | null; object_key: string | null };

/**
 * Finishes purges that stopped between marking rows and deleting their
 * objects (a timed-out or killed function). Those rows are never purge
 * candidates again, so without this their objects would stay stored for
 * good. Deleting a key twice is harmless; a key another live or staged row
 * now uses, or one outside the customer namespaces, is confirmed without
 * deleting. Returns how many rows it confirmed.
 */
export async function resumeInterruptedPurges(
  db: AdminClient,
  options: { limit?: number; now?: number; deleteAllVersions?: (objectKey: string) => Promise<number> } = {},
) {
  const { prefix } = getB2Config();
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const cutoff = new Date((options.now ?? Date.now()) - INTERRUPTED_PURGE_AGE_MS).toISOString();
  const remove = options.deleteAllVersions ?? deleteObjectAllVersions;
  const [uploads, supplements] = await Promise.all([
    db.from("submission_files").select("id, submission_id, kind, storage_provider, object_key")
      .is("purge_confirmed_at", null).lt("purged_at", cutoff).order("purged_at").limit(limit),
    db.from("submission_supplement_files").select("id, object_key")
      .is("purge_confirmed_at", null).lt("purged_at", cutoff).order("purged_at").limit(limit),
  ]);
  if (uploads.error || supplements.error) throw new Error("interrupted purge lookup failed");
  const uploadRows = (uploads.data ?? []) as MarkedRow[];
  const supplementRows = (supplements.data ?? []) as MarkedRow[];
  const scoped = new Set(parseSubmissionB2ObjectRefs(uploadRows, prefix).map((ref) => `${ref.submissionId}\u0000${ref.objectKey}`));
  const work: Array<{ file: Pick<PurgeFile, "source" | "id">; objectKey: string | null; submissionId: string | null }> = [
    ...uploadRows.map((row) => ({
      file: { source: "upload" as const, id: row.id },
      objectKey: scoped.has(`${row.submission_id}\u0000${String(row.object_key ?? "").trim()}`) ? String(row.object_key).trim() : null,
      submissionId: row.submission_id ?? null,
    })),
    ...supplementRows.map((row) => {
      const key = String(row.object_key ?? "");
      const submissionId = key.slice(`${prefix.replace(/\/+$/, "")}/supplements/`.length).split("/")[0] ?? "";
      return {
        file: { source: "supplement" as const, id: row.id },
        objectKey: submissionId && isSupplementKeyOf(key, prefix, submissionId) ? key : null,
        submissionId: submissionId || null,
      };
    }),
  ];
  const confirmed: Array<Pick<PurgeFile, "source" | "id">> = [];
  for (const item of work) {
    try {
      if (item.objectKey) {
        const shared = item.file.source === "upload" && item.submissionId
          ? await findSharedKeys(db, item.submissionId, [item.objectKey])
          : new Set<string>();
        if (!shared.has(item.objectKey)) await remove(item.objectKey);
      }
      confirmed.push(item.file);
    } catch (error) {
      console.error("[customer-file-purge] interrupted purge retry failed", {
        objectKeyId: item.objectKey ? getStorageLogId(item.objectKey) : null,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  if (confirmed.length) await confirmPurged(db, confirmed);
  return confirmed.length;
}

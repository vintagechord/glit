import { abortMultipartUpload, deleteObjectAllVersions, getB2Config } from "@/lib/b2";
import { resumeInterruptedPurges } from "@/lib/admin/customer-file-purge";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import { cleanupExpiredMultipartGrants } from "@/lib/multipart-upload-grants";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteUnreferencedUploadObject } from "@/lib/upload-object-references";

type AdminClient = Pick<ReturnType<typeof createAdminClient>, "from" | "rpc" | "storage">;

export const MAGAZINE_ARTWORK_BUCKET = "magazine-artwork";
const QUEUE_BATCH = 20;
const RETIRE_BATCH = 200;
const MULTIPART_BATCH = 20;
const PURGE_BATCH = 50;
const ARTWORK_BATCH = 100;
// Vercel stops the function at 300 seconds, including after() work.
const RUN_BUDGET_MS = 240_000;

type QueueRow = {
  id: string;
  object_key: string;
  upload_id: string | null;
  submission_id: string | null;
  reason: string;
  attempts: number;
};

type StorageOps = {
  abortUpload: (params: { objectKey: string; uploadId: string }) => Promise<unknown>;
  deleteAllVersions: (objectKey: string) => Promise<number>;
};

const defaultOps: StorageOps = {
  abortUpload: abortMultipartUpload,
  deleteAllVersions: deleteObjectAllVersions,
};

/**
 * Works through objects a deleted grant, an expired staging receipt or an
 * abandoned PUT left behind: abort the multipart upload id if there is one,
 * then delete every stored version unless some row still uses the key. A
 * failure leaves the row leased; it comes back with a growing delay.
 */
export async function processStorageCleanupQueue(
  db: AdminClient,
  options: { prefix: string; limit?: number; ops?: StorageOps },
) {
  const ops = options.ops ?? defaultOps;
  const { data, error } = await db.rpc("lease_storage_object_cleanup", {
    p_limit: Math.max(1, Math.min(50, options.limit ?? QUEUE_BATCH)),
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as QueueRow[];
  let done = 0;
  for (const row of rows) {
    try {
      if (row.upload_id) {
        await ops.abortUpload({ objectKey: row.object_key, uploadId: row.upload_id }).catch((cause: unknown) => {
          // Completed or already aborted: nothing is left to abort.
          if (!(cause instanceof Error && cause.name === "NoSuchUpload")) throw cause;
        });
      }
      const outcome = await deleteUnreferencedUploadObject(db, row.object_key, {
        prefix: options.prefix,
        submissionId: row.submission_id,
        deleteAllVersions: ops.deleteAllVersions,
      });
      if (outcome === "outside_namespace") {
        console.warn("[storage-cleanup] queued key outside the upload namespaces was kept", {
          objectKeyId: getStorageLogId(row.object_key),
          reason: row.reason,
        });
      }
      const removed = await db.from("storage_object_cleanup_queue").delete().eq("id", row.id);
      if (removed.error) throw new Error(removed.error.message);
      done += 1;
    } catch (cause) {
      console.error("[storage-cleanup] queued object cleanup failed; it will be retried", {
        objectKeyId: getStorageLogId(row.object_key),
        reason: row.reason,
        attempts: row.attempts,
        errorName: cause instanceof Error ? cause.name : "UnknownError",
      });
    }
  }
  return { leased: rows.length, done };
}

/** Moves expired staging receipts and PUT grants to the cleanup queue. */
export async function retireExpiredUploadStorage(db: AdminClient, limit = RETIRE_BATCH) {
  const { data, error } = await db.rpc("retire_expired_upload_storage", { p_limit: limit });
  if (error) throw new Error(error.message);
  const counts = (data ?? {}) as { staging?: number; putGrants?: number; completedPutGrants?: number };
  return {
    staging: Number(counts.staging ?? 0),
    putGrants: Number(counts.putGrants ?? 0),
    completedPutGrants: Number(counts.completedPutGrants ?? 0),
  };
}

/**
 * Artwork members upload straight to Storage before their request exists.
 * A file no request points at a day later was abandoned.
 */
export async function cleanupOrphanMagazineArtwork(db: AdminClient, limit = ARTWORK_BATCH) {
  const { data, error } = await db.rpc("list_orphan_magazine_artwork", {
    p_min_age: "1 day",
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const names = ((data ?? []) as Array<{ object_name?: string | null }>)
    .map((row) => String(row.object_name ?? ""))
    .filter((name) => /^[0-9a-f-]{36}\/uploads\/[A-Za-z0-9._-]+$/.test(name));
  if (!names.length) return 0;
  const removed = await db.storage.from(MAGAZINE_ARTWORK_BUCKET).remove(names);
  if (removed.error) throw new Error(removed.error.message);
  return names.length;
}

type StepReport = { ok: boolean; count: number };

/**
 * One scheduled storage cleanup pass, bounded by the function time limit.
 * Every step is independent: one failing does not stop the others, and the
 * database leases make overlapping runs safe.
 */
export async function runUploadStorageCleanup(options: { budgetMs?: number; db?: AdminClient } = {}) {
  const db = options.db ?? createAdminClient();
  const deadline = Date.now() + (options.budgetMs ?? RUN_BUDGET_MS);
  const report: Record<string, StepReport> = {};
  const step = async (name: string, run: () => Promise<number>) => {
    try {
      report[name] = { ok: true, count: await run() };
    } catch (cause) {
      report[name] = { ok: false, count: 0 };
      console.error("[storage-cleanup] step failed", {
        step: name,
        errorName: cause instanceof Error ? cause.name : "UnknownError",
      });
    }
  };
  const { prefix } = getB2Config();

  await step("expired-uploads", async () => {
    let total = 0;
    while (Date.now() < deadline) {
      const counts = await retireExpiredUploadStorage(db);
      total += counts.staging + counts.putGrants;
      if (Math.max(counts.staging, counts.putGrants, counts.completedPutGrants) < RETIRE_BATCH) break;
    }
    return total;
  });
  await step("multipart-grants", async () => {
    let total = 0;
    while (Date.now() < deadline) {
      const leased = await cleanupExpiredMultipartGrants(MULTIPART_BATCH);
      total += leased;
      if (leased < MULTIPART_BATCH) break;
    }
    return total;
  });
  await step("queued-objects", async () => {
    let total = 0;
    while (Date.now() < deadline) {
      const { leased, done } = await processStorageCleanupQueue(db, { prefix, limit: QUEUE_BATCH });
      total += done;
      if (leased < QUEUE_BATCH) break;
    }
    return total;
  });
  await step("interrupted-purges", async () => {
    let total = 0;
    while (Date.now() < deadline) {
      const confirmed = await resumeInterruptedPurges(db, { limit: PURGE_BATCH });
      total += confirmed;
      if (confirmed < PURGE_BATCH) break;
    }
    return total;
  });
  await step("magazine-artwork", async () => {
    let total = 0;
    while (Date.now() < deadline) {
      const removed = await cleanupOrphanMagazineArtwork(db);
      total += removed;
      if (removed < ARTWORK_BATCH) break;
    }
    return total;
  });
  return report;
}

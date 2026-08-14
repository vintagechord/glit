import type { PostgrestError } from "@supabase/supabase-js";

import { deleteObject, getB2Config } from "@/lib/b2";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type SubmissionFileRow = {
  submission_id?: string | null;
  storage_provider?: string | null;
  object_key?: string | null;
};

export type SubmissionB2ObjectRef = {
  submissionId: string;
  objectKey: string;
};

type CleanupSummary = {
  deleted: number;
  failed: number;
  preserved: number;
};

const REFERENCE_LOOKUP_BATCH_SIZE = 10;
const DELETE_BATCH_SIZE = 8;

const uniqueNonEmpty = (values: Iterable<string>) =>
  Array.from(new Set(Array.from(values, (value) => value.trim()).filter(Boolean)));

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const safeDatabaseError = (error: PostgrestError | null) => ({
  code: error?.code,
});

const isSubmissionScopedObjectKey = ({
  objectKey,
  prefix,
  submissionId,
}: {
  objectKey: string;
  prefix: string;
  submissionId: string;
}) => {
  const normalizedPrefix = prefix.trim().replace(/\/+$/, "");
  if (!normalizedPrefix || !objectKey.startsWith(`${normalizedPrefix}/`)) {
    return false;
  }

  const relativeSegments = objectKey
    .slice(normalizedPrefix.length + 1)
    .split("/");
  return (
    relativeSegments.length === 4 &&
    relativeSegments.every(
      (segment) => Boolean(segment) && segment !== "." && segment !== "..",
    ) &&
    relativeSegments[2] === submissionId
  );
};

export const parseSubmissionB2ObjectRefs = (
  rows: SubmissionFileRow[],
  prefix: string,
): SubmissionB2ObjectRef[] => {
  const seen = new Set<string>();
  const refs: SubmissionB2ObjectRef[] = [];

  for (const row of rows) {
    const submissionId = String(row.submission_id ?? "").trim();
    const objectKey = String(row.object_key ?? "").trim();
    if (
      !submissionId ||
      !objectKey ||
      String(row.storage_provider ?? "").trim().toLowerCase() !== "b2" ||
      !isSubmissionScopedObjectKey({ objectKey, prefix, submissionId })
    ) {
      continue;
    }

    const dedupeKey = `${submissionId}\u0000${objectKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    refs.push({ submissionId, objectKey });
  }

  return refs;
};

/**
 * Captures B2 references before the parent deletion cascades submission_files.
 * Metadata lookup failure intentionally does not block the database deletion.
 */
export const loadSubmissionB2ObjectRefs = async (
  admin: AdminClient,
  submissionIds: string[],
): Promise<SubmissionB2ObjectRef[]> => {
  const ids = uniqueNonEmpty(submissionIds);
  if (ids.length === 0) return [];

  try {
    const { prefix } = getB2Config();
    const { data, error } = await admin
      .from("submission_files")
      .select("submission_id, storage_provider, object_key")
      .in("submission_id", ids);

    if (error) {
      console.error(
        "[SubmissionFiles] B2 cleanup metadata lookup failed",
        safeDatabaseError(error),
      );
      return [];
    }

    return parseSubmissionB2ObjectRefs(
      (data ?? []) as unknown as SubmissionFileRow[],
      prefix,
    );
  } catch (error) {
    console.error("[SubmissionFiles] B2 cleanup metadata lookup crashed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return [];
  }
};

export const selectDeletedSubmissionObjectKeys = (
  refs: SubmissionB2ObjectRef[],
  deletedSubmissionIds: string[],
) => {
  const deletedIds = new Set(uniqueNonEmpty(deletedSubmissionIds));
  return uniqueNonEmpty(
    refs
      .filter((ref) => deletedIds.has(ref.submissionId))
      .map((ref) => ref.objectKey),
  );
};

export const excludeReferencedObjectKeys = (
  candidateKeys: string[],
  referencedKeys: Iterable<string>,
) => {
  const referenced = new Set(uniqueNonEmpty(referencedKeys));
  return uniqueNonEmpty(candidateKeys).filter((key) => !referenced.has(key));
};

export const deleteObjectKeysBestEffort = async (
  objectKeys: string[],
  deleteObjectFn: (objectKey: string) => Promise<unknown> = deleteObject,
): Promise<Pick<CleanupSummary, "deleted" | "failed">> => {
  let deleted = 0;
  let failed = 0;

  for (const batch of chunk(uniqueNonEmpty(objectKeys), DELETE_BATCH_SIZE)) {
    const results = await Promise.allSettled(
      batch.map((objectKey) => deleteObjectFn(objectKey)),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        deleted += 1;
        return;
      }

      failed += 1;
      console.error("[SubmissionFiles] B2 object cleanup failed", {
        objectKeyId: getStorageLogId(batch[index]),
        errorName:
          result.reason instanceof Error ? result.reason.name : "UnknownError",
      });
    });
  }

  return { deleted, failed };
};

/**
 * Deletes captured B2 objects only after verifying that no current
 * submission_files row references them. This is shared by hard deletion and
 * successful file replacement so an object reused by another row is always
 * preserved.
 */
export const cleanupUnreferencedSubmissionB2Objects = async (
  admin: AdminClient,
  refs: SubmissionB2ObjectRef[],
  deleteObjectFn: (objectKey: string) => Promise<unknown> = deleteObject,
): Promise<CleanupSummary> => {
  const candidateKeys = uniqueNonEmpty(refs.map((ref) => ref.objectKey));
  if (candidateKeys.length === 0) {
    return { deleted: 0, failed: 0, preserved: 0 };
  }

  let deleted = 0;
  let failed = 0;
  let preserved = 0;

  try {
    for (const batch of chunk(candidateKeys, REFERENCE_LOOKUP_BATCH_SIZE)) {
      const { data, error } = await admin
        .from("submission_files")
        .select("object_key")
        .in("object_key", batch);

      if (error) {
        failed += batch.length;
        console.error(
          "[SubmissionFiles] surviving B2 reference check failed; cleanup skipped",
          {
            ...safeDatabaseError(error),
            objectCount: batch.length,
          },
        );
        continue;
      }

      const referencedKeys =
        ((data ?? []) as unknown as Array<{ object_key?: string | null }>)
          .map((row) => String(row.object_key ?? "").trim())
          .filter(Boolean);
      const unreferencedKeys = excludeReferencedObjectKeys(
        batch,
        referencedKeys,
      );
      preserved += batch.length - unreferencedKeys.length;

      const batchResult = await deleteObjectKeysBestEffort(
        unreferencedKeys,
        deleteObjectFn,
      );
      deleted += batchResult.deleted;
      failed += batchResult.failed;
    }
  } catch (error) {
    failed += candidateKeys.length - deleted - failed - preserved;
    console.error("[SubmissionFiles] B2 cleanup task crashed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return { deleted, failed, preserved };
};

/**
 * Deletes only objects whose submission parents were confirmed deleted and
 * whose keys are no longer referenced by another submission_files row.
 * Every failure is contained so this task can safely run with Next.js `after`.
 */
export const cleanupDeletedSubmissionB2Objects = async (
  admin: AdminClient,
  refs: SubmissionB2ObjectRef[],
  deletedSubmissionIds: string[],
): Promise<CleanupSummary> => {
  const candidateKeys = selectDeletedSubmissionObjectKeys(
    refs,
    deletedSubmissionIds,
  );
  if (candidateKeys.length === 0) {
    return { deleted: 0, failed: 0, preserved: 0 };
  }

  return cleanupUnreferencedSubmissionB2Objects(
    admin,
    candidateKeys.map((objectKey) => ({ submissionId: "", objectKey })),
  );
};

import { deleteObjectAllVersions } from "@/lib/b2";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = Pick<ReturnType<typeof createAdminClient>, "from">;

// Object keys are long; small batches keep the PostgREST URL well under limits.
const KEY_LOOKUP_CHUNK = 10;

const chunk = <T,>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, index * size + size),
  );

const validSegments = (segments: string[]) =>
  segments.every((segment) => Boolean(segment) && segment !== "." && segment !== "..");

/**
 * Keys an upload cleanup may delete: an applicant upload
 * (`{prefix}{owner}/{title}/{submissionId}/{file}`) or a supplement
 * (`{prefix}supplements/{submissionId}/…`). Certificates, rating marks,
 * admin uploads and email copies never match, so a bad queue row cannot
 * reach them. Without a submission id any submission matches.
 */
export function isCustomerUploadObjectKey(
  objectKey: string,
  prefix: string,
  submissionId?: string | null,
) {
  const base = `${prefix.trim().replace(/\/+$/, "")}/`;
  if (base === "/" || !objectKey.startsWith(base) || /[\u0000-\u001f\\]/.test(objectKey)) {
    return false;
  }
  const segments = objectKey.slice(base.length).split("/");
  if (!validSegments(segments)) return false;
  if (segments[0] === "supplements") {
    return segments.length >= 3 && (!submissionId || segments[1] === submissionId);
  }
  return (
    segments.length === 4 &&
    !["supplements", "admin-free", "artist-thumbnails", "email-attachments"].includes(segments[0]) &&
    (!submissionId || segments[2] === submissionId)
  );
}

/**
 * Keys some record still needs: a live or staged submission file, or a
 * verified supplement. Grants are not references: every key is unique to
 * the one upload that produced it.
 */
export async function findReferencedUploadKeys(db: AdminClient, keys: string[]) {
  const referenced = new Set<string>();
  for (const part of chunk(Array.from(new Set(keys.filter(Boolean))), KEY_LOOKUP_CHUNK)) {
    const [live, staged, supplements] = await Promise.all([
      db.from("submission_files").select("object_key").in("object_key", part),
      db.from("submission_upload_staging").select("object_key").in("object_key", part),
      db.from("submission_supplement_files").select("object_key").in("object_key", part).eq("status", "VERIFIED"),
    ]);
    if (live.error || staged.error || supplements.error) {
      throw new Error("upload reference check failed");
    }
    for (const row of [...(live.data ?? []), ...(staged.data ?? []), ...(supplements.data ?? [])]) {
      referenced.add(String((row as { object_key?: string | null }).object_key ?? "").trim());
    }
  }
  return referenced;
}

export type UnreferencedDeleteOutcome = "deleted" | "referenced" | "outside_namespace";

/**
 * Removes every stored version of an upload no record needs any more. A
 * failed reference lookup throws instead of deleting on doubt.
 */
export async function deleteUnreferencedUploadObject(
  db: AdminClient,
  objectKey: string,
  options: {
    prefix: string;
    submissionId?: string | null;
    deleteAllVersions?: (objectKey: string) => Promise<number>;
  },
): Promise<UnreferencedDeleteOutcome> {
  if (!isCustomerUploadObjectKey(objectKey, options.prefix, options.submissionId)) {
    return "outside_namespace";
  }
  if ((await findReferencedUploadKeys(db, [objectKey])).has(objectKey)) return "referenced";
  await (options.deleteAllVersions ?? deleteObjectAllVersions)(objectKey);
  return "deleted";
}

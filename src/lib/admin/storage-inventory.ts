import { createHash } from "node:crypto";
import { DeleteObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { getB2Config } from "@/lib/b2";
import { getStorageLogId } from "@/lib/guest-storage-owner";
import { certificateSubmissionId } from "@/lib/submission-certificate";
import { isCustomerUploadObjectKey } from "@/lib/upload-object-references";
import type { PurgeCandidate } from "@/lib/admin/customer-file-purge";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = Pick<ReturnType<typeof createAdminClient>, "from">;

/** One stored version or hide marker in the bucket. */
export type StoredEntry = {
  key: string;
  versionId: string;
  size: number;
  lastModified: string | null;
  latest: boolean;
  marker: boolean;
};

/**
 * A file nothing in the service needs any more is only treated as a
 * leftover once its newest entry is this old, so an upload that is still
 * being recorded (or a result mail that is still being queued) is never one.
 */
export const LEFTOVER_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const LEFTOVER_BATCH_LIMIT = 25;
const LIST_PAGE_LIMIT = 100;
const KEY_LOOKUP_CHUNK = 10;
const ID_CHUNK = 100;
const PAGE_SIZE = 1000;
/** A mail in these states can still be sent or resent and reads its attachment copies then. */
const UNSENT_MAIL_STATUSES = ["pending", "sending", "retry", "uncertain", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Upload keys start with the member's id or the guest storage owner (guest-<32 hex>). */
const UPLOAD_OWNER = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|guest-[0-9a-f]{32})$/i;

export type StoredNamespace = "upload" | "supplement" | "certificate" | "mail_copy" | "other";

/**
 * Which part of the service wrote a key. Anything that is not a customer
 * upload, a supplement, a certificate or a result-mail copy (admin uploads,
 * artist thumbnails, review document jobs, legacy rating images) is "other"
 * and is never offered for deletion here.
 */
export function storedKeyNamespace(key: string, prefix: string): { namespace: StoredNamespace; submissionId: string | null } {
  const other = { namespace: "other" as const, submissionId: null };
  const base = `${prefix.trim().replace(/\/+$/, "")}/`;
  if (base === "/" || !key.startsWith(base) || /[\u0000-\u001f\\]/.test(key)) return other;
  const parts = key.slice(base.length).split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return other;
  if (parts[0] === "email-attachments") {
    return parts.length === 3 && UUID.test(parts[1]) ? { namespace: "mail_copy", submissionId: parts[1].toLowerCase() } : other;
  }
  // Certificates are written as <submissionId>/certificate/<file> only. A
  // member upload under a title folder named "certificate" is one level
  // deeper (<owner>/certificate/<submissionId>/<file>) and stays an upload.
  if (parts.length === 3 && parts[1] === "certificate" && UUID.test(parts[0]) && certificateSubmissionId(key, base)) {
    return { namespace: "certificate", submissionId: parts[0].toLowerCase() };
  }
  if (parts[0] === "supplements") {
    return UUID.test(parts[1] ?? "") && isCustomerUploadObjectKey(key, base) ? { namespace: "supplement", submissionId: parts[1].toLowerCase() } : other;
  }
  // review-doc-jobs/<owner>/<job>/<file> has the same depth; the owner segment tells them apart.
  if (parts.length === 4 && UPLOAD_OWNER.test(parts[0]) && UUID.test(parts[2]) && isCustomerUploadObjectKey(key, base)) {
    return { namespace: "upload", submissionId: parts[2].toLowerCase() };
  }
  return other;
}

export type LeftoverReason =
  | "hidden_upload"
  | "unlinked_upload"
  | "unlinked_supplement"
  | "deleted_submission"
  | "sent_mail_copy"
  | "old_versions";

export type StorageLeftover = {
  /** Opaque: the object key stays in the service. */
  id: string;
  reason: LeftoverReason;
  name: string;
  submissionId: string | null;
  submissionTitle: string | null;
  bytes: number;
  versionCount: number;
  lastModified: string | null;
  key: string;
  versions: Array<{ versionId: string; size: number }>;
};

export type InventoryGroupKey = "purgeable" | "held" | "certificate" | "mail_pending" | "recent" | "other" | "leftover";
export const INVENTORY_GROUPS: InventoryGroupKey[] = ["purgeable", "held", "leftover", "certificate", "mail_pending", "recent", "other"];

export type HeldSubmission = { submissionId: string; title: string | null; reason: string; count: number; bytes: number };

export type StorageInventory = {
  checkedAt: string;
  truncated: boolean;
  totalBytes: number;
  totalVersions: number;
  hiddenMarkers: number;
  keys: number;
  groups: Array<{ key: InventoryGroupKey; count: number; bytes: number }>;
  leftovers: StorageLeftover[];
  held: HeldSubmission[];
};

type SubmissionRow = { id: string; title: string | null; status: string | null; payment_status: string | null };
type References = {
  liveUploads: Set<string>;
  liveSupplements: Set<string>;
  unsentMail: Set<string>;
  submissions: Map<string, SubmissionRow>;
};
type InventoryOptions = {
  candidates?: PurgeCandidate[];
  now?: number;
  listEntries?: () => Promise<{ entries: StoredEntry[]; truncated: boolean }>;
};

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

/** Every version and hide marker under the app prefix — what Backblaze bills for. */
export async function listStoredEntries(): Promise<{ entries: StoredEntry[]; truncated: boolean }> {
  const { client, bucket, prefix } = getB2Config();
  const entries: StoredEntry[] = [];
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  let pages = 0;
  do {
    const page = await client.send(
      new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    for (const version of page.Versions ?? []) {
      if (!version.Key || !version.VersionId) continue;
      entries.push({
        key: version.Key, versionId: version.VersionId, size: Number(version.Size) || 0,
        lastModified: version.LastModified ? new Date(version.LastModified).toISOString() : null,
        latest: version.IsLatest === true, marker: false,
      });
    }
    for (const marker of page.DeleteMarkers ?? []) {
      if (!marker.Key || !marker.VersionId) continue;
      entries.push({
        key: marker.Key, versionId: marker.VersionId, size: 0,
        lastModified: marker.LastModified ? new Date(marker.LastModified).toISOString() : null,
        latest: marker.IsLatest === true, marker: true,
      });
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    pages += 1;
  } while (keyMarker && pages < LIST_PAGE_LIMIT);
  return { entries, truncated: Boolean(keyMarker) };
}

async function deleteStoredVersion(key: string, versionId: string) {
  const { client, bucket } = getB2Config();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }), { abortSignal: AbortSignal.timeout(60_000) });
}

async function loadReferences(db: AdminClient, keys: Array<{ key: string; namespace: StoredNamespace; submissionId: string | null }>): Promise<References> {
  const uploadKeys = keys.filter((entry) => entry.namespace === "upload").map((entry) => entry.key);
  const supplementKeys = keys.filter((entry) => entry.namespace === "supplement").map((entry) => entry.key);
  const liveUploads = new Set<string>();
  const liveSupplements = new Set<string>();
  const collect = (target: Set<string>, rows: unknown, column: "object_key" | "file_path" = "object_key") => {
    for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
      const key = String(row[column] ?? "").trim();
      if (key) target.add(key);
    }
  };
  for (const part of chunk(uploadKeys, KEY_LOOKUP_CHUNK)) {
    // A live file row (by object key, or by file path for older rows), a staged
    // upload, or an upload still in flight under its grant.
    const [byKey, byPath, ...others] = await Promise.all([
      db.from("submission_files").select("object_key").in("object_key", part).is("purged_at", null),
      db.from("submission_files").select("file_path").in("file_path", part).is("purged_at", null),
      db.from("submission_upload_staging").select("object_key").in("object_key", part),
      db.from("upload_put_grants").select("object_key").in("object_key", part).eq("status", "PENDING"),
      db.from("multipart_upload_grants").select("object_key").in("object_key", part).in("status", ["ACTIVE", "COMPLETING", "ABORTING"]),
    ]);
    if ([byKey, byPath, ...others].some((lookup) => lookup.error)) throw new Error("upload reference check failed");
    collect(liveUploads, byKey.data);
    collect(liveUploads, byPath.data, "file_path");
    for (const lookup of others) collect(liveUploads, lookup.data);
  }
  for (const part of chunk(supplementKeys, KEY_LOOKUP_CHUNK)) {
    const live = await db.from("submission_supplement_files").select("object_key").in("object_key", part).is("purged_at", null);
    if (live.error) throw new Error("supplement reference check failed");
    collect(liveSupplements, live.data);
  }

  const unsentMail = new Set<string>();
  if (keys.some((entry) => entry.namespace === "mail_copy")) {
    const mails = await selectPages<{ attachment_refs?: unknown }>((from, to) =>
      db.from("email_outbox").select("id, attachment_refs").in("status", UNSENT_MAIL_STATUSES).order("id").range(from, to));
    for (const mail of mails) {
      if (!Array.isArray(mail.attachment_refs)) continue;
      for (const ref of mail.attachment_refs as Array<{ objectKey?: unknown }>) {
        if (typeof ref?.objectKey === "string") unsentMail.add(ref.objectKey);
      }
    }
  }

  const submissions = new Map<string, SubmissionRow>();
  const ids = Array.from(new Set(keys.map((entry) => entry.submissionId).filter((id): id is string => Boolean(id))));
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await db.from("submissions").select("id, title, status, payment_status").in("id", part);
    if (error) throw new Error("submission lookup failed");
    for (const row of (data ?? []) as SubmissionRow[]) submissions.set(String(row.id).toLowerCase(), row);
  }
  return { liveUploads, liveSupplements, unsentMail, submissions };
}

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i;

/** What the operator recognizes: the customer's file name, not the storage path. */
function displayName(key: string, namespace: StoredNamespace) {
  const last = key.split("/").pop() ?? key;
  if (namespace === "mail_copy") {
    const extension = last.split(".").pop()?.toUpperCase() ?? "";
    return `결과 메일 첨부 사본${extension ? ` (${extension})` : ""}`;
  }
  const name = last.replace(UUID_PREFIX, "");
  return namespace === "certificate" ? name.replace(/^[0-9a-f]{16}_/i, "") || "영등위 필증" : name || last;
}

function heldReason(row: SubmissionRow | undefined, namespace: StoredNamespace) {
  if (!row) return "신청 정보를 확인하지 못했습니다";
  if (row.status === "DRAFT") return "작성 중인 신청";
  if (row.payment_status === "UNPAID") return "결제 전 신청";
  if (namespace === "supplement") return "보완 제출 파일 · 심의가 끝나면 정리";
  return "정리 조건을 아직 충족하지 않음";
}

const newestTime = (entries: StoredEntry[]) =>
  entries.reduce((latest, entry) => Math.max(latest, entry.lastModified ? Date.parse(entry.lastModified) : 0), 0);

/**
 * Accounts for every stored byte under the app prefix. Customer uploads a
 * record still needs are split into the purge list (candidates) and those
 * held back; certificates (always, every version), copies an unsent mail will
 * read, recent files and other namespaces are kept. Everything else is a
 * leftover: replaced or deleted uploads whose bytes Backblaze still keeps,
 * uploads and mail copies of deleted submissions, copies of mails already
 * sent, and older versions of uploads or mail copies that are still needed.
 */
export async function loadStorageInventory(db: AdminClient, options: InventoryOptions = {}): Promise<StorageInventory> {
  const { prefix } = getB2Config();
  const now = options.now ?? Date.now();
  const { entries, truncated } = await (options.listEntries ?? listStoredEntries)();
  const byKey = new Map<string, StoredEntry[]>();
  for (const entry of entries) {
    const list = byKey.get(entry.key) ?? [];
    list.push(entry);
    byKey.set(entry.key, list);
  }
  const keys = Array.from(byKey.keys()).sort().map((key) => ({ key, ...storedKeyNamespace(key, prefix) }));
  const refs = await loadReferences(db, keys);
  const candidateKeys = new Set((options.candidates ?? []).flatMap((candidate) => candidate.files.map((file) => file.objectKey)));

  const groups = new Map<InventoryGroupKey, { count: number; bytes: number }>(INVENTORY_GROUPS.map((key) => [key, { count: 0, bytes: 0 }]));
  const add = (group: InventoryGroupKey, list: StoredEntry[]) => {
    const target = groups.get(group)!;
    for (const entry of list) if (!entry.marker) { target.count += 1; target.bytes += entry.size; }
  };
  const leftovers: StorageLeftover[] = [];
  const held = new Map<string, HeldSubmission>();

  for (const { key, namespace, submissionId } of keys) {
    const list = byKey.get(key)!;
    const latest = list.find((entry) => entry.latest) ?? null;
    const hidden = !latest || latest.marker;
    const submission = submissionId ? refs.submissions.get(submissionId) : undefined;
    const leftover = (reason: LeftoverReason, removable: StoredEntry[]) => {
      add("leftover", removable);
      const lastModified = removable.map((entry) => entry.lastModified).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
      leftovers.push({
        // The reason is part of the id: a file classified differently at
        // deletion time (needed again, so only its old versions would go)
        // is skipped rather than deleted under a different reason.
        id: createHash("sha256").update(`${reason}\u0000${key}`).digest("hex").slice(0, 32),
        reason, name: displayName(key, namespace), submissionId,
        submissionTitle: submission?.title ?? null,
        bytes: removable.reduce((sum, entry) => sum + entry.size, 0),
        versionCount: removable.length, lastModified, key,
        versions: removable.map((entry) => ({ versionId: entry.versionId, size: entry.size })),
      });
    };

    if (namespace === "other") { add("other", list); continue; }
    // Certificates are kept apart and never cleaned up here, even when their
    // submission was deleted (owner decision 2026-11-10).
    if (namespace === "certificate") { add("certificate", list); continue; }
    const needed =
      namespace === "upload" ? refs.liveUploads.has(key) :
        namespace === "supplement" ? refs.liveSupplements.has(key) :
          refs.unsentMail.has(key);

    if (needed) {
      const group: InventoryGroupKey = namespace === "mail_copy" ? "mail_pending" : candidateKeys.has(key) ? "purgeable" : "held";
      // A record points at a hidden key: something is off, so nothing is touched.
      const current = hidden ? list : list.filter((entry) => entry.latest);
      add(group, current);
      if (group === "held" && submissionId) {
        const entry = held.get(submissionId) ?? { submissionId, title: submission?.title ?? null, reason: heldReason(submission, namespace), count: 0, bytes: 0 };
        for (const version of current) if (!version.marker) { entry.count += 1; entry.bytes += version.size; }
        held.set(submissionId, entry);
      }
      const older = hidden ? [] : list.filter((entry) => !entry.latest);
      if (older.length) leftover("old_versions", older);
      continue;
    }
    if (now - newestTime(list) < LEFTOVER_MIN_AGE_MS) { add("recent", list); continue; }
    const reason: LeftoverReason = !submission ? "deleted_submission" :
      namespace === "mail_copy" ? "sent_mail_copy" :
        namespace === "supplement" ? "unlinked_supplement" :
          hidden ? "hidden_upload" : "unlinked_upload";
    leftover(reason, list);
  }

  const stored = entries.filter((entry) => !entry.marker);
  return {
    checkedAt: new Date(now).toISOString(),
    truncated,
    totalBytes: stored.reduce((sum, entry) => sum + entry.size, 0),
    totalVersions: stored.length,
    hiddenMarkers: entries.length - stored.length,
    keys: keys.length,
    groups: INVENTORY_GROUPS.map((key) => ({ key, ...groups.get(key)! })),
    leftovers: leftovers.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)),
    held: Array.from(held.values()).sort((a, b) => b.bytes - a.bytes),
  };
}

export type LeftoverDeleteResult = { id: string; ok: boolean; deletedVersions: number; failedVersions: number; freedBytes: number; error?: string };

/**
 * Deletes leftovers by the opaque ids the desk listed. The bucket is listed
 * and classified again first, so a file that is needed again (or already
 * gone) is skipped, and only the exact versions found to be leftovers are
 * removed — a version written after the listing always survives.
 */
export async function deleteStorageLeftovers(
  db: AdminClient,
  ids: string[],
  options: Omit<InventoryOptions, "candidates"> & { deleteVersion?: (key: string, versionId: string) => Promise<void> } = {},
): Promise<LeftoverDeleteResult[]> {
  const requested = Array.from(new Set(ids));
  const inventory = await loadStorageInventory(db, options);
  const byId = new Map(inventory.leftovers.map((leftover) => [leftover.id, leftover]));
  const remove = options.deleteVersion ?? deleteStoredVersion;
  const results: LeftoverDeleteResult[] = [];
  for (const id of requested) {
    const leftover = byId.get(id);
    if (!leftover) {
      results.push({ id, ok: false, deletedVersions: 0, failedVersions: 0, freedBytes: 0, error: "이미 정리되었거나 다시 필요한 파일입니다. 목록을 새로고침하세요." });
      continue;
    }
    let deletedVersions = 0, failedVersions = 0, freedBytes = 0;
    for (const version of leftover.versions) {
      try {
        await remove(leftover.key, version.versionId);
        deletedVersions += 1;
        freedBytes += version.size;
      } catch (error) {
        failedVersions += 1;
        console.error("[storage-leftovers] version delete failed", {
          objectKeyId: getStorageLogId(leftover.key),
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    console.info("[storage-leftovers] removed", { objectKeyId: getStorageLogId(leftover.key), reason: leftover.reason, deletedVersions, failedVersions, freedBytes });
    results.push({
      id, ok: failedVersions === 0, deletedVersions, failedVersions, freedBytes,
      ...(failedVersions ? { error: "일부 버전을 저장소에서 지우지 못했습니다. 다시 시도해주세요." } : {}),
    });
  }
  return results;
}

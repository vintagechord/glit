import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { readBoundedBodyBytes } from "@/lib/request-body";
import { assertPrivateReviewBucket, putReviewObject, getReviewObject, deleteReviewObject, reviewObjectKey, assertReviewObjectKey } from "@/lib/review-docs/storage";
import { ArchiveError, archiveDatabaseError } from "./http";
import { getOwnedLibrary, saveArchiveLibrary } from "./service";

export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export function evidenceMime(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  return null;
}

export async function uploadArchiveEvidence(owner: string, request: Request) {
  const body = await readBoundedBodyBytes(request, EVIDENCE_MAX_BYTES + 65536);
  if (!body.ok) throw new ArchiveError("증빙은 PDF·PNG·JPEG 파일 1개, 최대 5MB까지 가능합니다.", 413, "EVIDENCE_LIMIT");
  let form: FormData;
  try { form = await new Response(Buffer.from(body.bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new ArchiveError("파일 업로드 형식을 확인해주세요."); }
  const libraryId = z.uuid().parse(form.get("libraryId"));
  const taskId = z.string().min(1).max(256).parse(form.get("taskId"));
  const library = await getOwnedLibrary(owner, libraryId);
  if (!library.data.tasks.some(task => task.id === taskId)) throw new ArchiveError("연결할 업무를 찾을 수 없습니다.", 404);
  const files = form.getAll("file");
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File) || !file.size || file.size > EVIDENCE_MAX_BYTES) throw new ArchiveError("5MB 이하 증빙 파일 1개를 선택해주세요.", 413);
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = evidenceMime(buffer);
  if (!mime) throw new ArchiveError("PDF·PNG·JPEG 형식만 첨부할 수 있습니다.", 422);
  const admin = createAdminClient();
  const { count, error: countError } = await admin.from("music_archive_attachments").select("id", { count: "exact", head: true }).eq("owner_id", owner).is("deleted_at", null);
  archiveDatabaseError(countError);
  if ((count ?? 0) >= 100) throw new ArchiveError("계정당 증빙 파일 100개까지 저장할 수 있습니다.", 429);
  await assertPrivateReviewBucket();
  const id = randomUUID();
  const objectKey = reviewObjectKey(owner, libraryId, id);
  await putReviewObject(objectKey, buffer, mime);
  const { data, error } = await admin.from("music_archive_attachments").insert({ id, owner_id: owner, library_id: libraryId, task_id: taskId, object_key: objectKey, file_name: file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 180), mime_type: mime, size_bytes: buffer.length }).select("id,task_id,file_name,mime_type,size_bytes,created_at").single();
  if (error) { await deleteReviewObject(objectKey, owner, libraryId).catch(() => undefined); archiveDatabaseError(error); }
  try {
    const current = await getOwnedLibrary(owner, libraryId);
    const updated = structuredClone(current.data);
    const task = updated.tasks.find(item => item.id === taskId)!;
    task.attachmentIds = [...new Set([...task.attachmentIds, id])]; task.source = "user_evidence";
    await saveArchiveLibrary(owner, current, updated, "attach_evidence", owner, current.archived_at, { attachmentId: id, taskId });
  } catch (error) {
    // A failed version-checked attachment link must not report a completed upload.
    await admin.from("music_archive_attachments").delete().eq("id", id).eq("owner_id", owner);
    await deleteReviewObject(objectKey, owner, libraryId).catch(() => undefined);
    throw error;
  }
  // Attachment provenance is separate from agency verification and task completion.
  return { evidence: data };
}

export async function downloadArchiveEvidence(owner: string, id: string) {
  const { data, error } = await createAdminClient().from("music_archive_attachments").select("*").eq("id", z.uuid().parse(id)).eq("owner_id", owner).is("deleted_at", null).maybeSingle();
  archiveDatabaseError(error);
  if (!data) throw new ArchiveError("증빙 파일을 찾을 수 없습니다.", 404);
  await getOwnedLibrary(owner, data.library_id);
  assertReviewObjectKey(data.object_key, owner, data.library_id);
  return { file: data, bytes: await getReviewObject(data.object_key, EVIDENCE_MAX_BYTES) };
}

export async function deleteArchiveEvidence(owner: string, id: string) {
  const { data, error } = await createAdminClient().from("music_archive_attachments").select("*").eq("id", z.uuid().parse(id)).eq("owner_id", owner).is("deleted_at", null).maybeSingle();
  archiveDatabaseError(error);
  if (!data) throw new ArchiveError("증빙 파일을 찾을 수 없습니다.", 404);
  const library = await getOwnedLibrary(owner, data.library_id);
  const updated = structuredClone(library.data);
  for (const task of updated.tasks) {
    if (task.attachmentIds.includes(id)) { task.attachmentIds = task.attachmentIds.filter(value => value !== id); task.source = task.attachmentIds.length ? "user_evidence" : "user_input"; }
  }
  await saveArchiveLibrary(owner, library, updated, "remove_evidence_reference", owner, library.archived_at, { attachmentId: id });
  await deleteReviewObject(data.object_key, owner, data.library_id);
  const { error: updateError } = await createAdminClient().from("music_archive_attachments").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("owner_id", owner);
  archiveDatabaseError(updateError);
  return { removed: true };
}

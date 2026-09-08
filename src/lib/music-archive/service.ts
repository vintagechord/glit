import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { ArchiveError, archiveDatabaseError } from "./http";
import { applyArchiveCommand, archiveCommandSchema, createArchiveData, validateArchiveData, type ArchiveLibrary } from "./model";
import { getMusicProviderStatuses, parseMusicProviderUrl } from "./providers";
import { MusicProviderError, searchMusicBrainzArtists } from "./musicbrainz";
import { agencyGuides } from "./guides";
import { submissionArchiveColumns, normalizeSubmissionTitles } from "./reviews";
import { enqueueArchiveSync, resumeArchiveSync, acquireArchiveProviderPermit } from "./sync";
import { previewArchiveCsv, importArchiveCsv } from "./csv";

const uuid = z.string().uuid();
const paging = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 10000 ? value : 0;
const libraryFields = "id,owner_id,version,data,archived_at,created_at,updated_at";
const publicJobFields = "id,library_id,provider,external_artist_id,status,cursor,counts,error_code,error_message,attempts,available_at,created_at,updated_at,checked_at";

export async function getOwnedLibrary(owner: string, libraryId: string): Promise<ArchiveLibrary> {
  const { data, error } = await createAdminClient().from("music_archive_libraries").select(libraryFields).eq("id", uuid.parse(libraryId)).eq("owner_id", owner).maybeSingle();
  archiveDatabaseError(error);
  if (!data) throw new ArchiveError("관리 항목을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return { ...data, data: validateArchiveData(data.data) } as ArchiveLibrary;
}

export async function saveArchiveLibrary(owner: string, library: ArchiveLibrary, data: unknown, action: string, actor = owner, archivedAt = library.archived_at, details: Record<string, unknown> = {}) {
  const validated = validateArchiveData(data);
  if (Buffer.byteLength(JSON.stringify(validated)) > 12_000_000) throw new ArchiveError("아카이브 용량 한도에 도달했습니다. 아티스트별로 나누어 관리해주세요.", 413, "ARCHIVE_SIZE_LIMIT");
  const { data: result, error } = await createAdminClient().rpc("save_music_archive_library", { p_id: library.id, p_owner: owner, p_version: library.version, p_data: validated, p_action: action, p_actor: actor, p_archived_at: archivedAt, p_details: details });
  archiveDatabaseError(error);
  return (Array.isArray(result) ? result[0] : result) as ArchiveLibrary;
}

export async function getArchiveGuides(includeHidden = false) {
  const { data, error } = await createAdminClient().from("music_archive_guide_overrides").select("id,payload,updated_at");
  archiveDatabaseError(error);
  return agencyGuides.map(guide => ({ ...guide, ...(data?.find(row => row.id === guide.id)?.payload ?? {}) })).filter(guide => includeHidden || guide.visible !== false);
}

export async function getArchiveOverview(owner: string, page = 0) {
  const admin = createAdminClient();
  const start = paging(page) * 20;
  const [libraries, jobs, guides, count] = await Promise.all([
    admin.rpc("list_music_archive_libraries", { p_owner: owner, p_offset: start, p_limit: 20 }),
    admin.from("music_archive_jobs").select(publicJobFields).eq("owner_id", owner).order("updated_at", { ascending: false }).limit(100),
    getArchiveGuides(),
    admin.from("music_archive_libraries").select("id", { count: "exact", head: true }).eq("owner_id", owner),
  ]);
  archiveDatabaseError(libraries.error); archiveDatabaseError(jobs.error); archiveDatabaseError(count.error);
  return { libraries: libraries.data ?? [], jobs: jobs.data ?? [], guides, providers: getMusicProviderStatuses(), page: paging(page), total: count.count ?? 0, nextPage: start + 20 < (count.count ?? 0) ? paging(page) + 1 : null };
}

export async function getArchiveDetail(owner: string, libraryId: string) {
  const library = await getOwnedLibrary(owner, libraryId);
  const admin = createAdminClient();
  const ids = [...new Set(library.data.reviewLinks.map(link => link.submissionId))];
  const [jobs, evidence, events, reviews] = await Promise.all([
    admin.from("music_archive_jobs").select(publicJobFields).eq("owner_id", owner).eq("library_id", libraryId).order("created_at", { ascending: false }).limit(25),
    admin.from("music_archive_attachments").select("id,task_id,file_name,mime_type,size_bytes,created_at").eq("owner_id", owner).eq("library_id", libraryId).is("deleted_at", null),
    admin.from("music_archive_events").select("id,actor_id,action,before_version,after_version,created_at").eq("owner_id", owner).eq("library_id", libraryId).order("created_at", { ascending: false }).limit(50),
    ids.length ? admin.from("submissions").select(submissionArchiveColumns).eq("user_id", owner).is("user_deleted_at", null).in("id", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [jobs, evidence, events, reviews]) archiveDatabaseError(result.error);
  return { library, jobs: jobs.data ?? [], evidence: evidence.data ?? [], events: events.data ?? [], reviews: (reviews.data ?? []).map(normalizeSubmissionTitles) };
}

export async function searchOwnedSubmissions(owner: string, query: string, page = 0) {
  const q = query.trim().slice(0, 100).replace(/[,%()\\_]/g, " ");
  const start = paging(page) * 20;
  let request = createAdminClient().from("submissions").select(submissionArchiveColumns, { count: "exact" }).eq("user_id", owner).eq("type", "ALBUM").is("user_deleted_at", null);
  if (q) request = request.or(`title.ilike.%${q}%,artist_name.ilike.%${q}%`);
  const { data, error, count } = await request.order("created_at", { ascending: false }).range(start, start + 19);
  archiveDatabaseError(error);
  return { submissions: (data ?? []).map(normalizeSubmissionTitles), total: count ?? 0, nextPage: start + 20 < (count ?? 0) ? paging(page) + 1 : null };
}

export async function searchArchiveArtists(owner: string, params: URLSearchParams) {
  if (params.get("provider") && params.get("provider") !== "musicbrainz") return { items: [], queryStatus: "unsupported", message: "이 제공처는 공식 링크 연결과 수동 입력을 지원합니다.", providers: getMusicProviderStatuses() };
  const rate = consumeRateLimit({ namespace: "archive-provider-search", identifier: owner, limit: 12, windowMs: 60000 });
  if (!rate.allowed) throw new ArchiveError("외부 검색은 분당 12회까지 가능합니다.", 429);
  try { const result = await searchMusicBrainzArtists(params.get("q") ?? "", { offset: paging(Number(params.get("offset") ?? 0)), acquirePermit: acquireArchiveProviderPermit }); return { ...result, queryStatus: result.items.length ? "success" : "no_results" }; }
  catch (error) {
    if (!(error instanceof MusicProviderError)) throw error;
    if (error.code === "invalid_input") throw new ArchiveError(error.message, 422, "INVALID_INPUT");
    return { items: [], total: 0, nextOffset: null, queryStatus: error.code === "not_found" ? "no_results" : ["permission_required", "configuration_required"].includes(error.code) ? "forbidden" : "temporary_error", code: error.code, message: error.message, providers: getMusicProviderStatuses() };
  }
}

async function validateCommandAccess(owner: string, library: ArchiveLibrary, command: z.infer<typeof archiveCommandSchema>) {
  if (command.type === "link_review") {
    const { data, error } = await createAdminClient().from("submissions").select("id,album_tracks(id)").eq("id", command.link.submissionId).eq("user_id", owner).eq("type", "ALBUM").is("user_deleted_at", null).maybeSingle();
    archiveDatabaseError(error);
    if (!data || (command.link.submissionTrackId && !data.album_tracks.some(track => track.id === command.link.submissionTrackId))) throw new ArchiveError("연결 가능한 본인 심의 내역을 선택해주세요.", 404);
    if (command.link.trackId && !command.link.submissionTrackId) throw new ArchiveError("트랙 연결에는 원본 심의의 대상 트랙을 선택해야 합니다.", 422);
  }
  const attachmentIds = command.type === "save_tasks" ? command.task.attachmentIds : command.type === "update_task" ? command.patch.attachmentIds : [];
  if (attachmentIds?.length) {
    const { data, error } = await createAdminClient().from("music_archive_attachments").select("id,task_id").eq("owner_id", owner).eq("library_id", library.id).is("deleted_at", null).in("id", attachmentIds);
    archiveDatabaseError(error);
    if (data?.length !== new Set(attachmentIds).size || data?.some(item => command.type === "update_task" ? item.task_id !== command.taskId : command.type === "save_tasks" ? command.trackIds.length !== 1 || item.task_id !== `${command.id}:${command.trackIds[0]}` : true)) throw new ArchiveError("본인의 해당 아카이브 증빙만 연결할 수 있습니다.", 403);
  }
}

export async function getArchiveAdmin() {
  const { data, error } = await createAdminClient().from("music_archive_jobs").select(publicJobFields).order("updated_at", { ascending: false }).limit(100);
  archiveDatabaseError(error);
  return { jobs: data ?? [], guides: await getArchiveGuides(true), providers: getMusicProviderStatuses() };
}

export async function mutateArchive(owner: string, raw: unknown, isAdmin = false): Promise<{ library?: ArchiveLibrary; job?: unknown; runLibraryId?: string; [key: string]: unknown }> {
  const body = z.object({ action: z.string(), libraryId: uuid.optional(), version: z.number().int().positive().optional() }).passthrough().parse(raw);
  if (body.action === "create") {
    const { name } = z.object({ name: z.string().trim().min(1).max(500) }).parse(body);
    const { data, error } = await createAdminClient().rpc("create_music_archive_library", { p_id: randomUUID(), p_owner: owner, p_data: createArchiveData(name, randomUUID()) });
    archiveDatabaseError(error); return { library: Array.isArray(data) ? data[0] : data };
  }
  if (body.action === "admin-retry" && isAdmin) return resumeArchiveSync(owner, uuid.parse(body.jobId), true);
  if (body.action === "admin-guide" && isAdmin) {
    const guide = z.record(z.string(), z.unknown()).parse(body.guide);
    const id = z.string().parse(guide.id);
    const original = agencyGuides.find(item => item.id === id);
    if (!original) throw new ArchiveError("공식 안내 항목을 선택해주세요.");
    const allowedHosts = new Set([original.url, original.searchUrl, original.applyUrl, ...original.sources.map(source => source.url)].filter(Boolean).map(value => new URL(value).hostname));
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(guide)) {
      if (key === "id") continue;
      if (key === "visible") payload[key] = z.boolean().parse(value);
      else if (["url", "searchUrl", "applyUrl"].includes(key)) {
        const url = new URL(z.string().url().parse(value));
        if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHosts.has(url.hostname)) throw new ArchiveError("해당 기관의 공식 사이트 주소만 설정할 수 있습니다.");
        payload[key] = url.toString();
      } else if (["preparation", "steps", "after"].includes(key)) payload[key] = z.array(z.string().max(2000)).max(12).parse(value);
      else if (key === "checkedAt") payload[key] = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(value);
      else if (["name", "introduction", "eligibility", "costNote"].includes(key)) payload[key] = z.string().max(8000).parse(value);
    }
    const { error } = await createAdminClient().rpc("save_music_archive_guide", { p_id: id, p_actor: owner, p_payload: payload });
    archiveDatabaseError(error); return { guides: await getArchiveGuides(true) };
  }
  if (body.action === "resume") return resumeArchiveSync(owner, uuid.parse(body.jobId));
  const library = await getOwnedLibrary(owner, uuid.parse(body.libraryId));
  if (body.action === "sync") return enqueueArchiveSync(owner, library, z.string().parse(body.provider));
  if (body.action === "csv-preview") return { preview: previewArchiveCsv(z.string().max(400000).parse(body.csv), library.data) };
  if (body.version !== library.version) throw new ArchiveError("변경된 자료를 새로고침한 뒤 다시 저장해주세요.", 409, "VERSION_CONFLICT");
  if (body.action === "archive" || body.action === "restore") {
    const saved = await saveArchiveLibrary(owner, library, library.data, body.action, owner, body.action === "archive" ? new Date().toISOString() : null);
    if (body.action === "archive") {
      const { error } = await createAdminClient().from("music_archive_jobs").update({ status: "cancelled", lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq("owner_id", owner).eq("library_id", library.id).in("status", ["queued", "running", "partial", "blocked", "failed"]);
      archiveDatabaseError(error);
    }
    return { library: saved };
  }
  if (library.archived_at) throw new ArchiveError("제외한 아티스트를 먼저 복구해주세요.", 409);
  if (body.action === "csv-import") return { library: await saveArchiveLibrary(owner, library, importArchiveCsv(z.string().max(400000).parse(body.csv), library.data), "csv_import") };
  if (body.action === "commands") {
    const commands = z.array(archiveCommandSchema).min(1).max(12).parse(body.commands);
    let updated = library.data;
    for (const command of commands) {
      if (["set_connection", "remove_connection"].includes(command.type)) throw new ArchiveError("제공처 연결은 별도로 변경해주세요.");
      await validateCommandAccess(owner, { ...library, data: updated }, command);
      updated = applyArchiveCommand(updated, command);
    }
    return { library: await saveArchiveLibrary(owner, library, updated, "batch_edit", owner, library.archived_at, { commands }) };
  }
  let command: z.infer<typeof archiveCommandSchema>;
  if (body.action === "connect") {
    const link = parseMusicProviderUrl(z.string().parse(body.url), "artist");
    if (!link || (body.provider && link.provider !== body.provider)) throw new ArchiveError("지원하는 서비스의 아티스트 URL을 입력해주세요.", 422);
    command = archiveCommandSchema.parse({ type: "set_connection", connection: { provider: link.provider, externalArtistId: link.externalId, url: link.url, confirmed: true } });
  } else if (body.action === "command") command = archiveCommandSchema.parse(body.command);
  else throw new ArchiveError("지원하지 않는 작업입니다.");
  if (command.type === "set_connection") {
    const parsed = command.connection.url ? parseMusicProviderUrl(command.connection.url, "artist") : command.connection.provider === "musicbrainz" && command.connection.externalArtistId ? parseMusicProviderUrl(command.connection.externalArtistId, "artist") : null;
    if (!parsed || parsed.provider !== command.connection.provider || (command.connection.externalArtistId && parsed.externalId !== command.connection.externalArtistId)) throw new ArchiveError("아티스트 URL과 식별자를 확인해주세요.", 422);
    command.connection.url = parsed.url; command.connection.externalArtistId = parsed.externalId;
  }
  await validateCommandAccess(owner, library, command);
  const updated = applyArchiveCommand(library.data, command);
  const result = await saveArchiveLibrary(owner, library, updated, command.type, owner, library.archived_at, { command });
  if (["set_connection", "remove_connection"].includes(command.type)) {
    const provider = command.type === "set_connection" ? command.connection.provider : command.type === "remove_connection" ? command.provider : "";
    const { error } = await createAdminClient().from("music_archive_jobs").update({ status: "cancelled", lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq("owner_id", owner).eq("library_id", library.id).eq("provider", provider).in("status", ["queued", "running", "partial", "blocked", "failed"]);
    archiveDatabaseError(error);
  }
  return { library: result };
}

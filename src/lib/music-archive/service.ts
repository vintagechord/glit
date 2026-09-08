import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/request-rate-limit";
import { ArchiveError, archiveDatabaseError } from "./http";
import { applyArchiveCommand, archiveCommandSchema, createArchiveData, validateArchiveData, type ArchiveLibrary } from "./model";
import { getMusicProviderStatuses, parseMusicProviderUrl } from "./providers";
import { MusicProviderError, searchMusicBrainzArtists } from "./musicbrainz";
import { lookupAppleArtist } from "./apple";
import { searchCatalogArtists, indexCatalogArtists } from "./catalog-search";
import { agencyGuides } from "./guides";
import { submissionArchiveColumns, normalizeSubmissionTitles, matchArchiveReviews } from "./reviews";
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
  return { libraries: libraries.data ?? [], jobs: jobs.data ?? [], guides, providers: getMusicProviderStatuses().filter(item => item.status === "available" && item.id !== "musicbrainz"), page: paging(page), total: count.count ?? 0, nextPage: start + 20 < (count.count ?? 0) ? paging(page) + 1 : null };
}

export async function getArchiveDetail(owner: string, libraryId: string) {
  const library = await getOwnedLibrary(owner, libraryId);
  const admin = createAdminClient();
  const ids = [...new Set(library.data.reviewLinks.map(link => link.submissionId))];
  const [jobs, evidence, events, candidates] = await Promise.all([
    admin.from("music_archive_jobs").select(publicJobFields).eq("owner_id", owner).eq("library_id", libraryId).order("created_at", { ascending: false }).limit(25),
    admin.from("music_archive_attachments").select("id,task_id,file_name,mime_type,size_bytes,created_at").eq("owner_id", owner).eq("library_id", libraryId).is("deleted_at", null),
    admin.from("music_archive_events").select("id,actor_id,action,before_version,after_version,created_at,details").eq("owner_id", owner).eq("library_id", libraryId).order("created_at", { ascending: false }).limit(100),
    (async () => {
      const rows: { id: string; status: string; melon_url?: string | null; archive_review_context?: unknown; album_tracks?: { track_no?: number; track_title?: string | null; track_title_kr?: string | null; track_title_en?: string | null }[] }[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await admin.from("submissions").select("id,status,melon_url,archive_review_context,album_tracks(track_no,track_title,track_title_kr,track_title_en)").eq("user_id", owner).eq("type", "ALBUM").is("user_deleted_at", null).order("created_at", { ascending: false }).order("id").range(offset, offset + 999);
        archiveDatabaseError(result.error);
        rows.push(...(result.data ?? []));
        if (!result.data || result.data.length < 1000) return rows;
      }
    })(),
  ]);
  for (const result of [jobs, evidence, events]) archiveDatabaseError(result.error);
  const onsideReviews = matchArchiveReviews(library.data, candidates, library.id);
  const matchedIds = new Set([...ids, ...onsideReviews.map(review => review.submissionId)]);
  const reviews = [];
  const reviewIds = [...matchedIds];
  for (let offset = 0; offset < reviewIds.length; offset += 100) {
    const result = await admin.from("submissions").select(submissionArchiveColumns).eq("user_id", owner).eq("type", "ALBUM").is("user_deleted_at", null).in("id", reviewIds.slice(offset, offset + 100));
    archiveDatabaseError(result.error);
    reviews.push(...(result.data ?? []).map(normalizeSubmissionTitles));
  }
  return { library, jobs: jobs.data ?? [], evidence: evidence.data ?? [], events: events.data ?? [], reviews, onsideReviews };
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
  const provider = params.get("provider") ?? "apple";
  if (!["apple", "musicbrainz"].includes(provider)) return { items: [], total: 0, nextOffset: null, queryStatus: "unsupported", message: "아티스트 이름으로 앨범을 찾아주세요." };
  const rate = consumeRateLimit({ namespace: "archive-provider-search", identifier: owner, limit: 40, windowMs: 60000 });
  if (!rate.allowed) throw new ArchiveError("검색 요청이 많습니다. 잠시 후 다시 검색해주세요.", 429);
  const query = z.string().trim().min(1).max(200).parse(params.get("q") ?? "");
  const offset = Math.min(180, paging(Number(params.get("offset") ?? 0)));
  try {
    const result = provider === "apple"
      ? await searchCatalogArtists(query, offset, () => acquireArchiveProviderPermit("apple"))
      : await searchMusicBrainzArtists(query, { offset, acquirePermit: () => acquireArchiveProviderPermit("musicbrainz") });
    return { ...result, queryStatus: result.items.length ? "success" : "no_results" };
  } catch (error) {
    if (!(error instanceof MusicProviderError)) throw error;
    if (error.code === "invalid_input") throw new ArchiveError(error.message, 422, "INVALID_INPUT");
    return { items: [], total: 0, nextOffset: null, queryStatus: error.code === "not_found" ? "no_results" : ["permission_required", "configuration_required"].includes(error.code) ? "forbidden" : "temporary_error", code: error.code, message: provider === "apple" ? "검색을 잠시 이용할 수 없습니다. 잠시 후 다시 시도해주세요." : error.message };
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

export async function getArchiveAdmin(query = "", page = 0) {
  const start = paging(page) * 20;
  const q = query.trim().slice(0, 100).replace(/[,%()\\_]/g, " ");
  let listing = createAdminClient().from("music_archive_admin_libraries").select("*", { count: "exact" });
  if (q) listing = listing.or(`artist_name.ilike.%${q}%${uuid.safeParse(q).success ? `,owner_id.eq.${q},id.eq.${q}` : ""}`);
  const [jobs, libraries, guides] = await Promise.all([
    createAdminClient().from("music_archive_jobs").select(publicJobFields).order("updated_at", { ascending: false }).limit(100),
    listing.order("updated_at", { ascending: false }).range(start, start + 19),
    getArchiveGuides(true),
  ]);
  archiveDatabaseError(jobs.error); archiveDatabaseError(libraries.error);
  return { jobs: jobs.data ?? [], guides, providers: getMusicProviderStatuses(), libraries: libraries.data ?? [], total: libraries.count ?? 0, nextPage: start + 20 < (libraries.count ?? 0) ? paging(page) + 1 : null };
}

/** Only called after the route has verified the requesting administrator. */
export async function getArchiveAdminDetail(libraryId: string) {
  const { data, error } = await createAdminClient().from("music_archive_libraries").select("owner_id").eq("id", uuid.parse(libraryId)).maybeSingle();
  archiveDatabaseError(error);
  if (!data) throw new ArchiveError("관리 항목을 찾을 수 없습니다.", 404, "NOT_FOUND");
  return getArchiveDetail(data.owner_id, libraryId);
}

/** Persist exact archive scope after the ordinary owner-checked submission save. */
export async function linkArchiveSubmission(owner: string, context: { libraryId: string; releaseId: string; trackId?: string }, submissionId: string, submissionTrackIds?: string[]) {
  const { data: submission, error } = await createAdminClient().from("submissions").select("id,archive_review_context,album_tracks(id,track_no)").eq("id", uuid.parse(submissionId)).eq("user_id", owner).eq("type", "ALBUM").is("user_deleted_at", null).maybeSingle();
  archiveDatabaseError(error);
  if (!submission) throw new ArchiveError("심의 신청을 찾을 수 없습니다.", 404);
  const savedTracks = [...submission.album_tracks].sort((a, b) => a.track_no - b.track_no);
  const targetIds = submissionTrackIds ?? savedTracks.map(track => track.id);
  if (targetIds.some(id => !savedTracks.some(track => track.id === id)) || new Set(targetIds).size !== targetIds.length) throw new ArchiveError("심의 트랙 연결을 확인해주세요.", 422);
  for (let attempt = 0; attempt < 4; attempt++) {
    const library = await getOwnedLibrary(owner, context.libraryId);
    const release = library.data.releases.find(row => row.id === context.releaseId && !row.excluded && !row.mergedInto);
    const availableTracks = library.data.tracks.filter(row => row.releaseId === context.releaseId && row.managed && !row.excluded && !row.mergedInto && (!context.trackId || row.id === context.trackId)).sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
    const snapshot = submission.archive_review_context as { libraryId?: string; releaseId?: string; trackIds?: string[] } | null;
    const tracks = snapshot?.libraryId === context.libraryId && snapshot.releaseId === context.releaseId && Array.isArray(snapshot.trackIds)
      ? snapshot.trackIds.flatMap(id => availableTracks.find(track => track.id === id) ?? []) : availableTracks;
    if (!release || !tracks.length || tracks.length !== targetIds.length) throw new ArchiveError("앨범과 심의 트랙 구성이 달라졌습니다. 새로고침해주세요.", 409);
    const links = tracks.map((track, index) => ({ id: `onside:${submissionId}:${index}`, submissionId, releaseId: release.id, trackId: track.id, submissionTrackId: targetIds[index] }));
    // Track links preserve participation/subset scope even for an album-level application.
    const data = { ...library.data, reviewLinks: [...library.data.reviewLinks.filter(link => link.submissionId !== submissionId), ...links] };
    if (JSON.stringify(data.reviewLinks) === JSON.stringify(library.data.reviewLinks)) return;
    try { await saveArchiveLibrary(owner, library, data, "link_review", owner, library.archived_at, { submissionId, releaseId: release.id, trackIds: tracks.map(track => track.id) }); return; }
    catch (error) { if (!(error instanceof ArchiveError) || error.code !== "VERSION_CONFLICT" || attempt === 3) throw error; }
  }
}

export async function mutateArchive(owner: string, raw: unknown, isAdmin = false): Promise<{ library?: ArchiveLibrary; job?: unknown; runLibraryId?: string; [key: string]: unknown }> {
  const body = z.object({ action: z.string(), libraryId: uuid.optional(), version: z.number().int().positive().optional() }).passthrough().parse(raw);
  if (body.action === "admin-resolve-conflict" && isAdmin) {
    const { data: target, error } = await createAdminClient().from("music_archive_libraries").select("owner_id").eq("id", uuid.parse(body.libraryId)).maybeSingle();
    archiveDatabaseError(error);
    if (!target) throw new ArchiveError("관리 항목을 찾을 수 없습니다.", 404);
    const library = await getOwnedLibrary(target.owner_id, String(body.libraryId));
    if (body.version !== library.version) throw new ArchiveError("변경된 자료를 새로고침한 뒤 다시 저장해주세요.", 409, "VERSION_CONFLICT");
    const command = archiveCommandSchema.parse({ type: "resolve_conflict", conflictId: body.conflictId, resolution: body.resolution });
    return { library: await saveArchiveLibrary(target.owner_id, library, applyArchiveCommand(library.data, command), "admin_resolve_conflict", owner, library.archived_at, { command }) };
  }
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
    if (parsed.provider === "apple") {
      // Revalidate the chosen ID; never silently map an unrelated domestic provider ID by name.
      const candidate = await lookupAppleArtist(parsed.externalId, { acquirePermit: () => acquireArchiveProviderPermit("apple") });
      await indexCatalogArtists([candidate], new Date().toISOString());
    }
    command.connection.url = parsed.url; command.connection.externalArtistId = parsed.externalId;
  }
  await validateCommandAccess(owner, library, command);
  const updated = applyArchiveCommand(library.data, command);
  const result = await saveArchiveLibrary(owner, library, updated, command.type, owner, library.archived_at, { command });
  if (command.type === "remove_connection" || (command.type === "set_connection" && !command.connection.confirmed)) {
    const provider = command.type === "remove_connection" ? command.provider : command.connection.provider;
    const externalId = command.type === "remove_connection" ? command.externalArtistId : command.connection.externalArtistId;
    let cancellation = createAdminClient().from("music_archive_jobs").update({ status: "cancelled", lease_token: null, lease_until: null, updated_at: new Date().toISOString() }).eq("owner_id", owner).eq("library_id", library.id).eq("provider", provider).in("status", ["queued", "running", "partial", "blocked", "failed"]);
    if (externalId) cancellation = cancellation.eq("external_artist_id", externalId);
    const { error } = await cancellation;
    if (error) return { library: result, syncNotice: "연결 변경을 저장했습니다. 해당 불러오기 작업은 다음 실행 때 연결 해제를 확인하고 중단됩니다." };
  }
  if (command.type === "set_connection" && command.connection.provider === "apple" && command.connection.confirmed) {
    try { return { library: result, ...await enqueueArchiveSync(owner, result, "apple", command.connection.externalArtistId) }; }
    catch { return { library: result, syncNotice: "아티스트 연결을 저장했습니다. 앨범 불러오기를 다시 눌러주세요." }; }
  }
  return { library: result };
}

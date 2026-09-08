import { z } from "zod";

/** Private owner document. Public provider snapshots live in music_archive_sources. */
const id = z.string().trim().min(1).max(256);
const short = z.string().trim().max(500);
const optionalText = z.string().trim().max(4000).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다.").optional();
const timestamp = z.string().datetime({ offset: true });
export const providerSchema = z.enum(["musicbrainz", "spotify", "melon", "genie", "bugs", "youtube", "apple"]);
export type ArchiveProvider = z.infer<typeof providerSchema>;
const providerHosts: Record<ArchiveProvider, string[]> = {
  musicbrainz: ["musicbrainz.org"], spotify: ["open.spotify.com"], melon: ["melon.com"],
  genie: ["genie.co.kr"], bugs: ["bugs.co.kr"], youtube: ["youtube.com", "youtu.be"], apple: ["music.apple.com"],
};
export const safeWebUrlSchema = z.string().url().max(2000).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && !["localhost", "0.0.0.0", "127.0.0.1", "::1"].includes(url.hostname) && !/^\d+(\.\d+){3}$/.test(url.hostname) && !url.hostname.startsWith("[") && url.hostname.includes("."); } catch { return false; }
}, "공식 HTTPS 주소를 입력해주세요.");
export const serviceLinkSchema = z.object({ provider: providerSchema, url: safeWebUrlSchema, externalId: short.optional() }).strict().refine(link => {
  const host = new URL(link.url).hostname.toLowerCase();
  return providerHosts[link.provider].some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}, "선택한 음악 서비스의 공식 주소를 입력해주세요.");
export type ServiceLink = z.infer<typeof serviceLinkSchema>;
const links = z.array(serviceLinkSchema).max(20).default([]);
export const sourceReferenceSchema = z.object({ provider: providerSchema, externalId: id, checkedAt: timestamp }).strict();
export type ArchiveSourceReference = z.infer<typeof sourceReferenceSchema>;
export const archiveArtistSchema = z.object({ id, name: short.min(1), disambiguation: short.optional(), note: optionalText, links }).strict();
export const releaseInputSchema = z.object({
  id, title: short.min(1), type: z.enum(["album", "ep", "single", "other"]).default("album"),
  releaseDate: z.string().regex(/^\d{4}(-\d{2})?(-\d{2})?$/).optional(),
  participation: z.enum(["primary", "participation", "unknown"]).default("primary"),
  version: short.optional(), artistName: short.optional(), barcode: short.optional(), links,
}).strict();
const metaFields = { source: sourceReferenceSchema.optional(), excluded: z.boolean().default(false), mergedInto: id.optional(), userEdited: z.boolean().default(false) };
export const archiveReleaseSchema = releaseInputSchema.extend(metaFields);
export const trackInputSchema = z.object({
  id, releaseId: id, title: short.min(1), discNumber: z.number().int().min(1).max(1000).default(1),
  trackNumber: z.number().int().min(1).max(10000).default(1), recordingId: id.optional(), version: short.optional(),
  artistName: short.optional(), managed: z.boolean().default(true), links,
}).strict();
export const archiveTrackSchema = trackInputSchema.extend(metaFields);
export const archiveRecordingSchema = z.object({ id, title: short.min(1), version: short.optional(), isrc: short.optional(), workIds: z.array(id).max(100).default([]), source: sourceReferenceSchema.optional(), userEdited: z.boolean().optional() }).strict();
export const archiveWorkSchema = z.object({ id, title: short.min(1), writers: short.optional(), iswc: short.optional(), institutionNumbers: z.array(z.object({ agency: short.min(1), number: short.min(1) }).strict()).max(20).default([]), source: sourceReferenceSchema.optional(), userEdited: z.boolean().optional() }).strict();
export const taskKindSchema = z.enum(["review", "copyright_work", "copyright_legal", "performer", "karaoke"]);
export const taskStatusSchema = z.enum(["needs_check", "not_started", "preparing", "submitted", "processing", "needs_changes", "completed", "rejected", "not_applicable", "later"]);
export const taskResultSchema = z.enum(["unknown", "eligible", "ineligible", "approved", "rejected", "listed", "not_listed", "information_found"]);
export const taskSourceSchema = z.enum(["onside", "official", "user_input", "user_evidence", "admin"]);
export const queryStatusSchema = z.enum(["not_queried", "querying", "success", "no_results", "forbidden", "unsupported", "temporary_error"]);
export const statusLabels: Record<z.infer<typeof taskStatusSchema>, string> = { needs_check: "확인 필요", not_started: "미진행", preparing: "준비 중", submitted: "신청 완료", processing: "처리 중", needs_changes: "보완 필요", completed: "처리 완료", rejected: "반려", not_applicable: "해당 없음", later: "나중에 하기" };
export const kindLabels: Record<z.infer<typeof taskKindSchema>, string> = { review: "심의", copyright_work: "저작물 등록·관리", copyright_legal: "법적 저작권 등록", performer: "실연자 등록", karaoke: "노래방 등록" };
export const resultLabels: Record<z.infer<typeof taskResultSchema>, string> = { unknown: "결과 미확인", eligible: "적격", ineligible: "부적격", approved: "등록 승인", rejected: "반려", listed: "수록 확인", not_listed: "미수록 기록", information_found: "등록 정보 확인" };
export const sourceLabels: Record<z.infer<typeof taskSourceSchema>, string> = { onside: "온사이드 내부 기록", official: "외부 공식 조회 확인", user_input: "사용자 입력", user_evidence: "사용자 증빙 첨부", admin: "관리자 확인" };
export const queryStatusLabels: Record<z.infer<typeof queryStatusSchema>, string> = { not_queried: "미조회", querying: "조회 중", success: "조회 성공", no_results: "검색 결과 없음", forbidden: "권한 부족", unsupported: "자동 연동 미지원", temporary_error: "일시 오류" };
export const taskStatusLabels = statusLabels;
export const taskKindLabels = kindLabels;
export const taskFieldsSchema = z.object({
  kind: taskKindSchema, agency: short.min(1), status: taskStatusSchema.default("needs_check"), result: taskResultSchema.default("unknown"),
  queryStatus: z.enum(["not_queried", "unsupported"]).optional(),
  participant: short.optional(), role: short.optional(), executor: z.enum(["onside", "agency", "self"]).optional(), agencyName: short.optional(),
  recordingId: id.optional(), workId: id.optional(), applicationDate: date, completedDate: date, checkedDate: date, recheckDate: date,
  referenceNumber: short.optional(), songNumber: short.optional(), applicationUrl: safeWebUrlSchema.optional(), memo: optionalText,
  attachmentIds: z.array(id).max(20).default([]),
}).strict();
export const archiveTaskSchema = taskFieldsSchema.omit({ queryStatus: true }).extend({ id, trackId: id, source: taskSourceSchema, queryStatus: queryStatusSchema.default("unsupported") }).strict();
export const archiveReviewLinkSchema = z.object({ id, submissionId: z.string().uuid(), releaseId: id.optional(), trackId: id.optional(), submissionTrackId: z.string().uuid().optional(), note: optionalText }).strict().refine(link => Boolean(link.releaseId || link.trackId), "심의 내역을 연결할 발매작 또는 트랙을 선택해주세요.");
export const archiveConnectionSchema = z.object({ provider: providerSchema, externalArtistId: short.optional(), url: safeWebUrlSchema.optional(), confirmed: z.boolean().default(false), status: z.enum(["automatic", "needs_configuration", "partnership_required", "link_only", "manual"]).default("link_only"), checkedAt: timestamp.optional() }).strict();
export const archiveAffiliationSchema = z.object({ id, agency: short.min(1), participant: short.min(1), role: short.optional(), status: z.enum(["unknown", "not_joined", "applying", "joined", "not_applicable"]), memo: optionalText }).strict();
export const archiveConflictSchema = z.object({ id, entityType: z.enum(["release", "track"]), entityId: id, field: z.enum(["title", "releaseDate", "version", "artistName", "barcode", "participation", "type", "discNumber", "trackNumber", "recordingId", "managed"]), current: z.union([z.string(), z.number(), z.boolean(), z.null()]), incoming: z.union([z.string(), z.number(), z.boolean(), z.null()]), source: sourceReferenceSchema, createdAt: timestamp, resolved: z.enum(["keep", "accept"]).optional() }).strict();
export const archiveDataSchema = z.object({
  schemaVersion: z.literal(1), artist: archiveArtistSchema,
  releases: z.array(archiveReleaseSchema).max(5000), tracks: z.array(archiveTrackSchema).max(50000),
  recordings: z.array(archiveRecordingSchema).max(50000), works: z.array(archiveWorkSchema).max(50000),
  tasks: z.array(archiveTaskSchema).max(100000), reviewLinks: z.array(archiveReviewLinkSchema).max(10000),
  connections: z.array(archiveConnectionSchema).max(20), affiliations: z.array(archiveAffiliationSchema).max(100),
  conflicts: z.array(archiveConflictSchema).max(20000).default([]),
}).strict();
export type ArchiveArtist = z.infer<typeof archiveArtistSchema>;
export type ArchiveRelease = z.infer<typeof archiveReleaseSchema>;
export type ArchiveTrack = z.infer<typeof archiveTrackSchema>;
export type ArchiveRecording = z.infer<typeof archiveRecordingSchema>;
export type ArchiveWork = z.infer<typeof archiveWorkSchema>;
export type ArchiveTask = z.infer<typeof archiveTaskSchema>;
export type ArchiveTaskFields = z.input<typeof taskFieldsSchema>;
export type ArchiveReviewLink = z.infer<typeof archiveReviewLinkSchema>;
export type ArchiveConnection = z.infer<typeof archiveConnectionSchema>;
export type ArchiveAffiliation = z.infer<typeof archiveAffiliationSchema>;
export type ArchiveConflict = z.infer<typeof archiveConflictSchema>;
export type ArchiveData = z.infer<typeof archiveDataSchema>;
export type ArchiveLibrary = { id: string; owner_id: string; version: number; data: ArchiveData; archived_at: string | null; created_at: string; updated_at: string };
export type ArchiveSyncJob = { id: string; owner_id: string; library_id: string; provider: string; external_artist_id: string; status: "queued" | "running" | "partial" | "completed" | "blocked" | "failed" | "cancelled"; cursor: Record<string, unknown>; counts: Record<string, number>; error_code: string | null; error_message: string | null; attempts: number; available_at: string; lease_token: string | null; lease_until: string | null; created_at: string; updated_at: string; checked_at: string | null };

const artistPatchSchema = archiveArtistSchema.omit({ id: true }).extend({ links: z.array(serviceLinkSchema).max(20) }).partial();
const releasePatchSchema = releaseInputSchema.omit({ id: true }).extend({ type: z.enum(["album", "ep", "single", "other"]), participation: z.enum(["primary", "participation", "unknown"]), links: z.array(serviceLinkSchema).max(20) }).partial();
const trackPatchSchema = trackInputSchema.omit({ id: true }).extend({ discNumber: z.number().int().min(1).max(1000), trackNumber: z.number().int().min(1).max(10000), managed: z.boolean(), links: z.array(serviceLinkSchema).max(20) }).partial();
const taskPatchSchema = taskFieldsSchema.extend({ status: taskStatusSchema, result: taskResultSchema, attachmentIds: z.array(id).max(20) }).partial();

export class ArchiveDomainError extends Error {
  constructor(message: string) { super(message); this.name = "ArchiveDomainError"; }
}

export const archiveCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update_artist"), patch: artistPatchSchema }).strict(),
  z.object({ type: z.literal("add_release"), release: releaseInputSchema }).strict(),
  z.object({ type: z.literal("update_release"), releaseId: id, patch: releasePatchSchema }).strict(),
  z.object({ type: z.literal("add_track"), track: trackInputSchema }).strict(),
  z.object({ type: z.literal("update_track"), trackId: id, patch: trackPatchSchema }).strict(),
  z.object({ type: z.literal("set_excluded"), entityType: z.enum(["release", "track"]), id, excluded: z.boolean() }).strict(),
  z.object({ type: z.literal("merge"), entityType: z.enum(["release", "track"]), id, targetId: id }).strict(),
  z.object({ type: z.literal("unmerge"), entityType: z.enum(["release", "track"]), id }).strict(),
  z.object({ type: z.literal("save_tasks"), id, trackIds: z.array(id).min(1).max(200), task: taskFieldsSchema }).strict(),
  z.object({ type: z.literal("update_task"), taskId: id, patch: taskPatchSchema }).strict(),
  z.object({ type: z.literal("link_review"), link: archiveReviewLinkSchema }).strict(),
  z.object({ type: z.literal("unlink_review"), linkId: id }).strict(),
  z.object({ type: z.literal("save_recording"), recording: archiveRecordingSchema.omit({ source: true, userEdited: true }) }).strict(),
  z.object({ type: z.literal("save_work"), work: archiveWorkSchema.omit({ source: true, userEdited: true }) }).strict(),
  z.object({ type: z.literal("set_connection"), connection: archiveConnectionSchema.omit({ status: true, checkedAt: true }) }).strict(),
  z.object({ type: z.literal("remove_connection"), provider: providerSchema }).strict(),
  z.object({ type: z.literal("save_affiliation"), affiliation: archiveAffiliationSchema }).strict(),
  z.object({ type: z.literal("resolve_conflict"), conflictId: id, resolution: z.enum(["keep", "accept"]) }).strict(),
]);
export type ArchiveCommand = z.input<typeof archiveCommandSchema>;

export function createArchiveData(name: string, artistId = "artist"): ArchiveData {
  return archiveDataSchema.parse({ schemaVersion: 1, artist: { id: artistId, name, links: [] }, releases: [], tracks: [], recordings: [], works: [], tasks: [], reviewLinks: [], connections: [], affiliations: [], conflicts: [] });
}

function getById<T extends { id: string }>(items: T[], wanted: string): T {
  const found = items.find(item => item.id === wanted);
  if (!found) throw new ArchiveDomainError("선택한 항목을 찾을 수 없습니다.");
  return found;
}
function addUnique<T extends { id: string }>(items: T[], item: T) {
  if (items.some(existing => existing.id === item.id)) throw new ArchiveDomainError("이미 등록된 항목입니다.");
  items.push(item);
}
function put<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex(existing => existing.id === item.id);
  if (index < 0) items.push(item); else items[index] = item;
}
function assertTrackIdentityChange(data: ArchiveData, track: ArchiveTrack, patch: Partial<ArchiveTrack>) {
  const changingVersion = ("recordingId" in patch && patch.recordingId !== track.recordingId) || ("version" in patch && patch.version !== track.version);
  if (changingVersion && (data.tasks.some(task => task.trackId === track.id) || data.reviewLinks.some(link => link.trackId === track.id || link.releaseId === track.releaseId))) throw new ArchiveDomainError("업무 이력이 있는 녹음·버전은 변경할 수 없습니다. 새 트랙을 추가하여 별도 버전으로 관리해주세요.");
}
function assertTaskResult(task: Pick<ArchiveTask, "kind" | "result" | "status" | "participant" | "role">) {
  if (task.kind === "performer" && ["submitted", "processing", "completed"].includes(task.status) && (!task.participant?.trim() || !task.role?.trim())) throw new ArchiveDomainError("실연정보의 신청·처리 기록에는 관리할 참여자명과 참여 역할을 입력해주세요.");
  const allowed: Record<ArchiveTask["kind"], ArchiveTask["result"][]> = {
    review: ["unknown", "eligible", "ineligible", "rejected"], copyright_work: ["unknown", "approved", "rejected", "information_found"],
    copyright_legal: ["unknown", "approved", "rejected", "information_found"], performer: ["unknown", "approved", "rejected", "information_found"],
    karaoke: ["unknown", "listed", "not_listed", "rejected"],
  };
  if (!allowed[task.kind].includes(task.result)) throw new ArchiveDomainError("선택한 업무에 맞는 결과를 선택해주세요.");
}

/** Referential validation runs before each server save, including provider sync. */
export function validateArchiveData(input: unknown): ArchiveData {
  const data = archiveDataSchema.parse(input);
  for (const items of [data.releases, data.tracks, data.recordings, data.works, data.tasks, data.reviewLinks, data.affiliations, data.conflicts]) {
    if (new Set(items.map(item => item.id)).size !== items.length) throw new ArchiveDomainError("중복 내부 식별자가 있습니다.");
  }
  const releases = new Map(data.releases.map(item => [item.id, item]));
  const tracks = new Map(data.tracks.map(item => [item.id, item]));
  const recordingMap = new Map(data.recordings.map(item => [item.id, item]));
  const recordings = new Set(recordingMap.keys());
  const works = new Set(data.works.map(item => item.id));
  if (new Set(data.connections.map(item => item.provider)).size !== data.connections.length) throw new ArchiveDomainError("제공처 연결이 중복되었습니다.");
  for (const track of data.tracks) {
    if (!releases.has(track.releaseId) || (track.recordingId && !recordings.has(track.recordingId))) throw new ArchiveDomainError("트랙의 발매작 또는 녹음 연결이 올바르지 않습니다.");
  }
  for (const recording of data.recordings) if (recording.workIds.some(workId => !works.has(workId))) throw new ArchiveDomainError("녹음의 저작물 연결이 올바르지 않습니다.");
  for (const task of data.tasks) {
    if (!tracks.has(task.trackId) || (task.recordingId && !recordings.has(task.recordingId)) || (task.workId && !works.has(task.workId))) throw new ArchiveDomainError("업무 대상 연결이 올바르지 않습니다.");
    const track = tracks.get(task.trackId)!;
    if (task.recordingId && task.recordingId !== track.recordingId) throw new ArchiveDomainError("업무의 녹음 버전은 선택한 트랙의 연결과 같아야 합니다.");
    if (task.workId && track.recordingId && !recordingMap.get(track.recordingId)?.workIds.includes(task.workId)) throw new ArchiveDomainError("먼저 해당 녹음에 저작물을 연결한 뒤 업무를 기록해주세요.");
    assertTaskResult(task);
  }
  for (const link of data.reviewLinks) {
    if ((link.releaseId && !releases.has(link.releaseId)) || (link.trackId && !tracks.has(link.trackId))) throw new ArchiveDomainError("심의 대상 연결이 올바르지 않습니다.");
    if (link.releaseId && link.trackId && tracks.get(link.trackId)?.releaseId !== link.releaseId) throw new ArchiveDomainError("심의 대상 트랙의 발매작이 다릅니다.");
  }
  for (const items of [data.releases, data.tracks]) {
    const map = new Map<string, { id: string; mergedInto?: string }>(items.map(item => [item.id, item]));
    for (const item of items) {
      const seen = new Set([item.id]);
      let next = item.mergedInto;
      while (next) {
        if (seen.has(next) || !map.has(next)) throw new ArchiveDomainError("중복 연결이 순환하거나 대상이 없습니다.");
        seen.add(next); next = map.get(next)?.mergedInto;
      }
    }
  }
  return data;
}

/** No network, clock, random IDs or mutations of the input. ID supplies make retries deterministic. */
export function applyArchiveCommand(input: ArchiveData, rawCommand: unknown): ArchiveData {
  const data = validateArchiveData(input);
  const command = archiveCommandSchema.parse(rawCommand);
  switch (command.type) {
    case "update_artist": Object.assign(data.artist, command.patch); break;
    case "add_release": addUnique(data.releases, archiveReleaseSchema.parse({ ...command.release, userEdited: true })); break;
    case "update_release": Object.assign(getById(data.releases, command.releaseId), command.patch, { userEdited: true }); break;
    case "add_track": addUnique(data.tracks, archiveTrackSchema.parse({ ...command.track, userEdited: true })); break;
    case "update_track": {
      const track = getById(data.tracks, command.trackId);
      assertTrackIdentityChange(data, track, command.patch);
      Object.assign(track, command.patch, { userEdited: true }); break;
    }
    case "set_excluded": {
      const item = command.entityType === "release" ? getById(data.releases, command.id) : getById(data.tracks, command.id);
      item.excluded = command.excluded; item.userEdited = true; break;
    }
    case "merge": {
      const items = command.entityType === "release" ? data.releases : data.tracks;
      const item = getById<{ id: string; mergedInto?: string; userEdited: boolean }>(items, command.id);
      const target = getById<{ id: string; mergedInto?: string; userEdited: boolean }>(items, command.targetId);
      if (target.mergedInto || item.id === target.id) throw new ArchiveDomainError("병합 대상은 다른 대표 항목이어야 합니다.");
      // Preserve all recording-specific tasks and original links. Unmerge is lossless.
      item.mergedInto = target.id; item.userEdited = true; break;
    }
    case "unmerge": {
      const item = command.entityType === "release" ? getById(data.releases, command.id) : getById(data.tracks, command.id);
      delete item.mergedInto; item.userEdited = true; break;
    }
    case "save_tasks": {
      for (const trackId of new Set(command.trackIds)) {
        const track = getById(data.tracks, trackId);
        if (!track.managed || track.excluded || track.mergedInto || getById(data.releases, track.releaseId).excluded) throw new ArchiveDomainError("관리 중인 트랙만 업무를 기록할 수 있습니다.");
        const task = archiveTaskSchema.parse({ ...command.task, id: `${command.id}:${trackId}`, trackId, source: command.task.attachmentIds.length ? "user_evidence" : "user_input", queryStatus: command.task.queryStatus ?? "unsupported" });
        assertTaskResult(task);
        // A repeated request is idempotent, while a new request explicitly records a new history entry.
        put(data.tasks, task);
      }
      break;
    }
    case "update_task": {
      const task = getById(data.tasks, command.taskId);
      Object.assign(task, command.patch);
      task.source = task.attachmentIds.length ? "user_evidence" : "user_input";
      task.queryStatus = command.patch.queryStatus ?? "unsupported";
      assertTaskResult(task); break;
    }
    case "link_review": {
      if (data.reviewLinks.some(link => link.submissionId === command.link.submissionId && link.trackId === command.link.trackId && link.releaseId === command.link.releaseId && link.submissionTrackId === command.link.submissionTrackId)) break;
      addUnique(data.reviewLinks, command.link); break;
    }
    case "unlink_review": getById(data.reviewLinks, command.linkId); data.reviewLinks = data.reviewLinks.filter(link => link.id !== command.linkId); break;
    case "save_recording": {
      const existing = data.recordings.find(item => item.id === command.recording.id);
      if (existing && (existing.version !== command.recording.version || existing.isrc !== command.recording.isrc || JSON.stringify(existing.workIds) !== JSON.stringify(command.recording.workIds))) {
        const affected = data.tracks.filter(track => track.recordingId === existing.id);
        if (data.tasks.some(task => task.recordingId === existing.id || affected.some(track => track.id === task.trackId)) || data.reviewLinks.some(link => affected.some(track => link.trackId === track.id || link.releaseId === track.releaseId))) throw new ArchiveDomainError("업무 이력이 연결된 녹음은 새 녹음으로 분리해주세요.");
      }
      put(data.recordings, { ...command.recording, userEdited: true, ...(existing?.source ? { source: existing.source } : {}) }); break;
    }
    case "save_work": {
      const existing = data.works.find(item => item.id === command.work.id);
      put(data.works, { ...command.work, userEdited: true, ...(existing?.source ? { source: existing.source } : {}) }); break;
    }
    case "set_connection": {
      if (command.connection.url) serviceLinkSchema.parse({ provider: command.connection.provider, url: command.connection.url });
      const connection: ArchiveConnection = { ...command.connection, status: command.connection.provider === "musicbrainz" ? "needs_configuration" : "link_only" };
      data.connections = [...data.connections.filter(item => item.provider !== connection.provider), connection]; break;
    }
    case "remove_connection": data.connections = data.connections.filter(item => item.provider !== command.provider); break;
    case "save_affiliation": put(data.affiliations, command.affiliation); break;
    case "resolve_conflict": {
      const conflict = getById(data.conflicts, command.conflictId);
      if (command.resolution === "accept") {
        const item = conflict.entityType === "release" ? getById(data.releases, conflict.entityId) : getById(data.tracks, conflict.entityId);
        const patch = { [conflict.field]: conflict.incoming === null ? undefined : conflict.incoming };
        if (conflict.entityType === "track") assertTrackIdentityChange(data, item as ArchiveTrack, patch);
        Object.assign(item, patch, { userEdited: true });
      }
      conflict.resolved = command.resolution; break;
    }
  }
  return validateArchiveData(data);
}

/** Scope is explicit: no status flows through a shared title, recording, work or merge. */
export function summarizeTasks(data: ArchiveData, options: { releaseId?: string; trackIds?: string[]; kind?: ArchiveTask["kind"]; agency?: string } = {}) {
  const releases = new Map(data.releases.map(release => [release.id, release]));
  const explicitTrackIds = options.trackIds ? new Set(options.trackIds) : null;
  const targetTracks = data.tracks.filter(track => track.managed && !track.excluded && !track.mergedInto && !releases.get(track.releaseId)?.excluded && !releases.get(track.releaseId)?.mergedInto && (!options.releaseId || track.releaseId === options.releaseId) && (!explicitTrackIds || explicitTrackIds.has(track.id)));
  const targetIds = new Set(targetTracks.map(track => track.id));
  const tasks = data.tasks.filter(task => targetIds.has(task.trackId) && (!options.kind || task.kind === options.kind) && (!options.agency || task.agency === options.agency));
  // Later records for exactly the same scope supersede earlier progress without erasing history.
  const current = new Map<string, ArchiveTask>();
  for (const task of tasks) current.set([task.trackId, task.kind, task.agency, task.participant ?? "", task.role ?? "", task.recordingId ?? "", task.workId ?? ""].join("\u0000"), task);
  const active = [...current.values()].filter(task => task.status !== "not_applicable");
  const covered = new Set([...current.values()].map(task => task.trackId));
  const completed = active.filter(task => task.status === "completed").length;
  const resultConfirmed = active.filter(task => task.result !== "unknown").length;
  const missingTracks = targetTracks.filter(track => !covered.has(track.id)).length;
  const unknown = active.filter(task => task.status === "needs_check" || task.result === "unknown").length + missingTracks;
  return { tracks: targetTracks.length, records: active.length, completed, resultConfirmed, unknown, notApplicable: current.size - active.length, missingTracks, total: active.length + missingTracks, allComplete: active.length > 0 && missingTracks === 0 && completed === active.length, needsChanges: active.filter(task => task.status === "needs_changes").length, awaitingResult: active.filter(task => ["submitted", "processing"].includes(task.status) && task.result === "unknown").length };
}

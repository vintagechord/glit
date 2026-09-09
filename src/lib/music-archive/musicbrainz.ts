/** Server adapter. No website scraping, audio, lyrics, images, tags, ratings or annotations. */
import { type ArtistCandidate, type ImportedRelease, type ImportedTrack, type MusicBrainzCursor, type MusicBrainzStep, isMusicBrainzId, isValidMusicBrainzUserAgent, parseMusicProviderUrl } from "./providers";
export type ProviderErrorCode = "configuration_required" | "permission_required" | "not_found" | "rate_limited" | "temporary_error" | "invalid_input" | "invalid_response";
export class MusicProviderError extends Error {
  constructor(public readonly code: ProviderErrorCode, message: string, public readonly retryAfterSeconds?: number) { super(message); this.name = "MusicProviderError"; }
}
export type MusicBrainzOptions = {
  env?: Record<string, string | undefined>; fetcher?: typeof fetch;
  /** Supply a DB-backed global 1 request/second permit in horizontally scaled workers. */
  acquirePermit?: () => Promise<void>; now?: () => number;
};
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const string = (value: unknown, max = 1000) => typeof value === "string" ? value.slice(0, max) : "";
const id = (value: unknown) => typeof value === "string" && isMusicBrainzId(value) ? value.toLowerCase() : null;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const credit = (value: unknown) => {
  const rows = list(value);
  return { name: rows.map((row) => string(row.name) + string(row.joinphrase)).join("").slice(0, 1000), ids: rows.map((row) => id(object(row.artist).id)).filter((value): value is string => !!value) };
};
let permitTail = Promise.resolve();
let lastRequestAt = 0;
async function localPermit() {
  const next = permitTail.then(async () => {
    const wait = Math.max(0, lastRequestAt + 1100 - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  permitTail = next.catch(() => {});
  await next;
}
function configuration(options: MusicBrainzOptions) {
  const env = options.env ?? process.env;
  if (env.MUSICBRAINZ_COMMERCIAL_USE_APPROVED !== "true") throw new MusicProviderError("permission_required", "MusicBrainz 상업적 API 이용 허가 확인이 필요합니다. 수동 관리 기능을 이용해 주세요.");
  const userAgent = env.MUSICBRAINZ_USER_AGENT ?? "";
  if (!isValidMusicBrainzUserAgent(userAgent)) throw new MusicProviderError("configuration_required", "MusicBrainz 서비스명·버전·연락처 User-Agent 설정이 필요합니다.");
  return userAgent;
}
async function request(path: string, params: Record<string, string>, options: MusicBrainzOptions): Promise<Json> {
  const userAgent = configuration(options);
  // Only code-generated paths, validated MBIDs and encoded query parameters reach the network.
  const url = new URL(`https://musicbrainz.org/ws/2/${path}`);
  url.search = new URLSearchParams({ ...params, fmt: "json" }).toString();
  await (options.acquirePermit ?? localPermit)();
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, { headers: { Accept: "application/json", "User-Agent": userAgent }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000) });
  } catch { throw new MusicProviderError("temporary_error", "MusicBrainz 연결이 일시적으로 중단되었습니다. 저장된 중단 지점에서 재시도할 수 있습니다.", 30); }
  if (!response.ok) {
    if (response.status === 404) throw new MusicProviderError("not_found", "MusicBrainz에 해당 식별자 검색 결과가 없습니다. 미등록 여부를 뜻하지 않습니다.");
    if ([401, 403].includes(response.status)) throw new MusicProviderError("permission_required", "MusicBrainz 접근 권한을 확인해야 합니다.");
    if (response.status === 429 || response.status >= 500) {
      const retry = response.headers.get("retry-after");
      const numeric = retry && /^\d+$/.test(retry) ? Number(retry) : null;
      const date = retry ? Date.parse(retry) : NaN;
      const seconds = numeric ?? (Number.isFinite(date) ? Math.ceil((date - (options.now?.() ?? Date.now())) / 1000) : 30);
      throw new MusicProviderError(response.status === 429 ? "rate_limited" : "temporary_error", response.status === 429 ? "MusicBrainz 호출 한도에 도달했습니다. 잠시 후 이어서 수집합니다." : "MusicBrainz 일시 오류입니다. 이어서 수집할 수 있습니다.", Math.min(86400, Math.max(2, seconds)));
    }
    throw new MusicProviderError("invalid_response", `MusicBrainz 요청이 거부되었습니다. (HTTP ${response.status})`);
  }
  if (Number(response.headers.get("content-length")) > 8_000_000) throw new MusicProviderError("invalid_response", "제공처 응답이 안전한 처리 크기를 초과했습니다. 수동으로 범위를 확인해 주세요.");
  // Stream with a hard byte ceiling; content-length can be absent or untrusted.
  const reader = response.body?.getReader();
  let raw = "";
  if (reader) {
    const decoder = new TextDecoder(); let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 8_000_000) { await reader.cancel(); throw new MusicProviderError("invalid_response", "제공처 응답이 안전한 처리 크기를 초과했습니다."); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  }
  try { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed as Json; }
  catch { throw new MusicProviderError("invalid_response", "MusicBrainz 응답 형식을 확인할 수 없습니다. 수집 완료로 처리하지 않았습니다."); }
}
function candidate(value: Json): ArtistCandidate {
  const externalId = id(value.id);
  if (!externalId || !string(value.name)) throw new MusicProviderError("invalid_response", "아티스트 후보의 식별 정보가 누락되었습니다.");
  return { provider: "musicbrainz", externalId, name: string(value.name), sortName: string(value["sort-name"]), disambiguation: string(value.disambiguation), country: string(value.country), type: string(value.type), url: `https://musicbrainz.org/artist/${externalId}`, imageUrl: null, representativeRelease: null };
}
export async function searchMusicBrainzArtists(query: string, options: MusicBrainzOptions & { offset?: number } = {}) {
  configuration(options);
  const value = query.trim();
  if (!value || value.length > 200 || !Number.isSafeInteger(options.offset ?? 0) || (options.offset ?? 0) < 0) throw new MusicProviderError("invalid_input", "200자 이내 아티스트 이름 또는 MusicBrainz 아티스트 URL/ID를 입력해 주세요.");
  const link = parseMusicProviderUrl(value, "artist");
  const checkedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  if (link?.provider === "musicbrainz") {
    const artist = candidate(await request(`artist/${link.externalId}`, {}, options));
    return { items: [artist], total: 1, nextOffset: null, checkedAt };
  }
  if (/^(?:https?:|spotify:)/i.test(value) || link) throw new MusicProviderError("invalid_input", "MusicBrainz 외 제공처 URL은 링크 연결 또는 직접 등록을 이용해 주세요.");
  // Treat Lucene syntax as literal text, preserving aliases/names without query injection.
  const escaped = value.replace(/[+\-!(){}\[\]^"~*?:\\/&|]/g, "\\$&");
  const offset = options.offset ?? 0;
  const data = await request("artist", { query: `artist:"${escaped}" OR alias:"${escaped}"`, limit: "20", offset: String(offset) }, options);
  const total = integer(data.count);
  if (total === null || !Array.isArray(data.artists)) throw new MusicProviderError("invalid_response", "검색 페이지와 전체 개수를 확인할 수 없습니다.");
  const items = list(data.artists).map(candidate);
  if (!items.length && offset < total) throw new MusicProviderError("invalid_response", "검색 중간 페이지가 비어 있습니다. 다시 조회해 주세요.");
  return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null, checkedAt };
}
function recordingWorks(recording: Json): NonNullable<ImportedTrack["works"]> {
  const roles = { lyricist: "lyrics", composer: "composition", arranger: "arrangement", "music arranger": "arrangement" } as const;
  return list(recording.relations).flatMap(relation => {
    const work = object(relation.work); const externalId = id(work.id); const title = string(work.title, 500);
    if (relation["target-type"] !== "work" || !externalId || !title) return [];
    const contributors = list(work.relations).flatMap(entry => {
      const role = roles[string(entry.type) as keyof typeof roles]; const name = string(object(entry.artist).name, 500).trim();
      return role && name ? [{ name, role }] : [];
    });
    return [{ externalId, title, contributors: contributors.filter((entry, index) => contributors.findIndex(item => item.name === entry.name && item.role === entry.role) === index).slice(0, 100), ...(Array.isArray(work.iswcs) && typeof work.iswcs[0] === "string" ? { iswc: work.iswcs[0].slice(0, 500) } : {}) }];
  });
}
export function normalizeMusicBrainzRelease(data: Json, artistId: string, checkedAt: string): ImportedRelease {
  const externalId = id(data.id);
  if (!externalId || !string(data.title) || !Array.isArray(data.media)) throw new MusicProviderError("invalid_response", "발매본의 식별 정보 또는 트랙 목록이 누락되었습니다.");
  const releaseCredit = credit(data["artist-credit"]);
  const group = object(data["release-group"]);
  const primary = string(group["primary-type"]).toLowerCase();
  const tracks: ImportedTrack[] = [];
  for (const medium of list(data.media)) {
    const rawTracks = list(medium.tracks);
    const expected = integer(medium["track-count"]);
    if (expected === null || rawTracks.length !== expected) throw new MusicProviderError("invalid_response", "발매본의 일부 트랙만 반환되었습니다. 미확인 범위를 남기고 재시도합니다.");
    const disc = integer(medium.position);
    if (!disc || tracks.length + rawTracks.length > 10000) throw new MusicProviderError("invalid_response", "디스크 번호 또는 트랙 수를 확인해 주세요.");
    for (const track of rawTracks) {
      const recording = object(track.recording);
      const trackId = id(track.id); const recordingId = id(recording.id);
      const position = integer(track.position); const title = string(track.title) || string(recording.title);
      if (!trackId || !position || !title) throw new MusicProviderError("invalid_response", "트랙 식별자·순서·제목이 누락되었습니다.");
      const trackCredit = credit(track["artist-credit"]);
      const recordingCredit = credit(recording["artist-credit"]);
      const actualCredit = trackCredit.ids.length ? trackCredit : recordingCredit;
      tracks.push({ works: recordingWorks(recording), externalId: trackId, recordingId, title, version: string(recording.disambiguation), artistName: actualCredit.name, artistIds: actualCredit.ids, position, discNumber: disc, durationMs: integer(track.length) ?? integer(recording.length), isrcs: Array.isArray(recording.isrcs) ? recording.isrcs.filter((value): value is string => typeof value === "string" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(value)) : [], managedByArtist: actualCredit.ids.includes(artistId), url: recordingId ? `https://musicbrainz.org/recording/${recordingId}` : `https://musicbrainz.org/release/${externalId}` });
    }
  }
  return { provider: "musicbrainz", externalId, title: string(data.title), date: string(data.date, 10), type: primary === "album" || primary === "ep" || primary === "single" ? primary : "other", secondaryTypes: Array.isArray(group["secondary-types"]) ? group["secondary-types"].filter((value): value is string => typeof value === "string").map((value) => value.slice(0, 100)) : [], participation: !releaseCredit.ids.includes(artistId), artistName: releaseCredit.name, artistIds: releaseCredit.ids, barcode: string(data.barcode, 30) || null, version: string(data.disambiguation), country: string(data.country, 10), tracks, url: `https://musicbrainz.org/release/${externalId}`, imageUrl: null, checkedAt };
}
const scopeNote = "MusicBrainz에 등록된 본인 명의 발매본과 트랙 크레딧 참여 발매본 범위입니다. 미등록 발매·세션 관계만 있는 참여·누락된 크레딧은 확인되지 않으며, 다른 제공처와 전곡 완전성은 확인하지 않았습니다.";
export async function collectMusicBrainzStep(artistId: string, cursor?: MusicBrainzCursor | null, options: MusicBrainzOptions = {}): Promise<MusicBrainzStep> {
  configuration(options);
  if (!isMusicBrainzId(artistId)) throw new MusicProviderError("invalid_input", "올바른 MusicBrainz 아티스트 ID가 필요합니다.");
  artistId = artistId.toLowerCase();
  const current: MusicBrainzCursor = cursor ? { ...cursor, pending: Array.isArray(cursor.pending) ? [...cursor.pending] : [] } : { version: 1, artistId, phase: "artist", offset: 0, pending: [] };
  if (current.version !== 1 || current.artistId !== artistId || !["artist", "track_artist", "done"].includes(current.phase) || !Number.isSafeInteger(current.offset) || current.offset < 0 || !Array.isArray(cursor?.pending ?? []) || current.pending.length > 100 || current.pending.some((value) => typeof value !== "string" || !isMusicBrainzId(value))) throw new MusicProviderError("invalid_input", "수집 재개 정보를 확인할 수 없습니다.");
  const checkedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  if (current.pending.length) {
    const releaseId = current.pending[0];
    const data = await request(`release/${releaseId}`, { inc: "recordings+artist-credits+release-groups+isrcs+recording-level-rels+work-level-rels+work-rels+artist-rels" }, options);
    const release = normalizeMusicBrainzRelease(data, artistId, checkedAt);
    if (release.externalId !== releaseId) throw new MusicProviderError("invalid_response", "요청한 발매본과 반환된 식별자가 다릅니다. 연결 확인이 필요합니다.");
    current.pending.shift();
    const done = !current.pending.length && current.phase === "done";
    return { releases: [release], nextCursor: done ? null : current, status: done ? "completed" : "collecting", checkedAt, scopeNote };
  }
  if (current.phase === "done") return { releases: [], nextCursor: null, status: "completed", checkedAt, scopeNote };
  const data = await request("release", { [current.phase]: artistId, limit: "100", offset: String(current.offset) }, options);
  const total = integer(data["release-count"]);
  if (total === null || !Array.isArray(data.releases)) throw new MusicProviderError("invalid_response", "발매본 페이지 또는 전체 개수를 확인할 수 없습니다.");
  const releases = list(data.releases);
  const ids = releases.map((value) => id(value.id));
  if (ids.some((value) => !value) || (!ids.length && current.offset < total)) throw new MusicProviderError("invalid_response", "발매본 페이지 일부가 누락되었습니다. 이어서 다시 확인해 주세요.");
  current.pending = ids as string[];
  current.total = total;
  current.offset += ids.length;
  if (current.offset >= total) { current.phase = current.phase === "artist" ? "track_artist" : "done"; current.offset = 0; delete current.total; }
  const done = current.phase === "done" && !current.pending.length;
  return { releases: [], nextCursor: done ? null : current, status: done ? "completed" : "collecting", checkedAt, scopeNote };
}

export async function lookupMusicBrainzRelease(releaseId: string, artistId: string, options: MusicBrainzOptions = {}) {
  if (!isMusicBrainzId(releaseId) || !isMusicBrainzId(artistId)) throw new MusicProviderError("invalid_input", "올바른 MusicBrainz 식별자가 필요합니다.");
  const data = await request(`release/${releaseId}`, { inc: "recordings+artist-credits+release-groups+isrcs+recording-level-rels+work-level-rels+work-rels+artist-rels" }, options);
  const result = normalizeMusicBrainzRelease(data, artistId, new Date(options.now?.() ?? Date.now()).toISOString());
  if (result.externalId !== releaseId) throw new MusicProviderError("invalid_response", "요청한 앨범 식별자와 응답이 다릅니다.");
  return result;
}

/** Official iTunes Search API metadata only; see docs/music-archive-apple.md. */
import type { ArtistCandidate, ImportedRelease, ImportedTrack } from "./providers";
import { MusicProviderError } from "./musicbrainz";

export type AppleArtistCandidate = Omit<ArtistCandidate, "provider"> & { provider: "apple" };
export type AppleImportedRelease = Omit<ImportedRelease, "provider"> & { provider: "apple" };
export type AppleAlbumMetadata = {
  id: string; title: string; artistId: string; artistName: string;
  date: string; trackCount: number; url: string; imageUrl?: string | null;
};
export type AppleCursor = {
  provider: "apple"; version: 1; artistId: string;
  phase: "albums" | "artist_songs" | "tracks" | "limited" | "done";
  pending: string[]; albums: AppleAlbumMetadata[]; linkedTrackIds: string[];
  limited: boolean; total?: number;
};
export type AppleStep = {
  releases: AppleImportedRelease[]; nextCursor: AppleCursor | null;
  status: "collecting" | "completed"; checkedAt: string; scopeNote: string;
};
export type AppleOptions = {
  fetcher?: typeof fetch; now?: () => number; signal?: AbortSignal;
  /** Production: one shared DB-backed slot every >=3.1 seconds across workers. */
  acquirePermit?: () => Promise<void>;
};
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown, max = 1000) => typeof value === "string" ? value.trim().normalize("NFC").slice(0, max) : "";
const identifier = (value: unknown): string | null => {
  const string = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return typeof string === "string" && /^[1-9]\d{0,15}$/.test(string) ? string : null;
};
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const invalid = (message: string): never => { throw new MusicProviderError("invalid_response", message); };
function requireId(value: string) {
  if (identifier(value) !== value) throw new MusicProviderError("invalid_input", "올바른 음악 카탈로그 아티스트 ID를 입력해 주세요.");
}
const base = "https://itunes.apple.com";
const limit = 200;
const maxBytes = 8_000_000;
export const APPLE_ARCHIVE_SCOPE = "조회 범위는 Apple 한국 카탈로그의 아티스트 앨범 목록과 동일 ID의 미국 카탈로그 트랙 정보입니다. API는 조회당 최대 200개이며 국내 모든 발매·참여곡, 삭제·비공개 자료의 전곡 여부는 보장하지 않습니다.";
let permitTail = Promise.resolve(); let lastRequestAt = 0;
async function localPermit() {
  const next = permitTail.then(async () => {
    const wait = Math.max(0, lastRequestAt + 3100 - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  permitTail = next.catch(() => {}); await next;
}
async function request(path: "search" | "lookup", params: Record<string, string>, options: AppleOptions): Promise<Json[]> {
  const url = new URL(`${base}/${path}`);
  url.search = new URLSearchParams(params).toString();
  if (options.signal?.aborted) throw new MusicProviderError("temporary_error", "음악 카탈로그 조회 시간이 초과되었습니다. 다시 시도해주세요.");
  await (options.acquirePermit ?? localPermit)();
  let response: Response;
  try {
    options.signal?.throwIfAborted();
    response = await (options.fetcher ?? fetch)(url, { cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(options.signal ? [options.signal] : [])]), headers: { Accept: "application/json", "User-Agent": "OnsideMusicArchive/1.0" } });
  } catch { throw new MusicProviderError("temporary_error", "음악 카탈로그 연결이 일시적으로 중단되었습니다. 중단 지점에서 재시도할 수 있습니다.", 30); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new MusicProviderError("not_found", "카탈로그에서 해당 자료를 찾지 못했습니다. 미등록 여부를 뜻하지 않습니다.");
    if ([401, 403].includes(response.status)) throw new MusicProviderError("permission_required", "음악 카탈로그 접근이 제한되었습니다.");
    if (response.status === 429 || response.status >= 500) {
      const retry = response.headers.get("retry-after") ?? "";
      const seconds = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - (options.now?.() ?? Date.now())) / 1000;
      throw new MusicProviderError(response.status === 429 ? "rate_limited" : "temporary_error", "음악 카탈로그 조회를 잠시 중단하고 이어서 재시도합니다.", Number.isFinite(seconds) ? Math.min(86400, Math.max(2, Math.ceil(seconds))) : 30);
    }
    invalid(`음악 카탈로그 요청이 거부되었습니다. (HTTP ${response.status})`);
  }
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); invalid("음악 카탈로그 응답 크기를 초과했습니다."); }
  const reader = response.body?.getReader();
  if (!reader) return invalid("음악 카탈로그 응답 본문이 없습니다.");
  const decoder = new TextDecoder(); let bytes = 0; let raw = "";
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); invalid("음악 카탈로그 응답 크기를 초과했습니다."); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof MusicProviderError) throw error;
    throw new MusicProviderError("temporary_error", "음악 카탈로그 응답 수신이 중단되었습니다. 중단 지점을 유지했습니다.", 30);
  } finally { reader.releaseLock(); }
  let parsed: Json;
  try { parsed = object(JSON.parse(raw)); } catch { return invalid("음악 카탈로그 응답 형식을 확인할 수 없습니다."); }
  if (!integer(parsed.resultCount) || !Array.isArray(parsed.results) || parsed.results.length !== parsed.resultCount || parsed.resultCount > 201 || parsed.results.some((row) => !row || typeof row !== "object" || Array.isArray(row))) invalid("음악 카탈로그 결과 개수 또는 형식이 일치하지 않습니다.");
  return (parsed.results as Json[]);
}
function storeLink(value: unknown, kind: "artist" | "album" | "song", id: string): string {
  try {
    const url = new URL(text(value, 2048));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["music.apple.com", "itunes.apple.com"].includes(url.hostname)) throw new Error();
    const segments = url.pathname.split("/").filter(Boolean);
    const pathId = segments.at(-1)?.replace(/^id/, "");
    const matching = kind === "song" ? (url.searchParams.get("i") === id || (segments.includes("song") && pathId === id)) : segments.includes(kind) && pathId === id;
    if (!matching) throw new Error();
    url.searchParams.delete("uo"); url.hash = "";
    return url.toString();
  } catch { return invalid("음악 카탈로그의 공식 링크와 식별자가 일치하지 않습니다."); }
}
function localizedArtistName(link: string, fallback: string) {
  if (/[가-힣]/.test(fallback)) return fallback;
  try {
    const parts = new URL(link).pathname.split("/");
    const slug = decodeURIComponent(parts[parts.indexOf("artist") + 1] ?? "").normalize("NFC");
    return /[가-힣]/.test(slug) ? slug.replaceAll("-", " ").slice(0, 500) : fallback;
  } catch { return fallback; }
}
function candidate(row: Json): AppleArtistCandidate {
  const externalId = identifier(row.artistId); const apiName = text(row.artistName, 500);
  if (row.wrapperType !== "artist" || row.artistType !== "Artist" || !externalId || !apiName) return invalid("음악 카탈로그 아티스트 식별 정보가 누락되었습니다.");
  const url = storeLink(row.artistLinkUrl, "artist", externalId);
  const name = localizedArtistName(url, apiName);
  return { provider: "apple", externalId, name, sortName: apiName, disambiguation: [text(row.primaryGenreName), apiName !== name ? apiName : ""].filter(Boolean).join(" · "), country: "", type: "", url, imageUrl: null, representativeRelease: null };
}
function responseArtist(rows: Json[], artistId: string) {
  const artists = rows.filter((row) => row.wrapperType === "artist");
  if (!rows.length) throw new MusicProviderError("not_found", "선택한 아티스트가 현재 카탈로그 조회 범위에 없습니다.");
  if (artists.length !== 1 || identifier(artists[0].artistId) !== artistId) invalid("음악 카탈로그 응답의 아티스트 ID가 일치하지 않습니다.");
  return candidate(artists[0]);
}
export async function lookupAppleArtist(artistId: string, options: AppleOptions = {}): Promise<AppleArtistCandidate> {
  requireId(artistId);
  return responseArtist(await request("lookup", { id: artistId, country: "KR" }, options), artistId);
}
/** offset is pagination within a <=200 result window; it is NOT an undocumented API offset. */
export async function searchAppleArtists(query: string, options: AppleOptions & { offset?: number; pageSize?: number } = {}) {
  const value = typeof query === "string" ? query.trim().normalize("NFC") : "";
  const offset = options.offset ?? 0;
  const pageSize = options.pageSize ?? 20;
  if (!value || value.length > 200 || /^(?:https?:|javascript:)/i.test(value) || !integer(offset) || offset >= limit || !integer(pageSize) || pageSize < 1 || pageSize > limit) throw new MusicProviderError("invalid_input", "200자 이내 아티스트 이름을 입력해 주세요.");
  const rows = await request("search", { term: value, country: "KR", media: "music", entity: "musicArtist", limit: String(limit) }, options);
  const artists = rows.map(candidate);
  if (artists.length > limit || new Set(artists.map((artist) => artist.externalId)).size !== artists.length) invalid("음악 카탈로그 검색 후보가 중복되거나 조회 한도를 초과했습니다.");
  const items = artists.slice(offset, offset + pageSize);
  return { items, total: artists.length, nextOffset: offset + items.length < artists.length ? offset + items.length : null, checkedAt: new Date(options.now?.() ?? Date.now()).toISOString(), limited: artists.length >= limit, scopeNote: "한국 카탈로그 검색 결과 최대 200개 중 확인한 후보입니다. 같은 이름은 ID와 장르를 확인해 선택해 주세요." };
}
function releaseDate(value: unknown) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || !Number.isFinite(Date.parse(raw))) return invalid("음악 카탈로그 발매일이 유효하지 않습니다.");
  const date = raw.slice(0, 10);
  if (new Date(date).toISOString().slice(0, 10) !== date) invalid("음악 카탈로그 발매일이 유효하지 않습니다.");
  return date;
}
/** Keep only the thumbnail URL supplied by Apple's public catalog, never image bytes. */
export function appleArtworkUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value, 2000));
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || !["mzstatic.com", "itunes.apple.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.protocol = "https:";
    return url.toString();
  } catch { return null; }
}
function albumMetadata(row: Json): AppleAlbumMetadata {
  const id = identifier(row.collectionId); const artistId = identifier(row.artistId);
  if (row.wrapperType !== "collection" || row.collectionType !== "Album" || !id || !artistId || !text(row.collectionName) || !text(row.artistName) || !integer(row.trackCount) || row.trackCount < 1 || row.trackCount > 10000) return invalid("음악 카탈로그 앨범의 필수 정보가 누락되었습니다.");
  return { id, title: text(row.collectionName), artistId, artistName: text(row.artistName), date: releaseDate(row.releaseDate), trackCount: row.trackCount, url: storeLink(row.collectionViewUrl, "album", id), imageUrl: appleArtworkUrl(row.artworkUrl100) ?? appleArtworkUrl(row.artworkUrl60) };
}
/** No audio preview or copyright text is retained; catalog track IDs are not ISRCs or recording IDs. */
export function normalizeAppleAlbum(rows: Json[], metadata: AppleAlbumMetadata, artistId: string, linkedTrackIds: readonly string[], checkedAt: string): AppleImportedRelease {
  requireId(artistId);
  const collections = rows.filter((row) => row.wrapperType === "collection");
  if (collections.length !== 1 || identifier(collections[0].collectionId) !== metadata.id) return invalid("선택한 앨범의 카탈로그 트랙 정보를 찾지 못했습니다. 기존 결과를 유지합니다.");
  const collection = albumMetadata(collections[0]);
  const songs = rows.filter((row) => row.wrapperType === "track" && row.kind === "song");
  if (rows.length !== songs.length + 1 || collection.trackCount !== metadata.trackCount || songs.length !== metadata.trackCount) invalid("카탈로그의 앨범 전체 트랙 수와 조회 결과가 다릅니다. 일부 트랙을 완료로 처리하지 않았습니다.");
  const linked = new Set(linkedTrackIds);
  const tracks: ImportedTrack[] = songs.map((row) => {
    const id = identifier(row.trackId); const primaryArtistId = identifier(row.artistId);
    if (!id || !primaryArtistId || identifier(row.collectionId) !== metadata.id || !text(row.trackName) || !text(row.artistName) || !integer(row.trackNumber) || row.trackNumber < 1 || !integer(row.discNumber) || row.discNumber < 1 || !integer(row.trackTimeMillis) || row.trackTimeMillis <= 0) return invalid("음악 카탈로그 트랙의 식별자·제목·순서·길이가 누락되었습니다.");
    const managedByArtist = primaryArtistId === artistId || linked.has(id);
    const artistIds = [...new Set([primaryArtistId, ...(managedByArtist ? [artistId] : [])])];
    return { externalId: id, recordingId: null, title: text(row.trackName), version: "", artistName: text(row.artistName), artistIds, position: row.trackNumber, discNumber: row.discNumber, durationMs: row.trackTimeMillis, isrcs: [], managedByArtist, url: storeLink(row.trackViewUrl, "song", id) };
  });
  if (new Set(tracks.map((track) => track.externalId)).size !== tracks.length || new Set(tracks.map((track) => `${track.discNumber}:${track.position}`)).size !== tracks.length) invalid("음악 카탈로그 앨범의 트랙 식별자 또는 순서가 중복되었습니다.");
  tracks.sort((a, b) => a.discNumber - b.discNumber || a.position - b.position);
  // Apple exposes only one primary artist ID. Exact artist-song lookup membership
  // supplies additional participation, never title/name substring matching.
  const participation = metadata.artistId !== artistId;
  return { provider: "apple", externalId: metadata.id, title: metadata.title, date: metadata.date, type: / - Single$/i.test(metadata.title) ? "single" : / - EP$/i.test(metadata.title) ? "ep" : "album", secondaryTypes: [], participation, artistName: metadata.artistName, artistIds: [...new Set([metadata.artistId, ...(tracks.some((track) => track.managedByArtist) ? [artistId] : [])])], barcode: null, version: "", country: "", tracks, url: metadata.url, imageUrl: metadata.imageUrl ?? collection.imageUrl ?? null, checkedAt };
}
function cursorFor(artistId: string, input?: AppleCursor | null): AppleCursor {
  if (!input) return { provider: "apple", version: 1, artistId, phase: "albums", pending: [], albums: [], linkedTrackIds: [], limited: false };
  if (input.provider !== "apple" || input.version !== 1 || input.artistId !== artistId || !["albums", "artist_songs", "tracks", "limited", "done"].includes(input.phase) || !Array.isArray(input.pending) || !Array.isArray(input.albums) || !Array.isArray(input.linkedTrackIds) || input.pending.length > limit || input.albums.length > limit || input.linkedTrackIds.length > limit || input.pending.some((id) => identifier(id) !== id) || input.linkedTrackIds.some((id) => identifier(id) !== id) || new Set(input.pending).size !== input.pending.length || new Set(input.linkedTrackIds).size !== input.linkedTrackIds.length || typeof input.limited !== "boolean" || (input.total !== undefined && (!integer(input.total) || input.total > limit))) throw new MusicProviderError("invalid_input", "음악 카탈로그 수집 중단 지점이 유효하지 않습니다.");
  const albums = input.albums.map((entry) => {
    const value = object(entry);
    return albumMetadata({ wrapperType: "collection", collectionType: "Album", collectionId: value.id, collectionName: value.title, artistId: value.artistId, artistName: value.artistName, releaseDate: `${value.date}T00:00:00Z`, trackCount: value.trackCount, collectionViewUrl: value.url, artworkUrl100: value.imageUrl });
  });
  if (new Set(albums.map((album) => album.id)).size !== albums.length || input.pending.some((id) => !albums.some((album) => album.id === id)) || (input.phase === "albums" && (albums.length || input.pending.length || input.linkedTrackIds.length)) || (["limited", "done"].includes(input.phase) && input.pending.length)) throw new MusicProviderError("invalid_input", "음악 카탈로그의 저장된 앨범 목록과 중단 지점이 일치하지 않습니다.");
  return { ...input, pending: [...input.pending], albums, linkedTrackIds: [...input.linkedTrackIds] };
}
/** Each step performs at most one public API read. Persist metadata and cursor atomically. */
export async function collectAppleStep(artistId: string, cursor?: AppleCursor | null, options: AppleOptions = {}): Promise<AppleStep> {
  requireId(artistId); const state = cursorFor(artistId, cursor);
  if (state.phase === "limited") throw new MusicProviderError("invalid_response", "현재 API의 200개 조회 한도에 도달했습니다. 불러온 자료는 보존했으며 전체 수집 완료로 표시하지 않았습니다.");
  const checkedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const releases: AppleImportedRelease[] = [];
  if (state.phase === "albums") {
    const rows = await request("lookup", { id: artistId, entity: "album", country: "KR", limit: String(limit) }, options);
    responseArtist(rows, artistId);
    const albums = rows.filter((row) => row.wrapperType === "collection").map(albumMetadata);
    if (rows.length !== albums.length + 1 || new Set(albums.map((album) => album.id)).size !== albums.length) invalid("음악 카탈로그 앨범 목록이 중복되거나 형식이 변경되었습니다.");
    state.albums = albums; state.pending = albums.map((album) => album.id); state.total = albums.length;
    state.limited = rows.length >= limit;
    state.phase = albums.length ? "artist_songs" : "done";
  } else if (state.phase === "artist_songs") {
    const rows = await request("lookup", { id: artistId, entity: "song", country: "US", limit: String(limit) }, options);
    responseArtist(rows, artistId);
    const songs = rows.filter((row) => row.wrapperType === "track" && row.kind === "song");
    if (rows.length !== songs.length + 1 || songs.some((row) => !identifier(row.trackId) || !identifier(row.collectionId))) invalid("음악 카탈로그의 참여곡 식별자를 확인할 수 없습니다.");
    state.linkedTrackIds = songs.map((row) => identifier(row.trackId)!);
    if (new Set(state.linkedTrackIds).size !== state.linkedTrackIds.length) invalid("음악 카탈로그의 참여곡 목록이 중복되었습니다.");
    state.limited ||= rows.length >= limit;
    state.phase = "tracks";
  } else if (state.phase === "tracks") {
    const albumId = state.pending[0];
    const metadata = state.albums.find((album) => album.id === albumId);
    if (!metadata) return invalid("음악 카탈로그 앨범의 저장된 식별 정보를 찾지 못했습니다.");
    const rows = await request("lookup", { id: albumId, entity: "song", country: "US", limit: String(limit) }, options);
    releases.push(normalizeAppleAlbum(rows, metadata, artistId, state.linkedTrackIds, checkedAt));
    state.pending.shift();
    if (!state.pending.length) state.phase = state.limited ? "limited" : "done";
  }
  const complete = state.phase === "done";
  return { releases, nextCursor: complete ? null : state, status: complete ? "completed" : "collecting", checkedAt, scopeNote: APPLE_ARCHIVE_SCOPE };
}

/** Re-fetch an existing album by its exact catalog ID, including artwork. */
export async function lookupAppleAlbum(albumId: string, artistId: string, options: AppleOptions = {}): Promise<AppleImportedRelease> {
  requireId(albumId); requireId(artistId);
  const rows = await request("lookup", { id: albumId, entity: "song", country: "US", limit: String(limit) }, options);
  const row = rows.find(row => row.wrapperType === "collection" && identifier(row.collectionId) === albumId);
  if (!row) return invalid("선택한 앨범의 카탈로그 정보를 찾지 못했습니다.");
  return normalizeAppleAlbum(rows, albumMetadata(row), artistId, [], new Date(options.now?.() ?? Date.now()).toISOString());
}

/** Artwork does not require an artist connection or the album's US track listing. */
export async function lookupAppleAlbumMetadata(albumId: string, options: AppleOptions = {}): Promise<AppleAlbumMetadata> {
  requireId(albumId);
  const rows = await request("lookup", { id: albumId, entity: "album", country: "KR", limit: "1" }, options);
  const row = rows.find(row => row.wrapperType === "collection" && identifier(row.collectionId) === albumId);
  if (!row) return invalid("선택한 앨범의 카탈로그 정보를 찾지 못했습니다.");
  return albumMetadata(row);
}

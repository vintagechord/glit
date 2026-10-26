/** Server-only metadata adapters. No audio downloads, playlist-as-album guesses or name-based ownership. */
import { z } from "zod";
import type { ArtistCandidate, ImportedRelease, ImportedTrack } from "./providers";
import { MusicProviderError } from "./musicbrainz";

export type StreamingProvider = "spotify" | "youtube";
export type StreamingOptions = {
  env?: Record<string, string | undefined>; fetcher?: typeof fetch;
  now?: () => number; signal?: AbortSignal; acquirePermit?: () => Promise<void>;
};
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown, max = 500) => typeof value === "string" ? value.trim().normalize("NFC").slice(0, max) : "";
const spotifyId = z.string().regex(/^[A-Za-z0-9]{22}$/);
const channelId = /^UC[A-Za-z0-9_-]{22}$/;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const invalid = (message = "음악 제공처의 응답을 확인할 수 없습니다. 다시 시도해주세요."): never => { throw new MusicProviderError("invalid_response", message); };
const checkedAt = (options: StreamingOptions) => new Date(options.now?.() ?? Date.now()).toISOString();
const SPOTIFY_SCOPE = "Spotify 한국 시장의 공개 앨범·싱글·참여 음반과 트랙입니다. 제공처 ID로 소속을 확인하며 삭제·비공개·지역 제한 자료는 포함되지 않을 수 있습니다.";
export const YOUTUBE_ARTIST_SCOPE = "YouTube 채널 검색 결과입니다. 본인의 공식 채널인지 직접 확인해주세요. 영상 게시일·재생목록은 앨범 발매 정보가 아니므로, 앨범은 멜론·지니·Spotify·Apple Music 연결에서 가져옵니다.";

async function readJson(url: URL, init: RequestInit, options: StreamingOptions, provider: StreamingProvider): Promise<Json> {
  await options.acquirePermit?.();
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(options.signal ? [options.signal] : [])]) });
  } catch { throw new MusicProviderError("temporary_error", "음악 제공처 연결이 중단되었습니다. 잠시 후 다시 시도해주세요.", 30); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw new MusicProviderError("not_found", "해당 제공처에서 자료를 찾지 못했습니다.");
    if (response.status === 401 || response.status === 403) throw new MusicProviderError("permission_required", `${provider === "spotify" ? "Spotify" : "YouTube"} API 접근 권한 또는 호출 한도를 확인해주세요.`);
    const retry = Number(response.headers.get("retry-after"));
    if (response.status === 429 || response.status >= 500) throw new MusicProviderError(response.status === 429 ? "rate_limited" : "temporary_error", "제공처 요청 한도 또는 일시 오류로 중단되었습니다. 이어서 시도할 수 있습니다.", Number.isFinite(retry) && retry > 0 ? Math.min(86400, retry) : 30);
    invalid();
  }
  const maxBytes = 2_000_000;
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); invalid("제공처 응답 크기를 초과했습니다."); }
  const reader = response.body?.getReader();
  if (!reader) return invalid();
  const decoder = new TextDecoder(); let raw = ""; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); invalid("제공처 응답 크기를 초과했습니다."); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof MusicProviderError) throw error;
    throw new MusicProviderError("temporary_error", "제공처 응답 수신이 중단되었습니다.", 30);
  } finally { reader.releaseLock(); }
  try {
    const result: unknown = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result)) return invalid();
    return result as Json;
  } catch { return invalid(); }
}

let tokenCache: { identity: string; token: string; expiresAt: number } | undefined;
async function spotifyToken(options: StreamingOptions) {
  const env = options.env ?? process.env;
  const client = env.SPOTIFY_CLIENT_ID?.trim(); const secret = env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!client || !secret) throw new MusicProviderError("configuration_required", "Spotify 검색을 사용하려면 서버의 API 연결 설정이 필요합니다. 다른 제공처로 검색할 수 있습니다.");
  const identity = `${client}:${secret}`;
  const now = options.now?.() ?? Date.now();
  // Test transports never read or populate the process-wide credential cache.
  if (!options.fetcher && tokenCache?.identity === identity && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
  const data = await readJson(new URL("https://accounts.spotify.com/api/token"), {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(identity).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }, options, "spotify");
  const token = text(data.access_token, 5000); const expires = integer(data.expires_in);
  if (!token || /[\r\n]/.test(token) || !expires) return invalid();
  if (!options.fetcher) tokenCache = { identity, token, expiresAt: now + expires * 1000 };
  return token;
}
async function spotifyRequest(path: string, params: Record<string, string>, options: StreamingOptions) {
  const token = await spotifyToken(options);
  const url = new URL(`https://api.spotify.com/v1/${path}`); url.search = new URLSearchParams(params).toString();
  try { return await readJson(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, options, "spotify"); }
  catch (error) { if (!options.fetcher && error instanceof MusicProviderError && error.code === "permission_required") tokenCache = undefined; throw error; }
}
async function youtubeRequest(path: "search" | "channels", params: Record<string, string>, options: StreamingOptions) {
  const key = (options.env ?? process.env).YOUTUBE_DATA_API_KEY?.trim();
  if (!key) throw new MusicProviderError("configuration_required", "YouTube 채널 검색을 사용하려면 서버의 API 연결 설정이 필요합니다. 다른 제공처로 검색할 수 있습니다.");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`); url.search = new URLSearchParams(params).toString();
  // Keep the API key out of URLs, logs, responses and persisted source data.
  return readJson(url, { headers: { "X-Goog-Api-Key": key, Accept: "application/json" } }, options, "youtube");
}
function imageUrl(value: unknown, hosts: string[]) {
  try { const url = new URL(text(value, 2000)); return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.href : null; } catch { return null; }
}
function candidate(provider: StreamingProvider, item: Json): ArtistCandidate {
  const snippet = object(item.snippet);
  const externalId = provider === "spotify" ? text(item.id) : text(typeof item.id === "string" ? item.id : object(item.id).channelId);
  const name = text(provider === "spotify" ? item.name : snippet.title);
  if (!name || !(provider === "spotify" ? spotifyId.safeParse(externalId).success : channelId.test(externalId))) return invalid();
  const thumb = object(object(snippet.thumbnails).medium);
  return {
    provider, externalId, name, sortName: name, country: provider === "youtube" ? text(snippet.country) : "",
    type: provider === "spotify" ? "아티스트" : "YouTube 채널 · 공식 여부 확인 필요",
    disambiguation: provider === "spotify" ? (Array.isArray(item.genres) ? item.genres.filter(value => typeof value === "string").join(" · ").slice(0, 500) : "") : text(snippet.description),
    url: provider === "spotify" ? `https://open.spotify.com/artist/${externalId}` : `https://www.youtube.com/channel/${externalId}`,
    imageUrl: provider === "spotify" ? imageUrl(object(Array.isArray(item.images) ? item.images[0] : null).url, ["scdn.co", "spotifycdn.com"]) : imageUrl(thumb.url, ["ytimg.com", "ggpht.com", "googleusercontent.com"]),
    representativeRelease: null,
  };
}
export async function searchStreamingArtists(provider: StreamingProvider, query: string, options: StreamingOptions = {}) {
  const q = query.trim();
  if (!q || q.length > 200) throw new MusicProviderError("invalid_input", "아티스트 이름을 200자 이내로 입력해주세요.");
  const data = provider === "spotify" ? object((await spotifyRequest("search", { q, type: "artist", market: "KR", limit: "10" }, options)).artists)
    : await youtubeRequest("search", { q, part: "snippet", type: "channel", maxResults: "10", relevanceLanguage: "ko" }, options);
  if (!Array.isArray(data.items) || data.items.length > 10) return invalid();
  const items = data.items.map(item => candidate(provider, object(item)));
  return { items, total: items.length, nextOffset: null, checkedAt: checkedAt(options), scopeNote: provider === "youtube" ? YOUTUBE_ARTIST_SCOPE : "Spotify 검색 상위 10개 후보입니다. 동명이인은 공식 페이지를 비교해주세요." };
}
export async function lookupStreamingArtist(provider: StreamingProvider, id: string, options: StreamingOptions = {}) {
  if (!(provider === "spotify" ? spotifyId.safeParse(id).success : channelId.test(id))) throw new MusicProviderError("invalid_input", "올바른 아티스트 또는 채널 ID가 필요합니다.");
  const data = provider === "spotify" ? await spotifyRequest(`artists/${id}`, {}, options) : await youtubeRequest("channels", { id, part: "snippet" }, options);
  const row = provider === "spotify" ? data : object(Array.isArray(data.items) ? data.items[0] : null);
  if (!row.id) throw new MusicProviderError("not_found", "선택한 아티스트를 찾지 못했습니다.");
  const result = candidate(provider, row);
  if (result.externalId !== id) return invalid("선택한 아티스트 ID와 제공처 응답이 다릅니다.");
  return result;
}

export type StreamingCursor = {
  provider: "spotify"; version: 1; artistId: string; phase: "albums" | "album" | "tracks" | "done";
  offset: number; nextAlbumOffset: number | null; pending: string[];
  active?: { release: ImportedRelease; offset: number; total: number };
};
export type StreamingStep = { releases: ImportedRelease[]; nextCursor: StreamingCursor | null; status: "collecting" | "completed"; checkedAt: string; scopeNote: string };
/** Spotify dates have year, month or day precision; keep only real calendar dates. */
function validReleaseDate(value: string) {
  if (!/^\d{4}(?:-\d{2}){0,2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return false;
  if (month === undefined) return true;
  if (month < 1 || month > 12) return false;
  if (day === undefined) return true;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}
const metadataText = z.string().min(1).max(500).refine(value => value === value.trim());
const artistIdsSchema = z.array(spotifyId).min(1).max(1000);
const trackSchema = z.object({
  externalId: spotifyId, recordingId: spotifyId, title: metadataText, version: z.literal(""),
  artistName: metadataText, artistIds: artistIdsSchema,
  position: z.number().int().min(1).max(10000), discNumber: z.number().int().min(1).max(1000),
  durationMs: z.number().int().min(0).nullable(), isrcs: z.array(z.string()).length(0),
  managedByArtist: z.boolean(), url: z.string(),
}).strict().refine(track => track.recordingId === track.externalId && track.url === `https://open.spotify.com/track/${track.externalId}`);
const releaseSchema = z.object({
  provider: z.literal("spotify"), externalId: spotifyId, title: metadataText,
  date: z.string().refine(value => value === "" || validReleaseDate(value)),
  type: z.enum(["album", "single", "other"]), secondaryTypes: z.array(z.string()).length(0),
  participation: z.boolean(), artistName: metadataText, artistIds: artistIdsSchema,
  barcode: z.string().max(500).nullable(), version: z.literal(""), country: z.literal("KR"),
  tracks: z.array(trackSchema).max(1000), url: z.string(),
  imageUrl: z.string().max(2000).refine(value => imageUrl(value, ["scdn.co", "spotifycdn.com"]) === value).nullable(),
  checkedAt: z.string().datetime({ offset: true }),
}).strict().refine(release => release.url === `https://open.spotify.com/album/${release.externalId}` && new Set(release.tracks.map(track => track.externalId)).size === release.tracks.length);
function artistScopeMatches(release: ImportedRelease, artistId: string) {
  return release.participation === !release.artistIds.includes(artistId) && release.tracks.every(track => track.managedByArtist === track.artistIds.includes(artistId));
}
const cursorSchema = z.object({
  provider: z.literal("spotify"), version: z.literal(1), artistId: spotifyId,
  phase: z.enum(["albums", "album", "tracks", "done"]),
  offset: z.number().int().min(0).max(10000), nextAlbumOffset: z.number().int().min(0).max(10000).nullable(),
  pending: z.array(spotifyId).max(50).refine(ids => new Set(ids).size === ids.length),
  active: z.object({ release: releaseSchema, offset: z.number().int().min(1).max(999), total: z.number().int().min(1).max(1000) }).strict().optional(),
}).strict().superRefine((cursor, context) => {
  const mismatch = () => context.addIssue({ code: "custom", message: "수집 단계와 저장된 앨범·트랙 위치가 다릅니다." });
  if (cursor.phase === "albums") {
    if (cursor.pending.length || cursor.active || (cursor.nextAlbumOffset !== null && cursor.nextAlbumOffset !== cursor.offset)) mismatch();
  } else if (cursor.phase === "done") {
    if (cursor.pending.length || cursor.active || cursor.nextAlbumOffset !== null) mismatch();
  } else {
    if (!cursor.pending.length || (cursor.nextAlbumOffset !== null && cursor.nextAlbumOffset <= cursor.offset)) mismatch();
    if (cursor.phase === "album" && cursor.active) mismatch();
    if (cursor.phase === "tracks") {
      const active = cursor.active;
      if (!active || active.release.externalId !== cursor.pending[0] || active.release.tracks.length !== active.offset || active.offset >= active.total || !artistScopeMatches(active.release, cursor.artistId)) mismatch();
    }
  }
});
function pageItems(data: Json, offset: number) {
  const total = integer(data.total);
  if (!Array.isArray(data.items) || data.items.length > 50 || total === null || integer(data.offset) !== offset) return invalid("앨범·트랙 페이지 범위를 확인할 수 없습니다.");
  if ((!data.items.length && offset < total) || offset + data.items.length > total) return invalid("앨범·트랙 목록이 불완전하여 수집을 완료하지 않았습니다.");
  return { items: data.items.map(object), total, next: offset + data.items.length < total ? offset + data.items.length : null };
}
function artistCredits(value: unknown) {
  if (!Array.isArray(value) || !value.length) return invalid("아티스트 소속 정보가 없습니다.");
  const items = value.map(object);
  if (items.some(item => !spotifyId.safeParse(item.id).success || !text(item.name))) return invalid();
  return { artistIds: items.map(item => String(item.id)), artistName: items.map(item => text(item.name)).join(", ").slice(0, 500) };
}
function track(item: Json, artistId: string): ImportedTrack {
  const externalId = text(item.id); const title = text(item.name); const position = integer(item.track_number); const disc = integer(item.disc_number);
  if (!spotifyId.safeParse(externalId).success || !title || !position || !disc) return invalid("트랙 식별 정보가 누락되었습니다.");
  const credits = artistCredits(item.artists);
  return { externalId, recordingId: externalId, title, version: "", ...credits, position, discNumber: disc, durationMs: integer(item.duration_ms), isrcs: [], managedByArtist: credits.artistIds.includes(artistId), url: `https://open.spotify.com/track/${externalId}` };
}
function finishAlbum(cursor: StreamingCursor) {
  cursor.pending.shift(); delete cursor.active;
  if (cursor.pending.length) cursor.phase = "album";
  else if (cursor.nextAlbumOffset !== null) { cursor.phase = "albums"; cursor.offset = cursor.nextAlbumOffset; }
  else cursor.phase = "done";
}
/** Each durable step reads one album page, one album or one track page. Never follows remote next URLs. */
export async function collectStreamingStep(provider: "spotify", artistId: string, saved: StreamingCursor | null, options: StreamingOptions = {}): Promise<StreamingStep> {
  if (provider !== "spotify" || !spotifyId.safeParse(artistId).success) throw new MusicProviderError("invalid_input", "Spotify 아티스트 ID를 확인해주세요.");
  let cursor: StreamingCursor;
  if (saved) {
    const parsed = cursorSchema.safeParse(saved);
    if (!parsed.success || parsed.data.artistId !== artistId) throw new MusicProviderError("invalid_input", "수집 대상 또는 이어서 불러올 위치가 다릅니다.");
    cursor = structuredClone(parsed.data);
  } else cursor = { provider, version: 1, artistId, phase: "albums", offset: 0, nextAlbumOffset: null, pending: [] };
  const date = checkedAt(options); const releases: ImportedRelease[] = [];
  if (cursor.phase === "albums") {
    const page = pageItems(await spotifyRequest(`artists/${artistId}/albums`, { market: "KR", include_groups: "album,single,appears_on,compilation", limit: "50", offset: String(cursor.offset) }, options), cursor.offset);
    if (page.total > 10000 || page.items.some(item => !spotifyId.safeParse(item.id).success)) return invalid("앨범 수집 범위 또는 식별자를 확인해주세요.");
    cursor.pending = [...new Set(page.items.map(item => String(item.id)))]; cursor.nextAlbumOffset = page.next;
    cursor.phase = cursor.pending.length ? "album" : "done";
  } else if (cursor.phase === "album") {
    const id = cursor.pending[0]; if (!id) return invalid();
    const album = await spotifyRequest(`albums/${id}`, { market: "KR" }, options);
    if (album.id !== id || !text(album.name)) return invalid();
    const credits = artistCredits(album.artists);
    const page = pageItems(object(album.tracks), 0);
    if (page.total > 1000 || integer(album.total_tracks) !== page.total) return invalid("앨범 전체 트랙 수를 확인할 수 없습니다.");
    const release: ImportedRelease = {
      provider, externalId: id, title: text(album.name), date: validReleaseDate(text(album.release_date)) ? text(album.release_date) : "",
      type: album.album_type === "single" ? "single" : album.album_type === "album" ? "album" : "other", secondaryTypes: [],
      participation: !credits.artistIds.includes(artistId), ...credits, barcode: text(object(album.external_ids).upc) || null, version: "", country: "KR",
      tracks: page.items.map(item => track(item, artistId)), url: `https://open.spotify.com/album/${id}`,
      imageUrl: imageUrl(object(Array.isArray(album.images) ? album.images[0] : null).url, ["scdn.co", "spotifycdn.com"]), checkedAt: date,
    };
    if (page.next !== null) { cursor.active = { release, offset: page.next, total: page.total }; cursor.phase = "tracks"; }
    else { releases.push(release); finishAlbum(cursor); }
  } else if (cursor.phase === "tracks") {
    const active = cursor.active;
    if (!active || active.release.externalId !== cursor.pending[0] || active.release.tracks.length !== active.offset) return invalid("트랙 수집 위치를 확인할 수 없습니다.");
    const page = pageItems(await spotifyRequest(`albums/${cursor.pending[0]}/tracks`, { market: "KR", limit: "50", offset: String(active.offset) }, options), active.offset);
    if (page.total !== active.total) return invalid("수집 중 앨범 트랙 목록이 변경되었습니다. 새로 불러와주세요.");
    active.release.tracks.push(...page.items.map(item => track(item, artistId)));
    if (page.next !== null) active.offset = page.next;
    else { active.release.checkedAt = date; releases.push(active.release); finishAlbum(cursor); }
  }
  for (const release of releases) {
    if (!releaseSchema.safeParse(release).success || !artistScopeMatches(release, artistId) || (!release.artistIds.includes(artistId) && !release.tracks.some(item => item.managedByArtist))) return invalid("선택한 아티스트의 트랙 소속 또는 중복 정보를 확인할 수 없습니다.");
  }
  if (!cursorSchema.safeParse(cursor).success) return invalid("수집한 앨범·트랙 범위를 저장할 수 없습니다.");
  return { releases, nextCursor: cursor.phase === "done" ? null : cursor, status: cursor.phase === "done" ? "completed" : "collecting", checkedAt: date, scopeNote: SPOTIFY_SCOPE };
}

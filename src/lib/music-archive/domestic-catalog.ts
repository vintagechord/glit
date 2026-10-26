import { z } from "zod";
import { parseMelonAlbumPage } from "@/lib/melon";
import { parseGenieAlbumPage } from "@/lib/genie";
import { domesticAlbumArtwork } from "./domestic-credits";
import { MusicProviderError } from "./musicbrainz";
import type { ArtistCandidate, ImportedRelease } from "./providers";

export type DomesticProvider = "melon" | "genie";
type Options = { fetcher?: typeof fetch; signal?: AbortSignal; acquirePermit?: () => Promise<void>; now?: () => number };
const digits = z.string().regex(/^[1-9]\d{0,19}$/);
const cursorSchema = z.object({
  provider: z.enum(["melon", "genie"]), version: z.literal(1), artistId: digits,
  page: z.number().int().min(1).max(501), pending: z.array(digits).max(30),
  seen: z.array(digits).max(5000), more: z.boolean(), phase: z.enum(["albums", "tracks", "done"]),
});
export type DomesticCursor = z.infer<typeof cursorSchema>;
const origin = (provider: DomesticProvider) => provider === "melon" ? "https://www.melon.com" : "https://www.genie.co.kr";
const label = (provider: DomesticProvider) => provider === "melon" ? "멜론" : "지니뮤직";
const invalid = (message: string): never => { throw new MusicProviderError("invalid_response", message); };
function requireId(id: string) { if (!digits.safeParse(id).success) throw new MusicProviderError("invalid_input", "아티스트 식별자가 올바르지 않습니다."); }
function decode(value: string) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
    const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, name: string) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " })[name.toLowerCase()] ?? "");
}
const plain = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().normalize("NFC").slice(0, 500);
function artwork(value: string | undefined, provider: DomesticProvider) {
  if (!value) return null;
  try {
    const url = new URL(decode(value), origin(provider));
    const hosts = provider === "melon" ? ["melon.com", "melon.co.kr"] : ["genie.co.kr"];
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.protocol = "https:"; return url.toString();
  } catch { return null; }
}
export function domesticArtistUrl(provider: DomesticProvider, id: string) {
  requireId(id);
  return provider === "melon" ? `${origin(provider)}/artist/timeline.htm?artistId=${id}` : `${origin(provider)}/detail/artistInfo?xxnm=${id}`;
}
function albumUrl(provider: DomesticProvider, id: string) {
  requireId(id);
  return provider === "melon" ? `${origin(provider)}/album/detail.htm?albumId=${id}` : `${origin(provider)}/detail/albumInfo?axnm=${id}`;
}
async function request(provider: DomesticProvider, path: string, params: Record<string, string>, options: Options, post = false) {
  const allowed = provider === "melon" ? ["/search/artist/index.htm", "/artist/album.htm", "/artist/albumPaging.htm", "/album/detail.htm"] : ["/search/searchArtist", "/detail/artistInfo", "/detail/artistAlbum", "/detail/bArtistAlbumList", "/detail/albumInfo"];
  if (!allowed.includes(path)) throw new MusicProviderError("invalid_input", "지원하지 않는 음악 페이지입니다.");
  await options.acquirePermit?.();
  const url = new URL(path, origin(provider));
  const body = new URLSearchParams(params).toString();
  if (!post) url.search = body;
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      method: post ? "POST" : "GET", ...(post ? { body } : {}), redirect: "error", cache: "no-store",
      signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(options.signal ? [options.signal] : [])]),
      headers: { Accept: "text/html", "Accept-Language": "ko-KR,ko;q=0.9", "User-Agent": "Mozilla/5.0 OnsideMusicArchive/1.0", ...(post ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    });
  } catch { throw new MusicProviderError("temporary_error", `${label(provider)} 연결을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.`, 30); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MusicProviderError(response.status === 429 ? "rate_limited" : [401, 403].includes(response.status) ? "permission_required" : "temporary_error", `${label(provider)}에서 조회를 완료하지 못했습니다. (${response.status})`, 30);
  }
  const reader = response.body?.getReader(); if (!reader) return invalid("음악 페이지 응답이 비어 있습니다.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 3_000_000) { await reader.cancel(); return invalid("음악 페이지 크기 제한을 초과했습니다."); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const html = Buffer.concat(chunks).toString("utf8");
  if (/captcha|access denied|비정상적인 접근|접근이 제한/i.test(html)) throw new MusicProviderError("permission_required", `${label(provider)}의 공개 페이지 접근이 제한되었습니다. 공식 사이트에서 확인해주세요.`);
  return html;
}

/** Parse only the search result container, excluding trending/recommended artists. */
export function parseDomesticArtistSearch(provider: DomesticProvider, html: string): ArtistCandidate[] {
  const section = provider === "melon" ? html.match(/<div class="list_atist[^>]*>([\s\S]*?)<\/ul>/)?.[1] : html.match(/<!-- S\. artist List -->([\s\S]*?)<!-- E\. div class="artist-type-1"/i)?.[1];
  if (!section) {
    if (/검색\s*결과가?\s*없|검색된\s*(아티스트|결과)가?\s*없|검색결과가 없습니다/.test(plain(html))) return [];
    return invalid(`${label(provider)} 검색 결과 구조를 확인하지 못했습니다. 공식 사이트 검색을 이용해주세요.`);
  }
  const blocks = provider === "melon" ? [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(match => match[1]) : section.split(/<div class="artist-item">/).slice(1);
  const candidates: ArtistCandidate[] = [];
  for (const block of blocks) {
    const id = (provider === "melon" ? block.match(/goArtistDetail\(['"](\d+)['"]/): block.match(/fnViewArtist\(['"]?(\d+)/))?.[1];
    const rawName = provider === "melon" ? block.match(/<a\b[^>]*class="ellipsis"[^>]*>([\s\S]*?)<\/a>/)?.[1] : block.match(/<span class="artist">\s*<a\b[^>]*>([\s\S]*?)<\/a>/)?.[1];
    if (!id || !digits.safeParse(id).success || !rawName) continue;
    const name = plain(rawName); if (!name || candidates.some(item => item.externalId === id)) continue;
    const description = plain(block.match(/<(?:dd|span) class="(?:gubun|nationality)"[^>]*>([\s\S]*?)<\/(?:dd|span)>/)?.[1] ?? "");
    candidates.push({ provider, externalId: id, name, sortName: name, disambiguation: description, country: "", type: "", url: domesticArtistUrl(provider, id), imageUrl: artwork(block.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1], provider), representativeRelease: null });
  }
  return candidates.slice(0, 20);
}
export async function searchDomesticArtists(provider: DomesticProvider, query: string, options: Options = {}) {
  if (!query.trim() || query.length > 200) throw new MusicProviderError("invalid_input", "200자 이내 아티스트 이름을 입력해주세요.");
  const html = await request(provider, provider === "melon" ? "/search/artist/index.htm" : "/search/searchArtist", provider === "melon" ? { q: query.trim() } : { query: query.trim() }, options);
  const items = parseDomesticArtistSearch(provider, html);
  return { items, total: items.length, nextOffset: null, checkedAt: new Date(options.now?.() ?? Date.now()).toISOString(), scopeNote: `${label(provider)} 공개 검색 첫 페이지에서 최대 20명을 확인했습니다. 같은 이름은 원본 프로필을 확인한 뒤 선택해주세요.` };
}
export async function lookupDomesticArtist(provider: DomesticProvider, id: string, options: Options = {}): Promise<ArtistCandidate> {
  requireId(id);
  const html = await request(provider, provider === "melon" ? "/artist/album.htm" : "/detail/artistInfo", provider === "melon" ? { artistId: id } : { xxnm: id }, options);
  const name = plain(provider === "melon" ? html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)?.[1] ?? "" : html.match(/<h2 class="name"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "");
  const identity = provider === "melon" ? new RegExp(`(?:artistId[=\\"': ]+|data-artist-no=\")${id}(?:[\\"'&; ]|$)`) : new RegExp(`fnViewArtist\\(['\"]?${id}['\"]?\\)`);
  if (!name || !identity.test(html)) return invalid("선택한 아티스트의 이름과 식별자를 확인하지 못했습니다.");
  return { provider, externalId: id, name, sortName: name, disambiguation: "", country: "", type: "", url: domesticArtistUrl(provider, id), imageUrl: artwork(html.match(/<meta\s+property="og:image(?::secure_url)?"\s+content="([^"]+)"/)?.[1], provider), representativeRelease: null };
}

export function parseDomesticAlbumIds(provider: DomesticProvider, html: string) {
  // Artist lists contain nested artist popovers (<ul>), so the first closing
  // </ul> is not the end of the album list. Stop at its following script instead.
  const start = provider === "melon" ? html.search(/<div class="list_album/) : html.search(/<div class="artist-album-list"/);
  if (start < 0) return invalid("아티스트 앨범 목록 영역을 확인하지 못했습니다. 기존 자료는 유지됩니다.");
  const source = html.slice(start).split(/<script\b/i)[0];
  const pattern = provider === "melon" ? /goAlbumDetail\(['"](\d+)['"]\)/g : /fnViewAlbumLayer\(['"](\d+)['"]\)/g;
  const ids = [...new Set([...source.matchAll(pattern)].map(match => match[1]))];
  if (ids.length > 30) return invalid("앨범 목록의 페이지 크기를 확인하지 못했습니다.");
  if (!ids.length && !/등록된\s*앨범|앨범[\s\S]{0,30}없|발매[\s\S]{0,20}없/.test(plain(html))) return invalid("앨범 목록 구조를 확인하지 못했습니다. 기존 자료는 유지됩니다.");
  return ids;
}
export function normalizeDomesticAlbum(provider: DomesticProvider, html: string, albumId: string, artistId: string, checkedAt: string): ImportedRelease {
  requireId(albumId); requireId(artistId);
  const album = (provider === "melon" ? parseMelonAlbumPage : parseGenieAlbumPage)(html, albumId);
  if (!album.albumTitle || !album.tracks.length || album.tracks.length > 500) return invalid("앨범명과 수록곡을 확인하지 못했습니다. 완료 처리하지 않았습니다.");
  const rows = [...html.matchAll(provider === "melon" ? /<tr data-group-items="cd\d+">[\s\S]*?<\/tr>/g : /<tr class="list"[\s\S]*?<\/tr>/g)].map(match => match[0]);
  const rowById = new Map(rows.map(row => [provider === "melon" ? row.match(/goSongDetail\(['"](\d+)['"]\)/)?.[1] ?? row.match(/name="input_check"\s+value="(\d+)"/)?.[1] : row.match(/songId=["']\s*(\d+)\s*["']/i)?.[1] ?? row.match(/fnViewSongInfo\((\d+)\)/)?.[1], row]));
  if (rows.length !== album.tracks.length || rowById.size !== rows.length || rowById.has(undefined) || album.tracks.some(track => !rowById.has(track.songId))) return invalid("앨범의 전체 수록곡과 조회한 곡 목록이 다릅니다. 누락된 곡을 완료 처리하지 않았습니다.");
  const tracks = album.tracks.map(track => {
    const row = rowById.get(track.songId)!;
    const ids = [...new Set([...(row ?? "").matchAll(provider === "melon" ? /goArtistDetail\(['"](\d+)['"]/g : /fnViewArtist\(['"]?(\d+)/g)].map(match => match[1]))];
    const disc = provider === "melon" ? Number(row?.match(/data-group-items="cd(\d+)"/)?.[1] ?? 1) : 1;
    return { externalId: track.songId, recordingId: null, title: track.trackTitle.slice(0, 500), version: "", artistName: track.artistName.slice(0, 500), artistIds: ids, position: track.trackNo, discNumber: Math.max(1, disc), durationMs: null, isrcs: [], managedByArtist: ids.includes(artistId), url: track.songUrl };
  });
  if (new Set(tracks.map(track => track.externalId)).size !== tracks.length || !tracks.some(track => track.managedByArtist)) return invalid("선택한 아티스트의 수록곡 식별자를 확인하지 못했습니다. 다른 아티스트의 곡은 자동 연결하지 않습니다.");
  const info = provider === "melon" ? html.match(/<div class="section_info">([\s\S]*?)<div class="button d_album_like">/)?.[1] ?? "" : html.match(/<div class="album-detail-infos">([\s\S]*?)<!-- E\. 앨범 기본 정보/)?.[1] ?? "";
  const primaryIds = [...info.matchAll(provider === "melon" ? /goArtistDetail\(['"](\d+)['"]/g : /(?:fnViewArtist\(['"]?|fnGoMore\(['"]artistInfo['"],['"])(\d+)/g)].map(match => match[1]);
  return { provider, externalId: albumId, title: album.albumTitle.slice(0, 500), date: album.releaseDate, type: /싱글|single/i.test(album.albumType) ? "single" : /EP|미니/i.test(album.albumType) ? "ep" : /정규|album/i.test(album.albumType) ? "album" : "other", secondaryTypes: [], participation: !primaryIds.includes(artistId), artistName: album.artistName.slice(0, 500), artistIds: [...new Set(primaryIds)], barcode: null, version: "", country: "KR", tracks, url: albumUrl(provider, albumId), imageUrl: domesticAlbumArtwork(html, albumUrl(provider, albumId)), checkedAt };
}
/** One bounded public page per durable step. No audio or lyrics are collected. */
export async function collectDomesticStep(provider: DomesticProvider, artistId: string, input: DomesticCursor | null, options: Options = {}) {
  requireId(artistId);
  const parsed = cursorSchema.safeParse(input ?? { provider, version: 1, artistId, page: 1, pending: [], seen: [], more: true, phase: "albums" });
  if (!parsed.success) throw new MusicProviderError("invalid_input", "저장한 아티스트 수집 지점이 올바르지 않습니다.");
  const cursor = parsed.data;
  if (cursor.provider !== provider || cursor.artistId !== artistId) throw new MusicProviderError("invalid_input", "아티스트 수집 지점이 일치하지 않습니다.");
  if (new Set([...cursor.pending, ...cursor.seen]).size !== cursor.pending.length + cursor.seen.length || (cursor.phase === "tracks") !== (cursor.pending.length > 0) || (cursor.phase === "albums" && !cursor.more) || (cursor.phase === "done" && cursor.more)) throw new MusicProviderError("invalid_input", "수집 단계와 앨범 목록이 일치하지 않습니다.");
  const next: DomesticCursor = structuredClone(cursor);
  const checkedAt = new Date(options.now?.() ?? Date.now()).toISOString();
  const scopeNote = `${label(provider)}의 공개 아티스트 앨범 목록과 수록곡 ID로 확인했습니다. 미공개·삭제 자료와 전체 발매 이력은 포함되지 않을 수 있습니다. 크레딧은 앨범의 정보 다시 가져오기에서 보완할 수 있습니다.`;
  const releases: ImportedRelease[] = [];
  if (cursor.phase === "done") return { releases, nextCursor: null, status: "completed" as const, checkedAt, scopeNote };
  if (cursor.phase === "tracks" && cursor.pending.length) {
    const id = cursor.pending[0];
    const html = await request(provider, provider === "melon" ? "/album/detail.htm" : "/detail/albumInfo", provider === "melon" ? { albumId: id } : { axnm: id }, options);
    releases.push(normalizeDomesticAlbum(provider, html, id, artistId, checkedAt));
    next.pending.shift(); next.seen.push(id);
    if (!next.pending.length) next.phase = cursor.more ? "albums" : "done";
  } else {
    if (cursor.page > 500 || cursor.seen.length >= 5000) throw new MusicProviderError("invalid_response", "앨범 수집 범위에 도달했습니다. 확인한 자료는 유지됩니다.");
    const html = provider === "melon"
      ? await request(provider, cursor.page === 1 ? "/artist/album.htm" : "/artist/albumPaging.htm", { artistId, ...(cursor.page > 1 ? { startIndex: String((cursor.page - 1) * 15 + 1), pageSize: "15", listType: "0", orderBy: "ISSUE_DATE" } : {}) }, options)
      : await request(provider, cursor.page === 1 ? "/detail/artistAlbum" : "/detail/bArtistAlbumList", { xxnm: artistId, ...(cursor.page > 1 ? { pg: String(cursor.page), pgsize: "10", otype: "newest", atype: "ALL" } : {}) }, options, cursor.page > 1);
    const ids = parseDomesticAlbumIds(provider, html);
    next.pending = ids.filter(id => !cursor.seen.includes(id));
    const unescaped = html.replace(/\\'/g, "'");
    const pages = [...unescaped.matchAll(provider === "melon" ? /sendPage\(['"](\d+)['"]\)/g : /fnGoPage_ArtistAlbum\(['"](\d+)['"]/g)].map(match => Number(match[1]));
    next.more = pages.some(value => value > (provider === "melon" ? (cursor.page - 1) * 15 + 1 : cursor.page));
    if (!next.pending.length && ids.length) return invalid("앨범 목록이 반복되어 수집을 중단했습니다. 같은 곡을 중복 저장하지 않았습니다.");
    next.page++; next.phase = next.pending.length ? "tracks" : "done";
  }
  return { releases, nextCursor: next.phase === "done" ? null : next, status: next.phase === "done" ? "completed" as const : "collecting" as const, checkedAt, scopeNote };
}

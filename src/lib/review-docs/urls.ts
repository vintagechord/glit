import { createHash } from "node:crypto";
import { fetchMelonAlbumReviewData, type MelonAlbumReviewData } from "../melon";
import { fetchGenieAlbumReviewData } from "../genie";
import { emptyReviewData, explicitInstrumental, normalizeReviewDate, REVIEW_DOC_LIMITS, reviewAlbumSchema, reviewTrackSchema, type ReviewDocumentData, type ReviewEvidence } from "./model";
import { ReviewExtractionError } from "./upload-validation";

type AllowedUrl = { url: string; provider: "melon" | "genie"; id: string; kind: "album" | "song" };
export function canonicalReviewUrl(input: string, allowSong = false): AllowedUrl {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new ReviewExtractionError("URL_INVALID", "올바른 멜론 또는 지니 앨범 URL을 입력해주세요."); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) throw new ReviewExtractionError("URL_FORBIDDEN", "인증정보·별도 포트·임의 프로토콜이 포함된 URL은 허용하지 않습니다.");
  const melon = ["www.melon.com", "melon.com", "m.melon.com"].includes(url.hostname.toLowerCase());
  const genie = ["www.genie.co.kr", "genie.co.kr", "m.genie.co.kr"].includes(url.hostname.toLowerCase());
  if (!melon && !genie) throw new ReviewExtractionError("URL_HOST_FORBIDDEN", "멜론·지니 공식 앨범 주소만 허용합니다.");
  const albumPath = melon ? "/album/detail.htm" : "/detail/albumInfo";
  const songPath = melon ? "/song/detail.htm" : "/detail/songInfo";
  const kind = url.pathname === albumPath ? "album" : allowSong && url.pathname === songPath ? "song" : null;
  if (!kind) throw new ReviewExtractionError("URL_PATH_FORBIDDEN", "지원하는 앨범 상세 경로가 아닙니다.");
  const key = melon ? kind === "album" ? "albumId" : "songId" : kind === "album" ? "axnm" : "xgnm";
  const values = url.searchParams.getAll(key);
  if (values.length !== 1 || !/^\d{1,20}$/.test(values[0])) throw new ReviewExtractionError("URL_ID_INVALID", "앨범 또는 곡 ID를 확인해주세요.");
  return { url: `https://${melon ? "www.melon.com" : "www.genie.co.kr"}${url.pathname}?${key}=${values[0]}`, provider: melon ? "melon" : "genie", id: values[0], kind };
}
export function canonicalReviewUrls(raw: string[]) {
  if (!raw.length || raw.length > REVIEW_DOC_LIMITS.urls) throw new ReviewExtractionError("URL_LIMIT", `URL은 ${REVIEW_DOC_LIMITS.urls}개까지 입력할 수 있습니다.`);
  const urls: string[] = [], duplicates: string[] = [];
  for (const value of raw) { const url = canonicalReviewUrl(value).url; if (urls.includes(url)) duplicates.push(url); else urls.push(url); }
  return { urls, duplicates };
}

/** Adapter around the EXISTING fetchers: bounded concurrency/bytes/time and validated redirects. */
export function createReviewUrlFetcher(fetchImpl: typeof fetch = fetch): typeof fetch {
  let active = 0;
  const waiting: (() => void)[] = [];
  const cache = new Map<string, string>();
  let cacheBytes = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const requested = canonicalReviewUrl(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, true);
    if (cache.has(requested.url)) return new Response(cache.get(requested.url), { status: 200 });
    if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      let current = requested.url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          response = await fetchImpl(current, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
          if (!(response.status === 429 || response.status >= 500) || attempt === 1) break;
          await response.body?.cancel();
        }
        if (!response) throw new ReviewExtractionError("URL_FETCH_FAILED", "URL 조회에 실패했습니다.");
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location || redirects === 3) throw new ReviewExtractionError("URL_REDIRECT", "리다이렉트 횟수가 초과되었거나 위치가 없습니다.");
          const next = canonicalReviewUrl(new URL(location, current).toString(), true);
          if (next.provider !== requested.provider || next.kind !== requested.kind || next.id !== requested.id) throw new ReviewExtractionError("URL_REDIRECT_FORBIDDEN", "다른 서비스·앨범·곡으로 이동하는 리다이렉트는 허용하지 않습니다.");
          current = next.url; continue;
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = []; let bytes = 0;
        if (reader) while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 5 * 1024 * 1024) { await reader.cancel(); throw new ReviewExtractionError("URL_RESPONSE_LIMIT", "URL 응답 크기가 제한을 초과했습니다."); } chunks.push(value); }
        const body = Buffer.concat(chunks).toString("utf8");
        if (response.ok && bytes <= 8 * 1024 * 1024) {
          while (cacheBytes + bytes > 8 * 1024 * 1024 && cache.size) {
            const oldest = cache.keys().next().value!;
            cacheBytes -= Buffer.byteLength(cache.get(oldest)!, "utf8"); cache.delete(oldest);
          }
          cache.set(requested.url, body); cacheBytes += bytes;
        }
        return new Response(body, { status: response.status, statusText: response.statusText, headers: { "content-type": response.headers.get("content-type") ?? "text/html; charset=utf-8" } });
      }
      throw new ReviewExtractionError("URL_REDIRECT", "URL 이동 횟수가 제한을 초과했습니다.");
    } finally { active--; waiting.shift()?.(); }
  }) as typeof fetch;
}
export async function extractUrls(raw: string[], applicationDate: string, options: { fetcher?: typeof fetch } = {}): Promise<ReviewDocumentData> {
  const { urls, duplicates } = canonicalReviewUrls(raw);
  const data = emptyReviewData("album", applicationDate);
  const fetcher = createReviewUrlFetcher(options.fetcher);
  duplicates.forEach((url, i) => data.issues.push({ id: `url-duplicate:${i}`, code: "DUPLICATE_URL", severity: "warning", message: `중복 URL 생성을 제외했습니다: ${url}` }));
  let totalTracks = 0;
  for (const url of urls) {
    const validated = canonicalReviewUrl(url);
    const id = `${validated.provider}-${validated.id}`;
    try {
      if (totalTracks >= REVIEW_DOC_LIMITS.tracks) throw new ReviewExtractionError("TRACK_LIMIT", `전체 ${REVIEW_DOC_LIMITS.tracks}곡 제한을 초과했습니다.`);
      const fetched: MelonAlbumReviewData = await (validated.provider === "melon" ? fetchMelonAlbumReviewData : fetchGenieAlbumReviewData)(url, { fetcher, requireLyrics: false, tolerateSongErrors: true, maxTracks: REVIEW_DOC_LIMITS.tracks - totalTracks });
      totalTracks += fetched.tracks.length;
      if (totalTracks > REVIEW_DOC_LIMITS.tracks) throw new ReviewExtractionError("TRACK_LIMIT", `전체 ${REVIEW_DOC_LIMITS.tracks}곡 제한을 초과했습니다.`);
      const evidence = (field: string, excerpt: string, location = url): ReviewEvidence => ({ sourceId: id, field, location, excerpt: excerpt.slice(0, 2000) });
      const album = reviewAlbumSchema.parse({ id: `album-${id}`, artistName: fetched.artistName, title: fetched.albumTitle, company: fetched.productionCompany, distributor: fetched.distributor, releaseDate: normalizeReviewDate(fetched.releaseDate), genre: fetched.genre, albumType: fetched.albumType, declaredTrackCount: fetched.tracks.length, sourceIds: [id], evidence: [evidence("artistName", fetched.artistName), evidence("title", fetched.albumTitle), evidence("company", fetched.productionCompany), evidence("distributor", fetched.distributor), evidence("releaseDate", fetched.releaseDate)], tracks: fetched.tracks.map((track) => {
        const instrumental = explicitInstrumental(track.trackTitle);
        return reviewTrackSchema.parse({ id: `track-${validated.provider}-${track.songId}`, number: track.trackNo, artistName: track.artistName, title: track.trackTitle, isTitle: track.isTitle, titleConfirmed: true, composer: track.composer, lyricist: instrumental ? "" : track.lyricist, arranger: track.arranger, lyrics: track.lyrics, instrumentalConfirmed: instrumental, lyricStatus: track.lyricFetchFailed ? "extraction_failed" : instrumental ? "instrumental" : track.lyrics ? "provided" : "not_provided", sourceIds: [id], evidence: [evidence("title", track.trackTitle, track.songUrl), evidence("isTitle", String(track.isTitle), url), ...(["composer", "lyricist", "arranger", "lyrics"] as const).map((field) => evidence(field, track[field], track.songUrl))] });
      }) });
      const originalText = JSON.stringify(fetched, null, 2);
      if (data.sources.reduce((n, s) => n + s.text.length, 0) + originalText.length > REVIEW_DOC_LIMITS.sourceCharacters) throw new ReviewExtractionError("TOTAL_TEXT_LIMIT", "작업 전체 원문이 600,000자를 초과했습니다. URL을 여러 작업으로 나눠주세요. 뒷부분은 생략하지 않았습니다.");
      data.albums.push(album);
      data.sources.push({ id, kind: validated.provider, name: `${fetched.artistName} - ${fetched.albumTitle}`, url, text: originalText, warnings: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "앨범 조회에 실패했습니다.";
      data.sources.push({ id, kind: validated.provider, name: url, url, text: "", warnings: [message] });
      data.issues.push({ id: `url-error:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`, code: "URL_EXTRACTION_FAILED", severity: "error", sourceId: id, message: `${url}: ${message} URL을 확인하고 일시적 오류는 재시도해주세요.` });
    }
  }
  return data;
}

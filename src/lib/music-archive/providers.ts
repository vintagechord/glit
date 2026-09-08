/** Provider URLs are links, never arbitrary URLs to fetch. See docs/music-archive-providers.md. */
export type MusicProvider = "musicbrainz" | "spotify" | "melon" | "genie" | "bugs" | "apple";
export type MusicEntityKind = "artist" | "release" | "track" | "recording" | "work";
export type MusicProviderLink = { provider: MusicProvider; kind: MusicEntityKind; externalId: string; url: string };
export const MUSIC_PROVIDER_CHECKED_AT = "2026-09-08";
const mbid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isMusicBrainzId = (value: string) => mbid.test(value);

export function parseMusicProviderUrl(value: string, expectedKind?: MusicEntityKind): MusicProviderLink | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const input = value.trim();
  if (mbid.test(input)) return { provider: "musicbrainz", kind: expectedKind ?? "artist", externalId: input.toLowerCase(), url: `https://musicbrainz.org/${expectedKind ?? "artist"}/${input.toLowerCase()}` };
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    let result: MusicProviderLink | null = null;
    if (["musicbrainz.org", "www.musicbrainz.org"].includes(url.hostname)) {
      const match = url.pathname.match(/^\/(artist|release|recording|work)\/([0-9a-f-]+)\/?$/i);
      if (match && mbid.test(match[2])) result = { provider: "musicbrainz", kind: match[1].toLowerCase() as MusicEntityKind, externalId: match[2].toLowerCase(), url: `https://musicbrainz.org/${match[1].toLowerCase()}/${match[2].toLowerCase()}` };
    } else if (url.hostname === "music.apple.com") {
      const match = url.pathname.match(/^\/[a-z]{2}\/(artist|album|song)\/(?:[^/]+\/)?([1-9]\d{0,19})\/?$/i);
      if (match) {
        const trackId = url.searchParams.get("i");
        const kind = match[1] === "artist" ? "artist" : match[1] === "song" || (trackId && /^[1-9]\d{0,19}$/.test(trackId)) ? "track" : "release";
        const id = kind === "track" && trackId ? trackId : match[2];
        result = { provider: "apple", kind, externalId: id, url: `https://music.apple.com/kr/${kind === "release" ? "album" : kind === "track" ? "song" : "artist"}/${id}` };
      }
    } else if (url.hostname === "open.spotify.com") {
      const match = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(artist|album|track)\/([A-Za-z0-9]{22})\/?$/);
      if (match) result = { provider: "spotify", kind: match[1] === "album" ? "release" : match[1] as MusicEntityKind, externalId: match[2], url: `https://open.spotify.com/${match[1]}/${match[2]}` };
    } else if (["melon.com", "www.melon.com", "m.melon.com", "m2.melon.com"].includes(url.hostname)) {
      const match = url.pathname.match(/^\/(artist|album|song)\/(?:detail|index|music)\.htm\/?$/i);
      const kind = match?.[1].toLowerCase();
      const id = kind ? url.searchParams.get(`${kind}Id`) : null;
      if (kind && id && /^[1-9]\d{0,24}$/.test(id)) result = { provider: "melon", kind: kind === "album" ? "release" : kind === "song" ? "track" : "artist", externalId: id, url: `https://www.melon.com/${kind}/${kind === "artist" ? "timeline" : "detail"}.htm?${kind}Id=${id}` };
      // The canonical artist page uses timeline.htm.
      if (/^\/artist\/timeline\.htm\/?$/i.test(url.pathname)) {
        const id = url.searchParams.get("artistId");
        if (id && /^[1-9]\d{0,24}$/.test(id)) result = { provider: "melon", kind: "artist", externalId: id, url: `https://www.melon.com/artist/timeline.htm?artistId=${id}` };
      }
    } else if (["genie.co.kr", "www.genie.co.kr", "m.genie.co.kr", "mw.genie.co.kr"].includes(url.hostname)) {
      const match = url.pathname.match(/^\/detail\/(artistInfo|albumInfo|songInfo)\/?$/i);
      const name = match?.[1].toLowerCase();
      const key = name === "artistinfo" ? "xxnm" : name === "albuminfo" ? "axnm" : "xgnm";
      const id = match ? url.searchParams.get(key) : null;
      if (match && id && /^[1-9]\d{0,24}$/.test(id)) result = { provider: "genie", kind: name === "artistinfo" ? "artist" : name === "albuminfo" ? "release" : "track", externalId: id, url: `https://www.genie.co.kr/detail/${name === "artistinfo" ? "artistInfo" : name === "albuminfo" ? "albumInfo" : "songInfo"}?${key}=${id}` };
    } else if (["music.bugs.co.kr", "m.bugs.co.kr"].includes(url.hostname)) {
      const match = url.pathname.match(/^\/(artist|album|track)\/([1-9]\d{0,24})\/?$/);
      if (match) result = { provider: "bugs", kind: match[1] === "album" ? "release" : match[1] as MusicEntityKind, externalId: match[2], url: `https://music.bugs.co.kr/${match[1]}/${match[2]}` };
    }
    return result && (!expectedKind || expectedKind === result.kind || (expectedKind === "track" && result.kind === "recording")) ? result : null;
  } catch { return null; }
}

export type ProviderSupport = {
  id: MusicProvider; name: string; status: "available" | "configuration_required" | "permission_required" | "link_only";
  automaticImplemented: boolean; message: string; url: string; checkedAt: string;
};
/** Server callers pass env; client components receive only these safe status objects. */
export function getMusicProviderStatuses(env: Record<string, string | undefined> = process.env): ProviderSupport[] {
  const permitted = env.MUSICBRAINZ_COMMERCIAL_USE_APPROVED === "true";
  const identified = isValidMusicBrainzUserAgent(env.MUSICBRAINZ_USER_AGENT ?? "");
  return [
    { id: "apple", name: "Apple Music 한국 카탈로그", status: "available", automaticImplemented: true, message: "한국 카탈로그에서 아티스트와 발매 음반을 찾습니다. 제공 목록의 범위와 수집 건수를 함께 확인할 수 있습니다.", url: "https://music.apple.com/kr/", checkedAt: MUSIC_PROVIDER_CHECKED_AT },
    { id: "musicbrainz", name: "MusicBrainz", status: !permitted ? "permission_required" : !identified ? "configuration_required" : "available", automaticImplemented: true, message: !permitted ? "자동 수집 코드 준비 · 상업적 API 이용 허가 확인 필요. 공식 링크와 수동 등록을 이용할 수 있습니다." : !identified ? "서버의 서비스명·버전·연락처 User-Agent 설정이 필요합니다." : "공식 API 조회 가능. MusicBrainz 수록 범위만 확인하며 전곡 수집을 보장하지 않습니다.", url: "https://musicbrainz.org/doc/MusicBrainz_API", checkedAt: MUSIC_PROVIDER_CHECKED_AT },
    { id: "spotify", name: "Spotify", status: "permission_required", automaticImplemented: false, message: "공식 API는 있으나 업무용 아카이브 이용·저장 정책과 운영 접근 심사 확인이 필요합니다. 현재 링크 연결만 지원합니다.", url: "https://developer.spotify.com/policy", checkedAt: MUSIC_PROVIDER_CHECKED_AT },
    ...(["melon", "genie", "bugs"] as const).map((id) => ({ id, name: { melon: "멜론", genie: "지니뮤직", bugs: "벅스" }[id], status: "link_only" as const, automaticImplemented: false, message: "공개된 공식 아카이브 API와 이용 허가를 확인하지 못했습니다. 공식 링크 연결·직접 입력을 지원합니다.", url: { melon: "https://www.melon.com/", genie: "https://www.genie.co.kr/", bugs: "https://music.bugs.co.kr/" }[id], checkedAt: MUSIC_PROVIDER_CHECKED_AT })),
  ];
}
export const getProviderRegistry = getMusicProviderStatuses;
export function isValidMusicBrainzUserAgent(value: string) {
  return value.length <= 250 && !/[\r\n]/.test(value) && /^[A-Za-z][\w .-]*\/[\w.-]+\s+\(.*(?:@|https?:\/\/).+\)$/.test(value);
}

export type ArtistCandidate = { provider: MusicProvider; externalId: string; name: string; sortName: string; disambiguation: string; country: string; type: string; url: string; imageUrl: string | null; representativeRelease: string | null };
export type ImportedTrack = { externalId: string; recordingId: string | null; title: string; version: string; artistName: string; artistIds: string[]; position: number; discNumber: number; durationMs: number | null; isrcs: string[]; managedByArtist: boolean; url: string };
export type ImportedRelease = { provider: "musicbrainz" | "apple"; externalId: string; title: string; date: string; type: "album" | "ep" | "single" | "other"; secondaryTypes: string[]; participation: boolean; artistName: string; artistIds: string[]; barcode: string | null; version: string; country: string; tracks: ImportedTrack[]; url: string; imageUrl: null; checkedAt: string };
/** Persist atomically with imported metadata; retry the old cursor after a failed commit. */
export type MusicBrainzCursor = { version: 1; artistId: string; phase: "artist" | "track_artist" | "done"; offset: number; pending: string[]; total?: number };
export type MusicBrainzStep = { releases: ImportedRelease[]; nextCursor: MusicBrainzCursor | null; status: "collecting" | "completed"; checkedAt: string; scopeNote: string };

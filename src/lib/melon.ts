export type MelonTrackReviewData = {
  songId: string;
  songUrl: string;
  trackNo: number;
  trackTitle: string;
  artistName: string;
  isTitle: boolean;
  composer: string;
  lyricist: string;
  arranger: string;
  lyrics: string;
};

export type MelonAlbumReviewData = {
  albumId: string;
  albumUrl: string;
  albumTitle: string;
  albumType: string;
  artistName: string;
  releaseDate: string;
  genre: string;
  distributor: string;
  productionCompany: string;
  tracks: MelonTrackReviewData[];
};

export type MelonFetchOptions = {
  fetcher?: typeof fetch;
  requireLyrics?: boolean;
};

export class MelonReviewDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MelonReviewDataError";
  }
}

const MELON_ORIGIN = "https://www.melon.com";
const MELON_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function extractMelonAlbumId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("albumId");
  } catch {
    return trimmed.match(/albumId=(\d+)/)?.[1] ?? trimmed.match(/\b(\d{5,})\b/)?.[1] ?? null;
  }
}

const buildMelonAlbumUrl = (albumId: string) =>
  `${MELON_ORIGIN}/album/detail.htm?albumId=${encodeURIComponent(albumId)}`;

const buildMelonSongUrl = (songId: string) =>
  `${MELON_ORIGIN}/song/detail.htm?songId=${encodeURIComponent(songId)}`;

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name] ?? match);

const stripTags = (value: string) => value.replace(/<[^>]*>/g, "");

const htmlToText = (value: string, preserveLineBreaks = false) => {
  const withBreaks = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n");
  const decoded = decodeHtmlEntities(stripTags(withBreaks)).replace(/\u00a0/g, " ");

  if (!preserveLineBreaks) {
    return decoded.replace(/\s+/g, " ").trim();
  }

  return decoded
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .reduce<string[]>((lines, line) => {
      if (!line && !lines[lines.length - 1]) return lines;
      lines.push(line);
      return lines;
    }, [])
    .join("\n")
    .trim();
};

const firstMatchText = (html: string, pattern: RegExp, preserveLineBreaks = false) => {
  const match = html.match(pattern);
  return match?.[1] ? htmlToText(match[1], preserveLineBreaks) : "";
};

const parseDateToIso = (value: string) => {
  const match = value.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!match) return value.trim();
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
};

const uniqueJoin = (values: string[]) => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    const text = value.trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      normalized.push(text);
    }
  });
  return normalized.join(", ");
};

const parseMetaList = (html: string) => {
  const result: Record<string, string> = {};
  const dl = html.match(/<dl class="list">([\s\S]*?)<\/dl>/)?.[1] ?? html;
  const itemPattern = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g;
  for (const match of dl.matchAll(itemPattern)) {
    const label = htmlToText(match[1]);
    const value = htmlToText(match[2]);
    if (label) result[label] = value;
  }
  return result;
};

export function parseMelonAlbumPage(html: string, albumId: string) {
  const infoSection =
    html.match(/<div class="section_info">([\s\S]*?)<div class="button d_album_like">/)?.[1] ??
    html;
  const meta = parseMetaList(infoSection);
  const albumTitle = firstMatchText(
    infoSection,
    /<div class="song_name">\s*<strong[^>]*>앨범명<\/strong>([\s\S]*?)<\/div>/,
  );
  const artistName =
    firstMatchText(infoSection, /class="artist_name"[^>]*>\s*<span>([\s\S]*?)<\/span>/) ||
    firstMatchText(infoSection, /class="artist_name"[^>]*>([\s\S]*?)<\/a>/);
  const albumType = firstMatchText(infoSection, /<span class="gubun">([\s\S]*?)<\/span>/)
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .trim();

  const tracks = Array.from(html.matchAll(/<tr data-group-items="cd\d+">([\s\S]*?)<\/tr>/g))
    .map((match, index) => {
      const row = match[1];
      const songId =
        row.match(/goSongDetail\('(\d+)'\)/)?.[1] ??
        row.match(/name="input_check"\s+value="(\d+)"/)?.[1] ??
        "";
      const trackNoText = firstMatchText(row, /<span class="rank[^"]*">([\s\S]*?)<\/span>/);
      const trackNo = Number.parseInt(trackNoText, 10) || index + 1;
      const trackTitle =
        firstMatchText(
          row,
          /<a href="javascript:melon\.play\.playSong\('[^']+',\s*\d+\);"[^>]*>([\s\S]*?)<\/a>/,
        ) ||
        htmlToText(row.match(/<input[^>]+title="([^"]+)\s+곡 선택"/)?.[1] ?? "");
      const rowArtistName =
        firstMatchText(row, /class="ellipsis rank02"[\s\S]*?class="artist_name"[^>]*>([\s\S]*?)<\/a>/) ||
        artistName;

      return {
        songId,
        songUrl: songId ? buildMelonSongUrl(songId) : "",
        trackNo,
        trackTitle,
        artistName: rowArtistName,
        isTitle: /title="타이틀 곡"/.test(row),
        composer: "",
        lyricist: "",
        arranger: "",
        lyrics: "",
      };
    })
    .filter((track) => track.songId && track.trackTitle);

  return {
    albumId,
    albumUrl: buildMelonAlbumUrl(albumId),
    albumTitle,
    albumType,
    artistName,
    releaseDate: parseDateToIso(meta["발매일"] ?? ""),
    genre: meta["장르"] ?? "",
    distributor: meta["발매사"] ?? "",
    productionCompany: meta["기획사"] ?? "",
    tracks,
  } satisfies MelonAlbumReviewData;
}

export function parseMelonSongPage(html: string, songId: string) {
  const title = firstMatchText(
    html,
    /<div class="song_name">\s*<strong[^>]*>곡명<\/strong>([\s\S]*?)<\/div>/,
  );
  const artistName =
    firstMatchText(html, /class="artist_name"[^>]*>\s*<span>([\s\S]*?)<\/span>/) ||
    firstMatchText(html, /class="artist_name"[^>]*>([\s\S]*?)<\/a>/);
  const lyrics = firstMatchText(
    html,
    /<div class="lyric" id="d_video_summary">([\s\S]*?)<\/div>/,
    true,
  );
  const producerSection =
    html.match(/<ul class="list_person clfix">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  const byType: Record<string, string[]> = {};

  for (const match of producerSection.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
    const item = match[1];
    const name = firstMatchText(item, /class="artist_name"[^>]*>([\s\S]*?)<\/a>/);
    const type = firstMatchText(item, /<span class="type">([\s\S]*?)<\/span>/);
    if (!name || !type) continue;
    byType[type] = [...(byType[type] ?? []), name];
  }

  return {
    songId,
    songUrl: buildMelonSongUrl(songId),
    trackNo: 0,
    trackTitle: title,
    artistName,
    isTitle: false,
    composer: uniqueJoin(byType["작곡"] ?? []),
    lyricist: uniqueJoin(byType["작사"] ?? []),
    arranger: uniqueJoin(byType["편곡"] ?? []),
    lyrics,
  } satisfies MelonTrackReviewData;
}

async function fetchMelonText(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "referer": MELON_ORIGIN,
      "user-agent": MELON_USER_AGENT,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new MelonReviewDataError(`멜론 페이지를 불러오지 못했습니다. (${response.status})`);
  }

  return response.text();
}

export async function fetchMelonAlbumReviewData(
  melonUrl: string,
  options: MelonFetchOptions = {},
) {
  const albumId = extractMelonAlbumId(melonUrl);
  if (!albumId) {
    throw new MelonReviewDataError("멜론 앨범 ID를 확인할 수 없습니다.");
  }

  const fetcher = options.fetcher ?? fetch;
  const albumHtml = await fetchMelonText(buildMelonAlbumUrl(albumId), fetcher);
  const album = parseMelonAlbumPage(albumHtml, albumId);
  if (!album.albumTitle || album.tracks.length === 0) {
    throw new MelonReviewDataError("멜론 앨범 정보를 가져오지 못했습니다.");
  }

  const tracks = await Promise.all(
    album.tracks.map(async (track) => {
      const songHtml = await fetchMelonText(track.songUrl, fetcher);
      const detail = parseMelonSongPage(songHtml, track.songId);
      return {
        ...track,
        trackTitle: detail.trackTitle || track.trackTitle,
        artistName: detail.artistName || track.artistName,
        composer: detail.composer,
        lyricist: detail.lyricist,
        arranger: detail.arranger,
        lyrics: detail.lyrics,
      };
    }),
  );

  const requireLyrics = options.requireLyrics ?? true;
  const missingLyrics = requireLyrics
    ? tracks.filter((track) => !track.lyrics.trim())
    : [];
  if (missingLyrics.length > 0) {
    throw new MelonReviewDataError(
      `멜론에서 가사를 가져오지 못한 곡이 있습니다: ${missingLyrics
        .map((track) => `${track.trackNo}. ${track.trackTitle}`)
        .join(", ")}`,
    );
  }

  return {
    ...album,
    tracks,
  } satisfies MelonAlbumReviewData;
}

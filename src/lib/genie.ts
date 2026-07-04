export type GenieTrackReviewData = {
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

export type GenieAlbumReviewData = {
  albumId: string;
  albumUrl: string;
  albumTitle: string;
  albumType: string;
  artistName: string;
  releaseDate: string;
  genre: string;
  distributor: string;
  productionCompany: string;
  tracks: GenieTrackReviewData[];
};

export type GenieFetchOptions = {
  fetcher?: typeof fetch;
  requireLyrics?: boolean;
};

export class GenieReviewDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenieReviewDataError";
  }
}

const GENIE_ORIGIN = "https://www.genie.co.kr";
const GENIE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function extractGenieAlbumId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.searchParams.get("axnm");
  } catch {
    return trimmed.match(/axnm=(\d+)/)?.[1] ?? trimmed.match(/\b(\d{5,})\b/)?.[1] ?? null;
  }
}

const buildGenieAlbumUrl = (albumId: string) =>
  `${GENIE_ORIGIN}/detail/albumInfo?axnm=${encodeURIComponent(albumId)}`;

const buildGenieSongUrl = (songId: string) =>
  `${GENIE_ORIGIN}/detail/songInfo?xgnm=${encodeURIComponent(songId)}`;

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

const normalizeGenieText = (value: string) =>
  typeof value.normalize === "function" ? value.normalize("NFC") : value;

const htmlToText = (value: string, preserveLineBreaks = false) => {
  const withBreaks = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n");
  const decoded = decodeHtmlEntities(stripTags(withBreaks)).replace(/\u00a0/g, " ");

  if (!preserveLineBreaks) {
    return normalizeGenieText(decoded.replace(/\s+/g, " ").trim());
  }

  return normalizeGenieText(
    decoded
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .reduce<string[]>((lines, line) => {
        if (!line && !lines[lines.length - 1]) return lines;
        lines.push(line);
        return lines;
      }, [])
      .join("\n")
      .trim(),
  );
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

const normalizeContributorText = (value: string) =>
  value
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();

const isInstrumentalTitle = (title: string) =>
  /\b(inst|instrumental|mr)\b/i.test(title) || /반주|가사\s*없음/i.test(title);

function extractBalancedSpanContent(html: string, fromIndex: number) {
  const spanStart = html.slice(fromIndex).search(/<span\b[^>]*class=["'][^"']*\bvalue\b[^"']*["'][^>]*>/i);
  if (spanStart < 0) return "";

  const openStart = fromIndex + spanStart;
  const openEnd = html.indexOf(">", openStart);
  if (openEnd < 0) return "";

  const tagPattern = /<\/?span\b[^>]*>/gi;
  tagPattern.lastIndex = openEnd + 1;
  let depth = 1;
  for (const match of html.matchAll(tagPattern)) {
    if (match.index === undefined || match.index < openEnd + 1) continue;
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(openEnd + 1, match.index);
      }
    } else {
      depth += 1;
    }
  }

  return "";
}

const extractInfoValue = (html: string, labels: string[]) => {
  for (const label of labels) {
    const labelIndex = html.search(new RegExp(`alt=["']${label}["']`, "i"));
    if (labelIndex < 0) continue;
    const value = normalizeContributorText(htmlToText(extractBalancedSpanContent(html, labelIndex)));
    if (value) return value;
  }
  return "";
};

const stripGenieLyricsHeader = (lyrics: string, title: string) =>
  lyrics
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line, index) => {
      if (index > 1) return true;
      const compact = line.replace(/\s+/g, " ").trim();
      if (!compact) return true;
      return !new RegExp(`^${escapeRegExp(title)}\\s*-\\s*\\d{1,2}:\\d{2}$`).test(compact);
    })
    .join("\n")
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function parseGenieAlbumPage(html: string, albumId: string) {
  const infoSection =
    html.match(/<div class="album-detail-infos">([\s\S]*?)<!-- E\. 앨범 기본 정보/)?.[1] ??
    html.match(/<div class="album-detail-infos">([\s\S]*?)<div class="music-list-wrap/)?.[1] ??
    html;
  const albumTitle =
    firstMatchText(infoSection, /<h2 class="name"[^>]*>([\s\S]*?)<\/h2>/) ||
    firstMatchText(html, /<meta property="og:title" content="([^"]+?)\s*\/\s*[^"]+? - genie"/);
  const artistName =
    extractInfoValue(infoSection, ["아티스트"]) ||
    firstMatchText(html, /<h2 class="page-top-this">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) ||
    firstMatchText(html, /<meta property="og:title" content="[^"]+?\s*\/\s*([^"]+?) - genie"/);

  const tracks = Array.from(html.matchAll(/<tr class="list"[\s\S]*?<\/tr>/g))
    .map((match, index) => {
      const row = match[0];
      const songId =
        row.match(/songId=["']\s*(\d+)\s*["']/i)?.[1] ??
        row.match(/fnViewSongInfo\((\d+)\)/)?.[1] ??
        "";
      const trackNo = Number.parseInt(row.match(/<td class="number"[^>]*>\s*(\d+)/i)?.[1] ?? "", 10) || index + 1;
      const trackTitle =
        htmlToText(row.match(/<a[^>]+class="title[^"]*"[^>]+title="([^"]+)"/i)?.[1] ?? "") ||
        firstMatchText(row, /<a[^>]+class="title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const rowArtistName =
        firstMatchText(row, /<a[^>]+class="artist[^"]*"[^>]*>([\s\S]*?)<\/a>/) ||
        artistName;

      return {
        songId,
        songUrl: songId ? buildGenieSongUrl(songId) : "",
        trackNo,
        trackTitle,
        artistName: rowArtistName,
        isTitle: /\bicon-title\b/i.test(row),
        composer: "",
        lyricist: "",
        arranger: "",
        lyrics: "",
      };
    })
    .filter((track) => track.songId && track.trackTitle);

  return {
    albumId,
    albumUrl: buildGenieAlbumUrl(albumId),
    albumTitle,
    albumType: "",
    artistName,
    releaseDate: parseDateToIso(extractInfoValue(infoSection, ["발매일"])),
    genre: extractInfoValue(infoSection, ["장르/스타일", "장르"]),
    distributor: extractInfoValue(infoSection, ["발매사", "유통사"]),
    productionCompany: extractInfoValue(infoSection, ["기획사"]),
    tracks,
  } satisfies GenieAlbumReviewData;
}

export function parseGenieSongPage(html: string, songId: string) {
  const infoSection =
    html.match(/<div class="song-main-infos">([\s\S]*?)<!-- E\. song-main-infos/)?.[1] ??
    html;
  const title = firstMatchText(infoSection, /<h2 class="name"[^>]*>([\s\S]*?)<\/h2>/);
  const artistName =
    firstMatchText(html, /<h2 class="page-top-this">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) ||
    firstMatchText(html, /<meta property="og:title" content="[^"]+?\s*\/\s*([^"]+?) - genie"/);
  const lyricsBlock = html.match(/<pre[^>]+id=["']pLyrics["'][^>]*>([\s\S]*?)<\/pre>/i)?.[1] ?? "";
  const lyricsBody =
    lyricsBlock.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ??
    lyricsBlock.replace(/<div[^>]*>[\s\S]*?<\/div>/i, "");
  const lyrics = stripGenieLyricsHeader(htmlToText(lyricsBody, true), title);

  return {
    songId,
    songUrl: buildGenieSongUrl(songId),
    trackNo: 0,
    trackTitle: title,
    artistName,
    isTitle: false,
    composer: extractInfoValue(infoSection, ["작곡가"]),
    lyricist: extractInfoValue(infoSection, ["작사가"]),
    arranger: extractInfoValue(infoSection, ["편곡자"]),
    lyrics,
  } satisfies GenieTrackReviewData;
}

async function fetchGenieText(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "referer": GENIE_ORIGIN,
      "user-agent": GENIE_USER_AGENT,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new GenieReviewDataError(`지니 페이지를 불러오지 못했습니다. (${response.status})`);
  }

  return response.text();
}

export async function fetchGenieAlbumReviewData(
  genieUrl: string,
  options: GenieFetchOptions = {},
) {
  const albumId = extractGenieAlbumId(genieUrl);
  if (!albumId) {
    throw new GenieReviewDataError("지니 앨범 ID를 확인할 수 없습니다.");
  }

  const fetcher = options.fetcher ?? fetch;
  const albumHtml = await fetchGenieText(buildGenieAlbumUrl(albumId), fetcher);
  const album = parseGenieAlbumPage(albumHtml, albumId);
  if (!album.albumTitle || album.tracks.length === 0) {
    throw new GenieReviewDataError("지니 앨범 정보를 가져오지 못했습니다.");
  }

  const tracks = await Promise.all(
    album.tracks.map(async (track) => {
      const songHtml = await fetchGenieText(track.songUrl, fetcher);
      const detail = parseGenieSongPage(songHtml, track.songId);
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
    ? tracks.filter((track) => !isInstrumentalTitle(track.trackTitle) && !track.lyrics.trim())
    : [];
  if (missingLyrics.length > 0) {
    throw new GenieReviewDataError(
      `지니에서 가사를 가져오지 못한 곡이 있습니다: ${missingLyrics
        .map((track) => `${track.trackNo}. ${track.trackTitle}`)
        .join(", ")}`,
    );
  }

  return {
    ...album,
    tracks,
  } satisfies GenieAlbumReviewData;
}

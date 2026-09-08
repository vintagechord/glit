export type ReleasedAlbumUrl = {
  provider: "melon" | "genie" | "apple" | "bugs";
  albumId: string;
  canonicalUrl: string;
};

const melonHosts = new Set([
  "melon.com",
  "www.melon.com",
  "m.melon.com",
  "m2.melon.com",
]);
const genieHosts = new Set([
  "genie.co.kr",
  "www.genie.co.kr",
  "m.genie.co.kr",
  "mw.genie.co.kr",
]);

/** Accept album pages only and normalize them before downstream metadata fetches. */
export const parseReleasedAlbumUrl = (
  value?: string | null,
): ReleasedAlbumUrl | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    // Only complete album pages are accepted; song query parameters must not
    // silently broaden a single-song URL into a whole-album request.
    const appleAlbum = url.hostname === "music.apple.com" && !url.searchParams.has("i")
      ? url.pathname.match(/^\/[a-z]{2}\/album\/(?:[^/]+\/)?([1-9]\d*)\/?$/i)
      : null;
    if (appleAlbum) return { provider: "apple", albumId: appleAlbum[1], canonicalUrl: `https://music.apple.com/kr/album/${appleAlbum[1]}` };
    const bugsAlbum = ["music.bugs.co.kr", "m.bugs.co.kr"].includes(url.hostname)
      ? url.pathname.match(/^\/album\/([1-9]\d*)\/?$/i) : null;
    if (bugsAlbum) return { provider: "bugs", albumId: bugsAlbum[1], canonicalUrl: `https://music.bugs.co.kr/album/${bugsAlbum[1]}` };

    const isMelon =
      melonHosts.has(url.hostname) &&
      /^\/album\/(?:detail|music)\.htm\/?$/i.test(url.pathname);
    const isGenie =
      genieHosts.has(url.hostname) &&
      /^\/detail\/albumInfo\/?$/i.test(url.pathname);
    if (!isMelon && !isGenie) return null;

    const albumId = url.searchParams.get(isMelon ? "albumId" : "axnm");
    if (!albumId || !/^[1-9]\d*$/.test(albumId)) return null;

    return {
      provider: isMelon ? "melon" : "genie",
      albumId,
      canonicalUrl: isMelon
        ? `https://www.melon.com/album/detail.htm?albumId=${albumId}`
        : `https://www.genie.co.kr/detail/albumInfo?axnm=${albumId}`,
    };
  } catch {
    return null;
  }
};

export const getReleasedAlbumUrlError = (value?: string | null) => {
  if (!value?.trim()) return "발매된 앨범의 링크를 입력해주세요.";
  return parseReleasedAlbumUrl(value)
    ? null
    : "멜론·지니·벅스·Apple Music의 앨범 상세 페이지 URL을 확인해주세요. 곡·아티스트 링크는 사용할 수 없습니다.";
};

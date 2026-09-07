export type ReleasedAlbumUrl = {
  provider: "melon" | "genie";
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
  if (!value?.trim()) return "멜론 또는 지니의 앨범 링크를 입력해주세요.";
  return parseReleasedAlbumUrl(value)
    ? null
    : "멜론 또는 지니의 앨범 상세 페이지 URL을 확인해주세요. 곡·아티스트 링크는 사용할 수 없습니다.";
};

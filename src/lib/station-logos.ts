export const fallbackStationLogoPath = "/station-logos/default.svg";

export type StationLogoSource = {
  patterns: string[];
  src: string;
  alt: string;
};

export const stationLogoSources: StationLogoSource[] = [
  { patterns: ["KBS", "KBS 1FM", "KBS 2FM"], src: "/station-logos/kbs.webp", alt: "KBS" },
  { patterns: ["MBC", "MBC FM4U", "MBC 표준FM"], src: "/station-logos/mbc.webp", alt: "MBC" },
  { patterns: ["SBS", "SBS 파워FM", "SBS 러브FM"], src: "/station-logos/sbs.webp", alt: "SBS" },
  { patterns: ["TBS", "TBS EFM", "TBS 교통방송"], src: "/station-logos/tbs.webp", alt: "TBS" },
  { patterns: ["YTN"], src: "/station-logos/ytn.webp", alt: "YTN" },
  { patterns: ["CBS", "기독교방송"], src: "/station-logos/cbs.webp", alt: "CBS" },
  { patterns: ["BBS", "불교방송"], src: "/station-logos/bbs.webp", alt: "BBS 불교방송" },
  { patterns: ["WBS", "원음방송"], src: "/station-logos/wbs.webp", alt: "WBS" },
  { patterns: ["PBC", "평화방송"], src: "/station-logos/pbc.webp", alt: "PBC 평화방송" },
  { patterns: ["FEBC", "극동방송"], src: "/station-logos/febc.webp", alt: "FEBC 극동방송" },
  { patterns: ["ARIRANG", "아리랑"], src: "/station-logos/arirang.webp", alt: "Arirang" },
  {
    patterns: ["GYEONGIN IFM", "GYEONGIN_IFM", "KFM", "IFM", "경인 IFM", "경인방송"],
    src: "/station-logos/ifm.webp",
    alt: "경인방송 iFM",
  },
  { patterns: ["TBN", "TBN 교통방송", "한국도로교통공단", "도로교통공단"], src: "/station-logos/tbn.webp", alt: "TBN" },
  { patterns: ["KISS", "KISS RADIO", "KISSRADIO"], src: "/station-logos/kiss.webp", alt: "KISS" },
  { patterns: ["GUGAK", "국악방송"], src: "/station-logos/gugak.webp", alt: "국악방송" },
  { patterns: ["EBS"], src: "/station-logos/ebs.webp", alt: "EBS" },
  { patterns: ["TVN", "tvN"], src: "/station-logos/tvn.webp", alt: "tvN" },
  { patterns: ["JTBC"], src: "/station-logos/jtbc.webp", alt: "JTBC" },
  { patterns: ["G1", "GFM"], src: "/station-logos/g1.webp", alt: "G1" },
];

const normalizeStationLogoToken = (value?: string | null) =>
  (value ?? "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();

export function getLocalStationLogoSource(station?: {
  code?: string | null;
  name?: string | null;
} | null) {
  const tokens = [station?.code, station?.name]
    .map(normalizeStationLogoToken)
    .filter(Boolean);

  return (
    stationLogoSources.find((source) =>
      source.patterns
        .map(normalizeStationLogoToken)
        .some((pattern) =>
          tokens.some(
            (token) =>
              token === pattern ||
              token.startsWith(`${pattern} `) ||
              token.includes(` ${pattern}`),
          ),
        ),
    ) ?? null
  );
}

export function getStationLogoPath(station?: {
  code?: string | null;
  name?: string | null;
} | null) {
  return getLocalStationLogoSource(station)?.src ?? fallbackStationLogoPath;
}

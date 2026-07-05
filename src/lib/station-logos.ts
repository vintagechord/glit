export const fallbackStationLogoPath = "/station-logos/default.svg";

export type StationLogoSource = {
  patterns: string[];
  src: string;
  alt: string;
};

export const stationLogoSources: StationLogoSource[] = [
  { patterns: ["KBS", "KBS 1FM", "KBS 2FM"], src: "/station-logos/kbs.svg", alt: "KBS" },
  { patterns: ["MBC", "MBC FM4U", "MBC 표준FM"], src: "/station-logos/mbc.svg", alt: "MBC" },
  { patterns: ["SBS", "SBS 파워FM", "SBS 러브FM"], src: "/station-logos/sbs.svg", alt: "SBS" },
  { patterns: ["TBS", "TBS EFM"], src: "/station-logos/tbs.svg", alt: "TBS" },
  { patterns: ["YTN"], src: "/station-logos/ytn.svg", alt: "YTN" },
  { patterns: ["CBS"], src: "/station-logos/cbs.svg", alt: "CBS" },
  { patterns: ["BBS"], src: "/station-logos/bbs.svg", alt: "BBS 불교방송" },
  { patterns: ["WBS"], src: "/station-logos/wbs.svg", alt: "WBS" },
  { patterns: ["PBC"], src: "/station-logos/pbc.svg", alt: "PBC 평화방송" },
  { patterns: ["FEBC"], src: "/station-logos/febc.svg", alt: "FEBC 극동방송" },
  { patterns: ["ARIRANG"], src: "/station-logos/arirang.svg", alt: "Arirang" },
  {
    patterns: ["GYEONGIN IFM", "GYEONGIN_IFM", "KFM", "IFM", "경인 IFM", "경인방송"],
    src: "/station-logos/ifm.svg",
    alt: "경인방송 iFM",
  },
  { patterns: ["TBN"], src: "/station-logos/tbn.svg", alt: "TBN" },
  { patterns: ["KISS"], src: "/station-logos/kiss.svg", alt: "KISS" },
  { patterns: ["GUGAK", "국악방송"], src: "/station-logos/gugak.svg", alt: "국악방송" },
  { patterns: ["EBS"], src: "/station-logos/ebs.svg", alt: "EBS" },
  { patterns: ["TVN", "TVN"], src: "/station-logos/tvn.svg", alt: "tvN" },
  { patterns: ["JTBC"], src: "/station-logos/jtbc.svg", alt: "JTBC" },
  { patterns: ["G1", "GFM"], src: "/station-logos/g1.svg", alt: "G1" },
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

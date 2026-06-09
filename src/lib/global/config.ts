export type GlobalProductKey =
  | "album_review"
  | "mv_online_review"
  | "mv_broadcast_review";

export type GlobalProduct = {
  key: GlobalProductKey;
  submissionType: "ALBUM" | "MV_DISTRIBUTION" | "MV_BROADCAST";
  title: string;
  shortTitle: string;
  description: string;
  includes: string[];
  amountUsd: number;
};

const readUsd = (keys: string | string[], fallback: number) => {
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const value = Number(process.env[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return fallback;
};

export const GLOBAL_PRODUCTS: GlobalProduct[] = [
  {
    key: "album_review",
    submissionType: "ALBUM",
    title: "Album Review",
    shortTitle: "Album",
    description:
      "For singles, albums, and audio releases that need Korean broadcast review submission support.",
    includes: [
      "Broadcaster package selection",
      "Metadata check",
      "Lyrics and translation status",
      "Broadcast review progress tracking",
    ],
    amountUsd: readUsd(
      ["ONSIDE_EN_ALBUM_REVIEW_USD", "ONSIDE_GLOBAL_MUSIC_REVIEW_USD"],
      180,
    ),
  },
  {
    key: "mv_online_review",
    submissionType: "MV_DISTRIBUTION",
    title: "Music Video Online Review",
    shortTitle: "MV Online",
    description:
      "For music videos submitted for distributor delivery and online upload review.",
    includes: [
      "Video material check",
      "Metadata check",
      "Requested rating field",
      "Review result file tracking",
    ],
    amountUsd: readUsd(
      ["ONSIDE_EN_MV_ONLINE_REVIEW_USD", "ONSIDE_GLOBAL_MV_REVIEW_USD"],
      220,
    ),
  },
  {
    key: "mv_broadcast_review",
    submissionType: "MV_BROADCAST",
    title: "Music Video TV Broadcast Review",
    shortTitle: "MV Broadcast",
    description:
      "For music videos prepared for Korean TV broadcaster submission requirements.",
    includes: [
      "Broadcaster request memo",
      "Video material check",
      "Requested rating field",
      "Broadcast review progress tracking",
    ],
    amountUsd: readUsd("ONSIDE_EN_MV_BROADCAST_REVIEW_USD", 260),
  },
];

export const GLOBAL_CURRENCY = process.env.ONSIDE_GLOBAL_CURRENCY ?? "USD";

export const getGlobalProduct = (key: string) =>
  GLOBAL_PRODUCTS.find((product) => product.key === key) ?? null;

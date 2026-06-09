export type GlobalProductKey = "music_review" | "mv_review" | "lyric_translation";

export type GlobalProduct = {
  key: GlobalProductKey;
  title: string;
  description: string;
  includes: string[];
  amountUsd: number;
};

const readUsd = (key: string, fallback: number) => {
  const value = Number(process.env[key] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export const GLOBAL_PRODUCTS: GlobalProduct[] = [
  {
    key: "music_review",
    title: "Korean Broadcast Music Review Submission",
    description:
      "For singles, albums, and audio releases that need guided submission support for Korean broadcast review.",
    includes: [
      "Metadata check",
      "Audio/file link check",
      "Lyric material check",
      "Submission support",
    ],
    amountUsd: readUsd("ONSIDE_GLOBAL_MUSIC_REVIEW_USD", 180),
  },
  {
    key: "mv_review",
    title: "Korean Broadcast MV Review Submission",
    description:
      "For music videos that need video material checks, metadata organization, and broadcast review submission support.",
    includes: [
      "Video material check",
      "Metadata check",
      "Music video URL review",
      "Submission support",
    ],
    amountUsd: readUsd("ONSIDE_GLOBAL_MV_REVIEW_USD", 220),
  },
  {
    key: "lyric_translation",
    title: "Korean Lyric Translation Add-on",
    description:
      "Preparation support for Korean lyric translations. This is not legal, certified, or notarized translation.",
    includes: [
      "Lyric translation preparation",
      "Terminology consistency check",
      "Submission material formatting",
    ],
    amountUsd: readUsd("ONSIDE_GLOBAL_TRANSLATION_USD", 80),
  },
];

export const GLOBAL_CURRENCY = process.env.ONSIDE_GLOBAL_CURRENCY ?? "USD";

export const getGlobalProduct = (key: string) =>
  GLOBAL_PRODUCTS.find((product) => product.key === key) ?? null;

/** Fill colors of the rating marks in public/media/mv-ratings (18 uses the
 * 19 mark), with the text color the owner chose for each fill. White on the
 * ALL green reads better at chip size than black (owner request 2026-11-03). */
export const MV_RATING_MARK_COLORS = {
  ALL: { background: "#229c56", color: "#ffffff" },
  "12": { background: "#e9b630", color: "#111111" },
  "15": { background: "#dd7430", color: "#111111" },
  "18": { background: "#d92a35", color: "#ffffff" },
  "19": { background: "#d92a35", color: "#ffffff" },
} as const;

export type MvRatingMarkCode = keyof typeof MV_RATING_MARK_COLORS;

export const isMvRatingMarkCode = (value: unknown): value is MvRatingMarkCode =>
  typeof value === "string" && Object.hasOwn(MV_RATING_MARK_COLORS, value);

// Written out in full so Tailwind generates every class; a globals.css rule
// for these chips did not reach the production stylesheet.
const MV_RATING_CHIP_TONES: Record<MvRatingMarkCode, string> = {
  ALL: "bg-[#229c56] text-white dark:bg-[#229c56] dark:text-white",
  "12": "bg-[#e9b630] text-[#111111] dark:bg-[#e9b630] dark:text-[#111111]",
  "15": "bg-[#dd7430] text-[#111111] dark:bg-[#dd7430] dark:text-[#111111]",
  "18": "bg-[#d92a35] text-white dark:bg-[#d92a35] dark:text-white",
  "19": "bg-[#d92a35] text-white dark:bg-[#d92a35] dark:text-white",
};

/** Chip classes that paint a result in its rating mark's colors. */
export const mvRatingChipTone = (code: MvRatingMarkCode) => MV_RATING_CHIP_TONES[code];

export const isMvRatingChipTone = (tone: string) =>
  Object.values(MV_RATING_CHIP_TONES).includes(tone);

/** Fill colors of the rating marks in public/media/mv-ratings (18 uses the
 * 19 mark), with a text color that keeps AA contrast on each fill. The
 * `.bauhaus-status-chip--rating-*` classes in globals.css use the same values. */
export const MV_RATING_MARK_COLORS = {
  ALL: { background: "#229c56", color: "#111111" },
  "12": { background: "#e9b630", color: "#111111" },
  "15": { background: "#dd7430", color: "#111111" },
  "18": { background: "#d92a35", color: "#ffffff" },
  "19": { background: "#d92a35", color: "#ffffff" },
} as const;

export type MvRatingMarkCode = keyof typeof MV_RATING_MARK_COLORS;

export const isMvRatingMarkCode = (value: unknown): value is MvRatingMarkCode =>
  typeof value === "string" && Object.hasOwn(MV_RATING_MARK_COLORS, value);

/** Status-chip modifier that paints a result in its rating mark's colors. */
export const mvRatingChipTone = (code: MvRatingMarkCode) =>
  `bauhaus-status-chip--rating-${code === "18" ? "19" : code.toLowerCase()}`;

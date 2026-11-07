export const MV_DESIRED_RATING_OPTIONS = [
  { value: "전체관람가", label: "전체관람가" },
  { value: "12세이상관람가", label: "12세이상관람가" },
  { value: "15세이상관람가", label: "15세이상관람가" },
  { value: "청소년관람불가", label: "청소년관람불가 (19세)" },
] as const;

export type MvDesiredRating = (typeof MV_DESIRED_RATING_OPTIONS)[number]["value"];

// Earlier drafts used a free-text field. Restore only an unambiguous rating,
// leaving unsupported text unselected instead of guessing an age category.
export const normalizeMvDesiredRating = (
  value?: string | null,
): MvDesiredRating | "" => {
  const normalized = value?.trim().replace(/\s+/g, "").toLowerCase() ?? "";
  if (["전체", "전체관람", "전체관람가", "all"].includes(normalized)) {
    return "전체관람가";
  }
  if (/^(?:만)?12(?:세)?(?:이상)?(?:관람가)?$/.test(normalized)) {
    return "12세이상관람가";
  }
  if (/^(?:만)?15(?:세)?(?:이상)?(?:관람가)?$/.test(normalized)) {
    return "15세이상관람가";
  }
  if (
    /^(?:만)?19(?:세)?(?:이상)?(?:관람가)?$/.test(normalized) ||
    /^(?:청소년관람불가|청불)(?:\(19세\))?$/.test(normalized)
  ) {
    return "청소년관람불가";
  }
  return "";
};

/**
 * On the online (영등위) form the 소속사 is the production company: one field,
 * filed with 영등위 as 제작사 and shown on the video's lower left after the
 * review. Returns the column update for a save; an empty object keeps the
 * stored value (TV requests, uploaded forms, older clients' retired input).
 */
export const resolveMvProductionCompanyUpdate = (input: {
  mvType: "MV_DISTRIBUTION" | "MV_BROADCAST";
  productionCompany?: string;
  agency?: string;
}): { mv_production_company?: string | null } => {
  if (input.productionCompany !== undefined) {
    return { mv_production_company: input.productionCompany.trim() || null };
  }
  const agency = input.agency?.trim();
  return input.mvType === "MV_DISTRIBUTION" && agency
    ? { mv_production_company: agency }
    : {};
};

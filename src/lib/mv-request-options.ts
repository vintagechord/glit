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

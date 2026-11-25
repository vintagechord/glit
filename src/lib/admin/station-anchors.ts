/**
 * In-page anchors on the admin application page, so the 접수 관리 list can
 * link straight to a station's result form (or the results section).
 */
export const stationResultsAnchor = "station-results";

export const stationReviewAnchor = (code?: string | null, fallbackId?: string | null) => {
  const key = (code || fallbackId || "").trim();
  return key ? `station-${key.replace(/[^A-Za-z0-9_-]/g, "-")}` : stationResultsAnchor;
};

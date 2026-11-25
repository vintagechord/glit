import type { SupabaseClient } from "@supabase/supabase-js";

import { getStationReviewDisplayStatus } from "@/lib/station-review-display";
import { getPackageStationCodes, stationShortNameByCode } from "@/lib/station-reviews";
import { sortByTrackNo, type AlbumTrackMeta } from "@/lib/track-results";

/**
 * Which stations of a paid album still have no result, for the 접수 관리
 * list (owner request 2026-11-25): results arrive one broadcaster at a time,
 * and the operator should not have to open every application to find the
 * stations left to enter. A station counts as entered exactly when the detail
 * page counts it (getStationReviewDisplayStatus().isComplete), so the list and
 * the detail page's "N/M 결과" always agree.
 */

type Station = { id?: string | null; name?: string | null; code?: string | null };

export type StationProgressReview = {
  submission_id: string;
  station_id: string | null;
  status: string | null;
  track_results?: unknown;
  station?: Station | Station[] | null;
};

export type PendingStation = {
  code: string | null;
  name: string;
  /** TBS, CBS, KISS … for the list chips; the full name goes in the tooltip. */
  shortName: string;
  /** Set when the station needs a decision rather than a result (보완 요청, WBS 심의곡 확인). */
  attention: string | null;
};

export type AlbumStationProgress = {
  total: number;
  completed: number;
  pending: PendingStation[];
};

const one = (station: StationProgressReview["station"]) =>
  (Array.isArray(station) ? station[0] : station) ?? null;

/** Stations a package expects that have no review row yet read as 접수예정. */
export function summarizeAlbumStationProgress(input: {
  expectedCodes: readonly string[];
  catalog: readonly Station[];
  reviews: readonly StationProgressReview[];
  albumTracks?: readonly AlbumTrackMeta[] | null;
}): AlbumStationProgress {
  const albumTracks = sortByTrackNo(input.albumTracks ?? []);
  const rows = input.reviews.map((review) => ({ status: review.status, track_results: review.track_results, station: one(review.station), stationId: review.station_id }));
  const reviewedIds = new Set(rows.map((row) => row.stationId ?? row.station?.id).filter(Boolean));
  for (const station of input.catalog) {
    if (!station.code || !input.expectedCodes.includes(station.code)) continue;
    if (station.id && reviewedIds.has(station.id)) continue;
    rows.push({ status: "NOT_SENT", track_results: null, station, stationId: station.id ?? null });
  }
  // The package's broadcaster order (MBC, KBS, SBS, …), then any other station.
  const rank = (code?: string | null) => {
    const index = code ? input.expectedCodes.indexOf(code) : -1;
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  rows.sort((a, b) => rank(a.station?.code) - rank(b.station?.code));

  const pending: PendingStation[] = [];
  let completed = 0;
  for (const row of rows) {
    const display = getStationReviewDisplayStatus({ status: row.status, track_results: row.track_results, station: row.station }, { albumTracks });
    if (display.isComplete) {
      completed += 1;
      continue;
    }
    const name = row.station?.name || row.station?.code || "방송사";
    pending.push({
      code: row.station?.code ?? null,
      name,
      shortName: (row.station?.code && stationShortNameByCode[row.station.code]) || name,
      attention: display.needsAttention ? display.label : null,
    });
  }
  return { total: rows.length, completed, pending };
}

export type StationProgressRow = {
  id: string;
  type: string;
  status: string | null;
  payment_status: string | null;
  package?: { name?: string | null; station_count?: number | null } | Array<{ name?: string | null; station_count?: number | null }> | null;
};

/** Paid albums only: before payment no station has been sent, and a refund ends the review. */
export const tracksStationProgress = (row: StationProgressRow) =>
  row.type === "ALBUM" && row.payment_status === "PAID" && row.status !== "DRAFT";

const missingTrackColumn = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /track_results/.test(error.message ?? "")));

/**
 * One query per table for the whole list page. A failed lookup returns no
 * entry for the page, so the list shows nothing rather than a wrong count.
 */
export async function loadAlbumStationProgress(
  db: SupabaseClient,
  rows: readonly StationProgressRow[],
): Promise<Map<string, AlbumStationProgress>> {
  const progress = new Map<string, AlbumStationProgress>();
  const albums = rows.filter(tracksStationProgress);
  if (albums.length === 0) return progress;
  const ids = albums.map((row) => row.id);
  const expectedCodesById = new Map(albums.map((row) => {
    const pkg = Array.isArray(row.package) ? row.package[0] : row.package;
    return [row.id, getPackageStationCodes(pkg?.station_count, pkg?.name)];
  }));
  const allCodes = [...new Set([...expectedCodesById.values()].flat())];

  const reviewSelect = (tracks: string) =>
    `submission_id, station_id, status${tracks}, station:stations ( id, name, code )`;
  const [reviewResult, trackResult, catalogResult] = await Promise.all([
    db.from("station_reviews").select(reviewSelect(", track_results:track_results_json")).in("submission_id", ids),
    db.from("album_tracks").select("submission_id, id, track_no, track_title, track_title_kr, track_title_en, broadcast_selected").in("submission_id", ids),
    allCodes.length
      ? db.from("stations").select("id, name, code").in("code", allCodes)
      : Promise.resolve({ data: [] as Station[], error: null }),
  ]);
  let reviewData = reviewResult.data as unknown as StationProgressReview[] | null;
  let reviewError = reviewResult.error;
  if (missingTrackColumn(reviewError)) {
    const legacy = await db.from("station_reviews").select(reviewSelect(", track_results")).in("submission_id", ids);
    reviewData = legacy.data as unknown as StationProgressReview[] | null;
    reviewError = legacy.error;
  }
  if (reviewError || trackResult.error || catalogResult.error) {
    console.warn("[admin submissions] station progress unavailable", reviewError ?? trackResult.error ?? catalogResult.error);
    return progress;
  }

  const reviewsById = new Map<string, StationProgressReview[]>();
  for (const review of reviewData ?? []) {
    const list = reviewsById.get(review.submission_id) ?? [];
    list.push(review);
    reviewsById.set(review.submission_id, list);
  }
  const tracksById = new Map<string, AlbumTrackMeta[]>();
  for (const track of (trackResult.data ?? []) as Array<AlbumTrackMeta & { submission_id: string }>) {
    const list = tracksById.get(track.submission_id) ?? [];
    list.push(track);
    tracksById.set(track.submission_id, list);
  }
  const catalog = (catalogResult.data ?? []) as Station[];

  for (const id of ids) {
    const summary = summarizeAlbumStationProgress({
      expectedCodes: expectedCodesById.get(id) ?? [],
      catalog,
      reviews: reviewsById.get(id) ?? [],
      albumTracks: tracksById.get(id) ?? [],
    });
    if (summary.total > 0) progress.set(id, summary);
  }
  return progress;
}

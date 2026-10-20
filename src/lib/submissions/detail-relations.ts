import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { SubmissionFile } from "@/features/submissions/submission-files-panel";

export type DetailStation = {
  id: string;
  name: string | null;
  code: string | null;
};

export type DetailStationReview = {
  id: string;
  submission_id: string;
  station_id: string | null;
  status: string;
  result_note: string | null;
  track_results?: unknown;
  updated_at: string;
  station: DetailStation | null;
};

const stationReviewFields =
  "id, submission_id, station_id, status, result_note, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code )";

async function loadStationReviews(client: SupabaseClient, submissionId: string) {
  let result: { data: unknown; error: PostgrestError | null } = {
    data: null,
    error: null,
  };
  // Older installations may still have the legacy track-results column.
  for (const trackFields of [
    ", track_results:track_results_json",
    ", track_results",
    "",
  ]) {
    result = await client
      .from("station_reviews")
      .select(`${stationReviewFields}${trackFields}`)
      .eq("submission_id", submissionId)
      .order("updated_at", { ascending: false });
    if (
      !result.error ||
      !/track_results/i.test(result.error.message) ||
      !["42703", "PGRST204"].includes(result.error.code)
    ) break;
  }
  const rows = result.data as Array<
    Omit<DetailStationReview, "station"> & {
      station: DetailStation | DetailStation[] | null;
    }
  > | null;
  return {
    data: rows?.map((row) => ({
      ...row,
      station: Array.isArray(row.station) ? row.station[0] ?? null : row.station,
    })) ?? null,
    error: result.error,
  };
}

/**
 * Read only after the caller authorizes the submission. Independent relations
 * start together; neither this helper nor a page visit backfills database rows.
 * Results are never cached across users or requests.
 */
export async function loadSubmissionDetailRelations(
  client: SupabaseClient,
  submissionId: string,
  packageId?: string | null,
) {
  const [reviews, files, packageStations] = await Promise.all([
    loadStationReviews(client, submissionId),
    client
      .from("submission_files")
      .select("id, kind, file_path, original_name, mime, size, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false }),
    packageId
      ? client
          .from("package_stations")
          .select("station:stations ( id, code, name )")
          .eq("package_id", packageId)
      : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    reviews,
    files: { data: files.data as SubmissionFile[] | null, error: files.error },
    packageStations: {
      data: (packageStations.data ?? []).flatMap((row) => {
        const station = Array.isArray(row.station) ? row.station[0] : row.station;
        return station ? [station as DetailStation] : [];
      }),
      error: packageStations.error,
    },
  };
}

export function preservePendingStationReviews<
  T extends { id: string; station?: { id?: string; code?: string | null } | null },
>(previous: T[], current: T[]): T[] {
  const stationIds = new Set(current.map((review) => review.station?.id).filter(Boolean));
  const stationCodes = new Set(current.map((review) => review.station?.code).filter(Boolean));
  return [
    ...current,
    ...previous.filter((review) =>
      review.id.startsWith("placeholder-") &&
      !stationIds.has(review.station?.id) &&
      !stationCodes.has(review.station?.code),
    ),
  ];
}

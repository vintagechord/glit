import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAlbumStationReviews, getPackageStations } from "@/lib/station-reviews";
import { normalizeTrackResults } from "@/lib/track-results";

type DashboardSubmission =
  | {
      id: string;
      title: string | null;
      artist_name?: string | null;
      artist?:
        | { id?: string | null; name?: string | null }
        | Array<{ id?: string | null; name?: string | null }>
        | null;
      artist_id?: string | null;
      status: string;
      updated_at: string;
      payment_status?: string | null;
      package_id?: string | null;
      package?: { name?: string | null; station_count?: number | null }[];
    }
  | {
      id: string;
      title: string | null;
      artist_name?: string | null;
      artist?:
        | { id?: string | null; name?: string | null }
        | Array<{ id?: string | null; name?: string | null }>
        | null;
      artist_id?: string | null;
      status: string;
      updated_at: string;
      payment_status?: string | null;
      type: string;
      package_id?: string | null;
      package?: { name?: string | null; station_count?: number | null }[];
    };

type StationReviewRow = {
  id: string;
  submission_id: string;
  station_id: string | null;
  status: string;
  result_note?: string | null;
  updated_at: string;
  track_results?: unknown;
  station?:
    | { id?: string | null; name?: string | null; code?: string | null }
    | Array<{ id?: string | null; name?: string | null; code?: string | null }>
    | null;
};

export type DashboardStatusData = {
  albumSubmissions: DashboardSubmission[];
  mvSubmissions: DashboardSubmission[];
  albumStationsMap: Record<string, StationReviewRow[]>;
  mvStationsMap: Record<string, StationReviewRow[]>;
};

export type DashboardStatusResult = {
  data?: DashboardStatusData;
  error?: string;
};

export const getDashboardStatusData = async (userId: string): Promise<DashboardStatusResult> => {
  const recentResultCutoff = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const isResultNotifiedMissing = (error?: { message?: string; code?: string | number }) =>
    Boolean(
      error &&
        (error.code === "42703" ||
          error.code === "42P01" ||
          error.message?.toLowerCase().includes("result_notified_at")),
    );

  const admin = createAdminClient();

  const buildAlbumBase = () =>
    admin
      .from("submissions")
      .select(
        "id, title, artist_name, artist_id, artist:artists ( id, name ), status, updated_at, payment_status, package_id, package:packages ( name, station_count )",
      )
      .eq("user_id", userId)
      .eq("type", "ALBUM")
      .not("status", "eq", "DRAFT");

  const buildMvBase = () =>
    admin
      .from("submissions")
      .select("id, title, artist_name, artist_id, artist:artists ( id, name ), status, updated_at, payment_status, type, package_id, package:packages ( name, station_count )")
      .eq("user_id", userId)
      .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
      .not("status", "eq", "DRAFT");

  const recentWindowOr =
    `and(updated_at.gte.${recentResultCutoff},or(result_notified_at.is.null,result_notified_at.gte.${recentResultCutoff}))`;

  const maxRows = 4999;

  let albumResult = await buildAlbumBase()
    .or(recentWindowOr)
    .order("updated_at", { ascending: false })
    .range(0, maxRows);

  if (albumResult.error && isResultNotifiedMissing(albumResult.error)) {
    console.warn("[dashboard status] result_notified_at missing for album, falling back", albumResult.error);
    albumResult = await buildAlbumBase()
      .gte("updated_at", recentResultCutoff)
      .order("updated_at", { ascending: false })
      .range(0, 1999);
  } else if (albumResult.error) {
    console.error("[dashboard status] album query error", albumResult.error);
    return { error: "ALBUM_QUERY_FAILED" };
  }

  let mvResult = await buildMvBase()
    .or(recentWindowOr)
    .order("updated_at", { ascending: false })
    .range(0, maxRows);

  if (mvResult.error && isResultNotifiedMissing(mvResult.error)) {
    console.warn("[dashboard status] result_notified_at missing for mv, falling back", mvResult.error);
    mvResult = await buildMvBase()
      .gte("updated_at", recentResultCutoff)
      .order("updated_at", { ascending: false })
      .range(0, 1999);
  } else if (mvResult.error) {
    console.error("[dashboard status] mv query error", mvResult.error);
    return { error: "MV_QUERY_FAILED" };
  }

  const resolveArtistName = (submission: DashboardSubmission) => {
    const artist = submission.artist;
    const artistName = Array.isArray(artist) ? artist[0]?.name : artist?.name;
    const trimmed = artistName?.trim() || submission.artist_name?.trim() || null;
    return trimmed || null;
  };

  const albumSubmissions = ((albumResult.data ?? []) as DashboardSubmission[]).map(
    (row) => ({
      ...row,
      artist_name: resolveArtistName(row),
    }),
  );
  const mvSubmissions = ((mvResult.data ?? []) as DashboardSubmission[]).map(
    (row) => ({
      ...row,
      artist_name: resolveArtistName(row),
    }),
  );

  const allSubmissionIds = [...albumSubmissions, ...mvSubmissions]
    .map((item) => item.id)
    .filter(Boolean);

  const packageIds = Array.from(
    new Set(
      [...albumSubmissions, ...mvSubmissions]
        .map((item) => item.package_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const packageMap = new Map<
    string,
    { id: string; name: string | null; station_count: number | null }
  >();

  const packageStationsMap = new Map<
    string,
    Array<{ id: string; code: string | null; name: string | null }>
  >();

  const resolvePackage = (submission: DashboardSubmission) => {
    const pkg = Array.isArray(submission.package)
      ? submission.package?.[0]
      : submission.package ?? null;
    return pkg ?? null;
  };

  if (packageIds.length) {
    const { data: packages, error: packageError } = await admin
      .from("packages")
      .select("id, name, station_count")
      .in("id", packageIds);
    if (packageError) {
      console.error("[dashboard status] package fallback query error", packageError);
    }
    (packages ?? []).forEach((pkg) => {
      packageMap.set(pkg.id, {
        id: pkg.id,
        name: pkg.name ?? null,
        station_count: pkg.station_count ?? null,
      });
    });

    const { data: packageStations, error: packageStationsError } = await admin
      .from("package_stations")
      .select("package_id, station:stations ( id, code, name )")
      .in("package_id", packageIds);

    if (packageStationsError) {
      console.error("[dashboard status] package_stations query error", packageStationsError);
    }

    (packageStations ?? []).forEach((row) => {
      const pkgId = row.package_id;
      const stations = Array.isArray(row.station)
        ? row.station
        : row.station
          ? [row.station]
          : [];
      if (!pkgId || stations.length === 0) return;

      const current = packageStationsMap.get(pkgId) ?? [];
      const merged = [...current];
      stations.forEach((station) => {
        if (!station) return;
        const key = station.id ?? station.code ?? "";
        if (!key) return;
        if (merged.some((s) => (s.id ?? s.code) === key)) return;
        merged.push({ id: station.id, code: station.code ?? null, name: station.name ?? null });
      });
      packageStationsMap.set(pkgId, merged);
    });
  }

  await Promise.all(
    albumSubmissions.map(async (submission) => {
      const pkg = Array.isArray(submission.package) ? submission.package[0] : submission.package;
      const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;
      const resolvedName = pkg?.name ?? fallbackPkg?.name ?? null;
      const resolvedCount = pkg?.station_count ?? fallbackPkg?.station_count ?? null;
      await ensureAlbumStationReviews(admin, submission.id, resolvedCount, resolvedName);
    }),
  );
  await Promise.all(
    mvSubmissions.map(async (submission) => {
      const pkg = Array.isArray(submission.package) ? submission.package[0] : submission.package;
      const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;
      const resolvedName = pkg?.name ?? fallbackPkg?.name ?? null;
      const resolvedCount = pkg?.station_count ?? fallbackPkg?.station_count ?? null;
      await ensureAlbumStationReviews(admin, submission.id, resolvedCount, resolvedName);
    }),
  );

  const albumStationsMap: Record<string, StationReviewRow[]> = {};
  const mvStationsMap: Record<string, StationReviewRow[]> = {};

  if (allSubmissionIds.length) {
    const withoutTracks =
      "id, submission_id, station_id, status, result_note, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code )";
    const withLegacyTracks =
      "id, submission_id, station_id, status, result_note, track_results, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code )";

    const reviewResult = await admin
      .from("station_reviews")
      .select(
        "id, submission_id, station_id, status, result_note, track_results:track_results_json, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code )",
      )
      .in("submission_id", allSubmissionIds)
      .order("updated_at", { ascending: false });

    const missingTrackColumn =
      reviewResult.error &&
      (reviewResult.error.message?.toLowerCase().includes("track_results_json") ||
        reviewResult.error.message?.toLowerCase().includes("track_results") ||
        reviewResult.error.code === "42703");

    let reviewRows = (reviewResult.data ?? []) as StationReviewRow[];
    if (missingTrackColumn) {
      const legacy = await admin
        .from("station_reviews")
        .select(withLegacyTracks)
        .in("submission_id", allSubmissionIds)
        .order("updated_at", { ascending: false });
      if (legacy.error) {
        reviewRows =
          (
            await admin
              .from("station_reviews")
              .select(withoutTracks)
              .in("submission_id", allSubmissionIds)
              .order("updated_at", { ascending: false })
          ).data ?? [];
      } else {
        reviewRows = (legacy.data ?? []) as StationReviewRow[];
      }
    }

    if (reviewResult.error && !reviewRows.length) {
      console.error("[dashboard status] station_reviews join error", reviewResult.error);
      const fallback = await admin
        .from("station_reviews")
        .select(
          missingTrackColumn
            ? "id, submission_id, station_id, status, result_note, track_results, updated_at, station:stations ( id, name, code )"
            : "id, submission_id, station_id, status, result_note, track_results:track_results_json, updated_at, station:stations ( id, name, code )",
        )
        .in("submission_id", allSubmissionIds)
        .order("updated_at", { ascending: false });
      if (fallback.error) {
        console.error("[dashboard status] station_reviews fallback join error", fallback.error);
      }
      reviewRows = (fallback.data ?? reviewRows) as StationReviewRow[];
    }

    const reviewMap = new Map<
      string,
      { byId: Map<string, StationReviewRow>; byCode: Map<string, StationReviewRow> }
    >();
    reviewRows.forEach((row) => {
      const submissionId = row.submission_id;
      if (!submissionId) return;
      const normalizedStation = Array.isArray(row.station)
        ? row.station[0]
        : row.station ?? null;
      const stationId = row.station_id || normalizedStation?.id || null;
      const stationCode = normalizedStation?.code ?? null;
      const entry = reviewMap.get(submissionId) ?? {
        byId: new Map<string, StationReviewRow>(),
        byCode: new Map<string, StationReviewRow>(),
      };
      const normalizedRow = { ...row, station: normalizedStation };
      if (stationId) {
        entry.byId.set(stationId, normalizedRow);
      }
      if (stationCode) {
        entry.byCode.set(stationCode, normalizedRow);
      }
      reviewMap.set(submissionId, entry);
    });

    const logoFor = (code?: string | null) =>
      code ? admin.storage.from("broadcast").getPublicUrl(`${code}.png`).data.publicUrl ?? null : null;

    const buildRows = (
      submission: DashboardSubmission,
      targetMap: Record<string, StationReviewRow[]>,
    ) => {
      const pkg = resolvePackage(submission);
      const fallbackPackage = submission.package_id ? packageMap.get(submission.package_id) : null;
      const resolvedCount = pkg?.station_count ?? fallbackPackage?.station_count ?? null;
      const resolvedName = pkg?.name ?? fallbackPackage?.name ?? null;

      const reviewLookup = reviewMap.get(submission.id);
      const reviewsById = reviewLookup?.byId ?? new Map<string, StationReviewRow>();
      const reviewsByCode = reviewLookup?.byCode ?? new Map<string, StationReviewRow>();
      const expectedStations = getPackageStations(resolvedCount, resolvedName);
      const fallbackStations = submission.package_id
        ? packageStationsMap.get(submission.package_id) ?? []
        : [];
      const fallbackByCode = new Map(
        fallbackStations
          .filter((station) => Boolean(station.code))
          .map((station) => [station.code as string, station]),
      );
      const resolvedStations = expectedStations.map((station) => {
        const fallback = station.code ? fallbackByCode.get(station.code) : null;
        return {
          id: String(fallback?.id ?? station.code ?? station.name ?? ""),
          code: station.code ?? fallback?.code ?? null,
          name: station.name ?? fallback?.name ?? station.code ?? null,
        };
      });

      const stationList =
        resolvedStations.length > 0
          ? resolvedStations
          : fallbackStations.length > 0
            ? fallbackStations
            : [];

      const rows =
        stationList.length > 0
          ? stationList.map((station) => {
              const review =
                (station.id ? reviewsById.get(station.id) : undefined) ??
                (station.code ? reviewsByCode.get(station.code) : undefined);
              const normalizedTrackResults = normalizeTrackResults(review?.track_results);
              return {
                id: review?.id ?? `placeholder-${submission.id}-${station.id}`,
                submission_id: submission.id,
                station_id: review?.station_id ?? (typeof station.id === "string" ? station.id : null),
                status: review?.status ?? "NOT_SENT",
                result_note: review?.result_note ?? null,
                track_results: normalizedTrackResults.length ? normalizedTrackResults : null,
                updated_at: review?.updated_at ?? submission.updated_at,
                station: {
                  id: station.id,
                  code: station.code,
                  name: station.name,
                  logo_url: logoFor(station.code ?? undefined),
                },
              };
            })
          : [];

      if (rows.length === 0 && (reviewsById.size || reviewsByCode.size)) {
        const seen = new Set<string>();
        const pushReview = (review: StationReviewRow) => {
          if (seen.has(review.id)) return;
          seen.add(review.id);
          const station = Array.isArray(review.station)
            ? review.station[0]
            : review.station ?? {};
          const normalizedTrackResults = normalizeTrackResults(review.track_results);
          rows.push({
            id: review.id,
            submission_id: review.submission_id,
            station_id: review.station_id ?? null,
            status: review.status,
            result_note: review.result_note ?? null,
            track_results: normalizedTrackResults.length ? normalizedTrackResults : null,
            updated_at: review.updated_at,
            station: {
              id: String(station.id ?? station.code ?? ""),
              code: station.code ?? null,
              name: station.name ?? null,
              logo_url: logoFor(station.code ?? undefined),
            },
          });
        };
        reviewsById.forEach(pushReview);
        reviewsByCode.forEach(pushReview);
      }

      if (rows.length === 0) {
        rows.push({
          id: `placeholder-${submission.id}`,
          submission_id: submission.id,
          station_id: null,
          status: submission.status || "NOT_SENT",
          result_note: null,
          track_results: null,
          updated_at: submission.updated_at,
          station: {
            id: "",
            code: "",
            name: pkg?.name ?? "선택 방송국",
            logo_url: "/station-logos/default.svg",
          },
        });
      }

      targetMap[submission.id] = rows;
    };

    albumSubmissions.forEach((submission) => buildRows(submission, albumStationsMap));
    mvSubmissions.forEach((submission) => buildRows(submission, mvStationsMap));
  }

  return {
    data: {
      albumSubmissions,
      mvSubmissions,
      albumStationsMap,
      mvStationsMap,
    },
  };
};

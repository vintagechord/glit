import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAlbumStationReviews, getPackageStations } from "@/lib/station-reviews";
import { normalizeTrackResults } from "@/lib/track-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardSubmission =
  | {
      id: string;
      title: string | null;
      artist_name?: string | null;
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

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

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
        "id, title, artist_name, status, updated_at, payment_status, package_id, package:packages ( name, station_count )",
      )
      .eq("user_id", user.id)
      .eq("type", "ALBUM")
      .not("status", "eq", "DRAFT");

  const buildMvBase = () =>
    admin
      .from("submissions")
      .select("id, title, artist_name, status, updated_at, payment_status, type, package_id, package:packages ( name, station_count )")
      .eq("user_id", user.id)
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
    return NextResponse.json({ error: "ALBUM_QUERY_FAILED" }, { status: 500 });
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
    return NextResponse.json({ error: "MV_QUERY_FAILED" }, { status: 500 });
  }

  const albumSubmissions = (albumResult.data ?? []) as Array<{
    id: string;
    title: string | null;
    artist_name?: string | null;
    status: string;
    updated_at: string;
    payment_status?: string | null;
    package_id?: string | null;
    package?: { name?: string | null; station_count?: number | null }[];
  }>;

  const mvSubmissions = (mvResult.data ?? []) as Array<{
    id: string;
    title: string | null;
    artist_name?: string | null;
    status: string;
    updated_at: string;
    payment_status?: string | null;
    type: string;
    package_id?: string | null;
    package?: { name?: string | null; station_count?: number | null }[];
  }>;

  const allSubmissionIds = [...albumSubmissions, ...mvSubmissions]
    .map((item) => item.id)
    .filter(Boolean);

  // Load package info via admin as fallback when user-facing join is empty (RLS)
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
        merged.push({
          id: station.id,
          code: station.code ?? null,
          name: station.name ?? null,
        });
      });
      packageStationsMap.set(pkgId, merged);
    });
  }

  // Ensure station review placeholders exist so 진행 상황 리스트 shows all stations even pre-payment.
  if (albumSubmissions.length) {
    const tasks = albumSubmissions.map(async (submission: DashboardSubmission) => {
      const pkg = Array.isArray(submission.package)
        ? submission.package[0]
        : submission.package;
      const fallbackPkg = submission.package_id
        ? packageMap.get(submission.package_id)
        : null;

      const resolvedName = pkg?.name ?? fallbackPkg?.name ?? null;
      const resolvedCount = pkg?.station_count ?? fallbackPkg?.station_count ?? null;

      try {
        await ensureAlbumStationReviews(
          admin,
          submission.id,
          resolvedCount,
          resolvedName,
        );
      } catch (error) {
        console.warn("[dashboard status] ensure stations failed", error);
      }
    });
    await Promise.allSettled(tasks);
  }

  const albumStationsMap: Record<string, unknown[]> = {};
  const mvStationsMap: Record<string, unknown[]> = {};

  if (allSubmissionIds.length) {
    const withTracksSelect =
      "id, submission_id, station_id, status, result_note, updated_at, track_results:track_results_json, station:stations!station_reviews_station_id_fkey ( id, name, code )";
    const legacyTracksSelect =
      "id, submission_id, station_id, status, result_note, updated_at, track_results, station:stations!station_reviews_station_id_fkey ( id, name, code )";
    const noTracksSelect =
      "id, submission_id, station_id, status, result_note, updated_at, station:stations!station_reviews_station_id_fkey ( id, name, code )";

    const { data: initialStationData, error: stationReviewsError } = await admin
      .from("station_reviews")
      .select(withTracksSelect)
      .in("submission_id", allSubmissionIds)
      .order("updated_at", { ascending: false });
    let data: StationReviewRow[] | null = (initialStationData as StationReviewRow[] | null) ?? null;

    if (stationReviewsError) {
      console.error("[dashboard status] station_reviews join error", stationReviewsError);
      const missingTrackColumn =
        stationReviewsError.code === "42703" ||
        stationReviewsError.message?.toLowerCase().includes("track_results_json") ||
        stationReviewsError.message?.toLowerCase().includes("track_results");
      if (missingTrackColumn) {
        const legacy = await admin
          .from("station_reviews")
          .select(legacyTracksSelect)
          .in("submission_id", allSubmissionIds)
          .order("updated_at", { ascending: false });
        data = (legacy.data as StationReviewRow[] | null) ?? null;
        if (legacy.error) {
          const fallback = await admin
            .from("station_reviews")
            .select(noTracksSelect)
            .in("submission_id", allSubmissionIds)
            .order("updated_at", { ascending: false });
          data = (fallback.data as StationReviewRow[] | null) ?? null;
          if (fallback.error) {
            console.error("[dashboard status] station_reviews fallback join error", fallback.error);
            data = null;
          }
        }
      } else {
        const fallback = await admin
          .from("station_reviews")
          .select(withTracksSelect)
          .in("submission_id", allSubmissionIds)
          .order("updated_at", { ascending: false });
        data = (fallback.data as StationReviewRow[] | null) ?? null;
        if (fallback.error) {
          console.error("[dashboard status] station_reviews fallback join error", fallback.error);
          data = null;
        }
      }
    }

    const reviewMap = new Map<string, Map<string, StationReviewRow>>();

    (data ?? []).forEach((review) => {
      const r = review as StationReviewRow;
      const submissionId = r.submission_id;
      const stationRel = r.station;
      const stationList = Array.isArray(stationRel)
        ? stationRel.filter(Boolean)
        : stationRel
          ? [stationRel]
          : [];
      const candidates = stationList.length ? stationList : [null];
      candidates.forEach((stationRelItem) => {
        const stationId =
          r.station_id ??
          stationRelItem?.id ??
          stationRelItem?.code ??
          null;
        if (!submissionId || !stationId) return;
        const normalizedStation = stationRelItem;
        const map = reviewMap.get(submissionId) ?? new Map();
        if (!map.has(stationId)) {
          map.set(stationId, {
            ...r,
            station: normalizedStation,
          });
        }
        reviewMap.set(submissionId, map);
      });
    });

    const logoCache = new Map<string, string | null>();
    const logoFor = (code?: string | null) => {
      const safe = code?.toString().replace(/[^A-Za-z0-9_-]/g, "");
      if (!safe) return "/station-logos/default.svg";
      const cacheKey = safe.toLowerCase();
      if (logoCache.has(cacheKey)) return logoCache.get(cacheKey) ?? "/station-logos/default.svg";

      const tryUrl = (path: string) =>
        admin.storage.from("broadcast").getPublicUrl(path).data.publicUrl ?? null;

      const lowerUrl = tryUrl(`${safe.toLowerCase()}.png`);
      const upperUrl = lowerUrl ? null : tryUrl(`${safe.toUpperCase()}.png`);
      const url = lowerUrl ?? upperUrl ?? "/station-logos/default.svg";
      if (url !== "/station-logos/default.svg") {
        logoCache.set(cacheKey, url);
      }
      return url;
    };

    const buildRows = (
      submission: (typeof albumSubmissions)[number] | (typeof mvSubmissions)[number],
      targetMap: Record<string, unknown[]>,
    ) => {
      const isMv = (submission as { type?: string }).type && (submission as { type?: string }).type !== "ALBUM";

      let pkgStations =
        submission.package_id && packageStationsMap.has(submission.package_id)
          ? packageStationsMap.get(submission.package_id) ?? []
          : [];

      if (!pkgStations.length && !isMv) {
        const pkg = resolvePackage(submission);
        const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;
        const resolvedName = pkg?.name ?? fallbackPkg?.name ?? null;
        const resolvedCount = pkg?.station_count ?? fallbackPkg?.station_count ?? null;
        pkgStations = getPackageStations(resolvedCount, resolvedName).map((station) => ({
          id: "",
          code: station.code,
          name: station.name,
        }));
      }
      if (!pkgStations.length && isMv) {
        const pkg = resolvePackage(submission);
        const fallbackPkg = submission.package_id ? packageMap.get(submission.package_id) : null;
        const name = pkg?.name ?? fallbackPkg?.name ?? "선택 방송국";
        pkgStations = [
          {
            id: "",
            code: submission.package_id ?? "",
            name,
          },
        ];
      }
      const reviews = reviewMap.get(submission.id) ?? new Map();

      const rows =
        pkgStations.length > 0
          ? pkgStations.map((station) => {
              const reviewKey = station.id ?? station.code ?? null;
              const review = reviewKey ? reviews.get(reviewKey) : null;
              const isLatest = review ? true : false;
              const normalizedTracks = review
                ? normalizeTrackResults(review.track_results)
                : null;
              return {
                id: review?.id ?? `placeholder-${submission.id}-${station.code ?? station.id ?? "station"}`,
                submission_id: submission.id,
                status: review?.status ?? submission.status ?? "NOT_SENT",
                result_note: review?.result_note ?? null,
                track_results: normalizedTracks,
                updated_at: isLatest ? review?.updated_at ?? submission.updated_at : submission.updated_at,
                station: {
                  id: station.id,
                  code: station.code,
                  name: station.name,
                  logo_url: logoFor(station.code ?? undefined),
                },
              };
            })
          : [];

      if (rows.length === 0 && reviews.size) {
        reviews.forEach((review) => {
          const station = Array.isArray(review.station)
            ? review.station[0]
            : review.station ?? {};
          rows.push({
            ...review,
            station: {
              ...station,
              logo_url: logoFor(station.code ?? undefined),
            },
          });
        });
      }

      if (rows.length === 0) {
        const pkg = resolvePackage(submission);
        rows.push({
          id: `placeholder-${submission.id}`,
          submission_id: submission.id,
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

  return NextResponse.json(
    {
      albumSubmissions,
      mvSubmissions,
      albumStationsMap,
      mvStationsMap,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}

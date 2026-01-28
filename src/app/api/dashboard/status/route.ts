import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const buildAlbumBase = () =>
    supabase
      .from("submissions")
      .select(
        "id, title, artist_name, status, updated_at, payment_status, package_id, package:packages ( name, station_count )",
      )
      .eq("user_id", user.id)
      .eq("type", "ALBUM")
      .not("status", "eq", "DRAFT");

  const buildMvBase = () =>
    supabase
      .from("submissions")
      .select("id, title, artist_name, status, updated_at, payment_status, type, package_id, package:packages ( name, station_count )")
      .eq("user_id", user.id)
      .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
      .not("status", "eq", "DRAFT");

  let albumResult = await buildAlbumBase()
    .or(`result_notified_at.is.null,result_notified_at.gte.${recentResultCutoff}`)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (albumResult.error && isResultNotifiedMissing(albumResult.error)) {
    console.warn("[dashboard status] result_notified_at missing for album, falling back", albumResult.error);
    albumResult = await buildAlbumBase()
      .not("status", "in", "(RESULT_READY,COMPLETED)")
      .order("updated_at", { ascending: false })
      .limit(5);
  } else if (albumResult.error) {
    console.error("[dashboard status] album query error", albumResult.error);
  }

  let mvResult = await buildMvBase()
    .or(`result_notified_at.is.null,result_notified_at.gte.${recentResultCutoff}`)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (mvResult.error && isResultNotifiedMissing(mvResult.error)) {
    console.warn("[dashboard status] result_notified_at missing for mv, falling back", mvResult.error);
    mvResult = await buildMvBase()
      .not("status", "in", "(RESULT_READY,COMPLETED)")
      .order("updated_at", { ascending: false })
      .limit(5);
  } else if (mvResult.error) {
    console.error("[dashboard status] mv query error", mvResult.error);
  }

  const admin = createAdminClient();

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
      const station = Array.isArray(row.station) ? row.station[0] : row.station;
      if (!pkgId || !station) return;
      packageStationsMap.set(pkgId, [
        ...(packageStationsMap.get(pkgId) ?? []),
        { id: station.id, code: station.code ?? null, name: station.name ?? null },
      ]);
    });
  }

  // Ensure station review placeholders exist so 진행 상황 리스트 shows all stations even pre-payment.
  if (albumSubmissions.length || mvSubmissions.length) {
    const tasks = [...albumSubmissions, ...mvSubmissions].map(async (submission: any) => {
      const pkg = Array.isArray(submission.package)
        ? submission.package[0]
        : submission.package;
      const fallbackPkg = submission.package_id
        ? packageMap.get(submission.package_id)
        : null;

      const resolvedName = pkg?.name ?? fallbackPkg?.name ?? null;
      const resolvedCount = pkg?.station_count ?? fallbackPkg?.station_count ?? null;

      console.log("[dashboard status] ensure stations", {
        submissionId: submission.id,
        packageId: submission.package_id,
        joinPkg: pkg,
        fallbackPkg,
        resolvedName,
        resolvedCount,
        expectedCount: resolvedCount,
      });

      await ensureAlbumStationReviews(
        admin,
        submission.id,
        resolvedCount,
        resolvedName,
      );
    });
    await Promise.all(tasks);
  }

  const albumStationsMap: Record<string, unknown[]> = {};
  const mvStationsMap: Record<string, unknown[]> = {};

  if (allSubmissionIds.length) {
    const albumIdSet = new Set(albumSubmissions.map((s) => s.id));
    const mvIdSet = new Set(mvSubmissions.map((s) => s.id));

    let { data, error: stationReviewsError } = await admin
      .from("station_reviews")
      .select(
        "id, submission_id, station_id, status, result_note, updated_at, track_results, station:stations!station_reviews_station_id_fkey ( id, name, code )",
      )
      .in("submission_id", allSubmissionIds)
      .order("updated_at", { ascending: false });

    if (stationReviewsError) {
      console.error("[dashboard status] station_reviews join error", stationReviewsError);
      const fallback = await admin
        .from("station_reviews")
        .select(
          "id, submission_id, station_id, status, result_note, updated_at, track_results, station:stations ( id, name, code )",
        )
        .in("submission_id", allSubmissionIds)
        .order("updated_at", { ascending: false });
      data = fallback.data;
      if (fallback.error) {
        console.error("[dashboard status] station_reviews fallback join error", fallback.error);
      }
    }

    const reviewMap = new Map<
      string,
      Map<string, any>
    >();

    (data ?? []).forEach((review: any) => {
      const submissionId = review.submission_id;
      const stationId = review.station_id || (Array.isArray(review.station) ? review.station[0]?.id : review.station?.id);
      if (!submissionId || !stationId) return;
      const normalizedStation = Array.isArray(review.station)
        ? review.station[0]
        : review.station ?? null;
      const map = reviewMap.get(submissionId) ?? new Map();
      map.set(stationId, {
        ...review,
        station: normalizedStation,
      });
      reviewMap.set(submissionId, map);
    });

    const logoFor = (code?: string | null) =>
      code
        ? admin.storage.from("broadcast").getPublicUrl(`${code}.png`).data.publicUrl ?? null
        : null;

    const buildRows = (
      submission: (typeof albumSubmissions)[number] | (typeof mvSubmissions)[number],
      targetMap: Record<string, unknown[]>,
    ) => {
      const pkgStations = submission.package_id
        ? packageStationsMap.get(submission.package_id) ?? []
        : [];
      const reviews = reviewMap.get(submission.id) ?? new Map();

      const rows = pkgStations.map((station) => {
        const review = station.id ? reviews.get(station.id) : null;
        return {
          id: review?.id ?? `placeholder-${submission.id}-${station.code ?? station.id}`,
          submission_id: submission.id,
          status: review?.status ?? submission.status ?? "NOT_SENT",
          result_note: review?.result_note ?? null,
          track_results: review?.track_results ?? null,
          updated_at: review?.updated_at ?? submission.updated_at,
          station: {
            id: station.id,
            code: station.code,
            name: station.name,
            logo_url: logoFor(station.code ?? undefined),
          },
        };
      });

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
            name: (submission as any)?.package?.[0]?.name ?? "신청 방송국",
            logo_url: null,
          },
        });
      }

      targetMap[submission.id] = rows;
    };

    albumSubmissions.forEach((submission) => buildRows(submission, albumStationsMap));
    mvSubmissions.forEach((submission) => buildRows(submission as any, mvStationsMap));
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
        "Cache-Control": "private, max-age=30",
      },
    },
  );
}

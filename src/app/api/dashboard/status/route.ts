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
        "id, submission_id, status, result_note, updated_at, track_results, station:stations!station_reviews_station_id_fkey ( name, code )",
      )
      .in("submission_id", allSubmissionIds)
      .order("updated_at", { ascending: false });

    if (stationReviewsError) {
      console.error("[dashboard status] station_reviews join error", stationReviewsError);
      const fallback = await admin
        .from("station_reviews")
        .select(
          "id, submission_id, status, result_note, updated_at, track_results, station:stations ( name, code )",
        )
        .in("submission_id", allSubmissionIds)
        .order("updated_at", { ascending: false });
      data = fallback.data;
      if (fallback.error) {
        console.error("[dashboard status] station_reviews fallback join error", fallback.error);
      }
    }

    (data ?? []).forEach((review) => {
      const normalized = {
        ...review,
        station: Array.isArray(review.station) ? review.station[0] : review.station ?? null,
      };
      if (!review.submission_id) return;
      if (albumIdSet.has(review.submission_id)) {
        albumStationsMap[review.submission_id] = [
          ...(albumStationsMap[review.submission_id] ?? []),
          normalized,
        ];
      } else if (mvIdSet.has(review.submission_id)) {
        mvStationsMap[review.submission_id] = [
          ...(mvStationsMap[review.submission_id] ?? []),
          normalized,
        ];
      }
    });
  }

  // Ensure at least one placeholder station row per submission for UI display
  const makePlaceholder = (submission: { id: string; status: string; updated_at: string; package?: { name?: string | null }[] }) => ({
    id: `placeholder-${submission.id}`,
    submission_id: submission.id,
    status: submission.status || "NOT_SENT",
    result_note: null,
    track_results: null,
    updated_at: submission.updated_at,
    station: { name: submission.package?.[0]?.name ?? "신청 방송국" },
  });

  albumSubmissions.forEach((submission) => {
    if (!albumStationsMap[submission.id] || albumStationsMap[submission.id].length === 0) {
      albumStationsMap[submission.id] = [makePlaceholder(submission)];
    }
  });

  mvSubmissions.forEach((submission) => {
    if (!mvStationsMap[submission.id] || mvStationsMap[submission.id].length === 0) {
      mvStationsMap[submission.id] = [makePlaceholder(submission as any)];
    }
  });

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

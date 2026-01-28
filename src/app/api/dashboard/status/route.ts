import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

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

  const paymentStatuses = ["PAYMENT_PENDING", "PAID"];
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
        "id, title, artist_name, status, updated_at, payment_status, package:packages ( name, station_count )",
      )
      .eq("user_id", user.id)
      .eq("type", "ALBUM")
      .in("payment_status", paymentStatuses);

  const buildMvBase = () =>
    supabase
      .from("submissions")
      .select("id, title, artist_name, status, updated_at, payment_status, type")
      .eq("user_id", user.id)
      .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
      .in("payment_status", paymentStatuses);

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

  const albumSubmissions = (albumResult.data ?? []) as Array<{
    id: string;
    title: string | null;
    artist_name?: string | null;
    status: string;
    updated_at: string;
    payment_status?: string | null;
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
  }>;

  const allSubmissionIds = [...albumSubmissions, ...mvSubmissions]
    .map((item) => item.id)
    .filter(Boolean);

  const albumStationsMap: Record<string, unknown[]> = {};
  const mvStationsMap: Record<string, unknown[]> = {};

  if (allSubmissionIds.length) {
    const albumIdSet = new Set(albumSubmissions.map((s) => s.id));
    const mvIdSet = new Set(mvSubmissions.map((s) => s.id));

    const { data } = await supabase
      .from("station_reviews")
      .select("id, submission_id, status, updated_at, track_results, station:stations ( name )")
      .in("submission_id", allSubmissionIds)
      .order("updated_at", { ascending: false });

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

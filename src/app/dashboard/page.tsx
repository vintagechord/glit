import { redirect } from "next/navigation";

import {
  DashboardShell,
  statusDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { HomeReviewPanel } from "@/features/home/home-review-panel";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "진행상황",
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
};

export async function StatusPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const normalizeStations = (
    reviews?: Array<{
      id: string;
      submission_id?: string;
      status: string;
      track_results?: unknown;
      updated_at: string;
      station?: { name?: string | null } | Array<{ name?: string | null }>;
    }> | null,
  ) =>
    (reviews ?? []).map((review) => ({
      ...review,
      submission_id: (review as { submission_id?: string }).submission_id,
      station: Array.isArray(review.station)
        ? review.station[0]
        : review.station ?? null,
    }));

  const finalizedStatuses = ["RESULT_READY", "COMPLETED"];
  const paymentStatuses = ["PAYMENT_PENDING", "PAID"];
  const [albumResult, mvResult] = await Promise.all([
    supabase
      .from("submissions")
      .select(
        "id, title, artist_name, status, updated_at, payment_status, package:packages ( name, station_count )",
      )
      .eq("user_id", user.id)
      .eq("type", "ALBUM")
      .in("payment_status", paymentStatuses)
      .not("status", "in", `(${finalizedStatuses.join(",")})`)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("submissions")
      .select("id, title, artist_name, status, updated_at, payment_status, type")
      .eq("user_id", user.id)
      .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
      .in("payment_status", paymentStatuses)
      .not("status", "in", `(${finalizedStatuses.join(",")})`)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const albumStationsMap: Record<
    string,
    Array<{
      id: string;
      status: string;
      updated_at: string;
      station?: { name?: string | null } | null;
    }>
  > = {};
  const mvStationsMap: Record<
    string,
    Array<{
      id: string;
      status: string;
      updated_at: string;
      station?: { name?: string | null } | null;
    }>
  > = {};

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

  const albumSubmissionIds = albumSubmissions.map((submission) => submission.id).filter(Boolean);
  const mvSubmissionIds = mvSubmissions.map((submission) => submission.id).filter(Boolean);
  const allSubmissionIds = [...albumSubmissionIds, ...mvSubmissionIds];
  if (allSubmissionIds.length) {
    const albumIdSet = new Set(albumSubmissionIds);
    const mvIdSet = new Set(mvSubmissionIds);
    const { data } = await supabase
      .from("station_reviews")
      .select("id, submission_id, status, updated_at, station:stations ( name )")
      .in("submission_id", allSubmissionIds)
      .order("updated_at", { ascending: false });
    data
      ?.map((review) => normalizeStations([review])[0])
      .filter(Boolean)
      .forEach((review) => {
        if (!review?.submission_id) return;
        if (albumIdSet.has(review.submission_id)) {
          albumStationsMap[review.submission_id] = [
            ...(albumStationsMap[review.submission_id] ?? []),
            review,
          ];
          return;
        }
        if (mvIdSet.has(review.submission_id)) {
          mvStationsMap[review.submission_id] = [
            ...(mvStationsMap[review.submission_id] ?? []),
            review,
          ];
        }
      });
  }

  return (
    <DashboardShell
      title="접수 현황"
      description="접수한 심의의 현재 상태를 확인할 수 있습니다."
      activeTab="status"
      tabs={config?.tabs ?? statusDashboardTabs}
      contextLabel={config?.contextLabel ?? "진행상황"}
    >
      <HomeReviewPanel
        isLoggedIn
        albumSubmissions={albumSubmissions}
        mvSubmissions={mvSubmissions}
        albumStationsMap={albumStationsMap}
        mvStationsMap={mvStationsMap}
        hideEmptyTabs={false}
        forceLiveBadge
      />
    </DashboardShell>
  );
}

export default async function DashboardPage() {
  return StatusPageView();
}

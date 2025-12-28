import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HomeReviewPanel } from "@/features/home/home-review-panel";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "마이페이지",
};

export default async function DashboardPage() {
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
      status: string;
      updated_at: string;
      station?: { name?: string | null } | Array<{ name?: string | null }>;
    }> | null,
  ) =>
    (reviews ?? []).map((review) => ({
      ...review,
      station: Array.isArray(review.station)
        ? review.station[0]
        : review.station ?? null,
    }));

  const { data: albumSubmission } = await supabase
    .from("submissions")
    .select("id, title, status, updated_at, payment_status")
    .eq("user_id", user.id)
    .eq("type", "ALBUM")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: mvSubmission } = await supabase
    .from("submissions")
    .select("id, title, status, updated_at, payment_status, type")
    .eq("user_id", user.id)
    .in("type", ["MV_DISTRIBUTION", "MV_BROADCAST"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let albumStations: Array<{ id: string; status: string; updated_at: string; station?: { name?: string | null } | null }> = [];
  let mvStations: Array<{ id: string; status: string; updated_at: string; station?: { name?: string | null } | null }> = [];

  if (albumSubmission) {
    const { data: albumReviews } = await supabase
      .from("station_reviews")
      .select("id, status, updated_at, station:stations ( name )")
      .eq("submission_id", albumSubmission.id)
      .order("updated_at", { ascending: false });
    albumStations = normalizeStations(albumReviews);
  }

  if (mvSubmission) {
    const { data: mvReviews } = await supabase
      .from("station_reviews")
      .select("id, status, updated_at, station:stations ( name )")
      .eq("submission_id", mvSubmission.id)
      .order("updated_at", { ascending: false });
    mvStations = normalizeStations(mvReviews);
  }

  return (
    <DashboardShell
      title="접수 현황"
      description="접수한 심의의 현재 상태를 확인할 수 있습니다."
      activeTab="status"
    >
      <HomeReviewPanel
        isLoggedIn
        albumSubmission={albumSubmission ?? null}
        mvSubmission={mvSubmission ?? null}
        albumStations={albumStations}
        mvStations={mvStations}
        hideEmptyTabs
        forceLiveBadge
      />
    </DashboardShell>
  );
}

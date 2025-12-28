import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HistoryList } from "@/components/dashboard/history-list";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "나의 심의 내역",
};

const typeLabels: Record<string, string> = {
  ALBUM: "앨범",
  MV_DISTRIBUTION: "MV 유통",
  MV_BROADCAST: "MV 방송",
};

export default async function HistoryPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      "id, title, artist_name, status, created_at, updated_at, type, amount_krw, is_oneclick, station_reviews ( id, status, updated_at, station:stations ( name ) )",
    )
    .order("updated_at", { ascending: false })
    .eq("user_id", user.id)
    .in("status", ["RESULT_READY", "COMPLETED"]);

  const items =
    submissions?.map((submission, index) => {
      const typeLabel = typeLabels[submission.type] ?? submission.type;
      return {
        id: submission.id,
        order: index + 1,
        title: submission.title || "제목 미입력",
        artistName: submission.artist_name || "아티스트 미입력",
        typeLabel,
        createdAt: submission.created_at,
        updatedAt: submission.updated_at,
        amountKrw: submission.amount_krw,
        isOneclick: submission.is_oneclick,
        stationReviews: (submission.station_reviews ?? []).map((review) => ({
          ...review,
          station: Array.isArray(review.station)
            ? review.station[0]
            : review.station,
        })),
      };
    }) ?? [];

  return (
    <DashboardShell
      title="나의 심의 내역"
      description="심의 기록을 발매 음원 단위로 확인합니다."
      activeTab="history"
    >
      <HistoryList initialItems={items} />
    </DashboardShell>
  );
}

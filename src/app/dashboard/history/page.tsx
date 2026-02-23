import { redirect } from "next/navigation";

import {
  DashboardShell,
  statusDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { ArtistHistoryTabs } from "@/components/dashboard/artist-history";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "나의 심의 내역",
};

type SubmissionRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  artist_id: string | null;
  artist?:
    | { id?: string | null; name?: string | null; thumbnail_url?: string | null }
    | Array<{ id?: string | null; name?: string | null; thumbnail_url?: string | null }>
    | null;
  status: string;
  payment_status?: string | null;
  created_at: string;
  updated_at: string | null;
  type: string;
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
};

const PRIMARY_SELECT =
  "id, title, artist_name, artist_id, artist:artists ( id, name, thumbnail_url ), status, payment_status, created_at, updated_at, type";
const FALLBACK_SELECT =
  "id, title, artist_name, artist_id, status, payment_status, created_at, updated_at, type";

export async function HistoryPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const paymentStatuses = ["PAYMENT_PENDING", "PAID"];
  const runSelect = (select: string) =>
    supabase
      .from("submissions")
      .select(select)
      .eq("user_id", user.id)
      .in("payment_status", paymentStatuses)
      .order("updated_at", { ascending: false });

  const { data: primaryData, error: primaryError } = await runSelect(PRIMARY_SELECT);
  let submissions: SubmissionRow[] = ((primaryData ?? []) as unknown[]).map(
    (row) => row as SubmissionRow,
  );

  if (primaryError) {
    console.error("[HistoryPage] primary query failed", primaryError);
    const { data: fallbackData, error: fallbackError } = await runSelect(
      FALLBACK_SELECT,
    );
    if (fallbackError) {
      console.error("[HistoryPage] fallback query failed", fallbackError);
      submissions = [];
    } else {
      submissions = ((fallbackData ?? []) as unknown[]).map((row) => ({
        ...(row as SubmissionRow),
        artist: null,
      }));
    }
  }

  const groupByArtist = (typeFilter: string[]) => {
    const filtered = submissions.filter((item) => typeFilter.includes(item.type));
    const grouped = new Map<
      string,
      {
        artistId: string | null;
        artistName: string;
        thumbnail: string | null;
        submissions: SubmissionRow[];
      }
    >();

    for (const item of filtered) {
      const artist = Array.isArray(item.artist) ? item.artist[0] : item.artist;
      const name = artist?.name?.trim() || item.artist_name?.trim() || "";
      const displayArtistName = name || "아티스트 미입력";
      const key = artist?.id ?? item.artist_id ?? (name || item.id);

      if (!grouped.has(key)) {
        grouped.set(key, {
          artistId: artist?.id ?? item.artist_id ?? null,
          artistName: displayArtistName,
          thumbnail: artist?.thumbnail_url ?? null,
          submissions: [],
        });
      }

      grouped.get(key)?.submissions.push(item);
    }

    return Array.from(grouped.values()).sort((a, b) =>
      a.artistName.localeCompare(b.artistName, "ko", { sensitivity: "base" }),
    );
  };

  const albumGroups = groupByArtist(["ALBUM"]);
  const mvGroups = groupByArtist(["MV_BROADCAST", "MV_DISTRIBUTION"]);

  return (
    <DashboardShell
      title="나의 심의 내역"
      description="심의 기록을 발매 음원 단위로 확인합니다."
      activeTab="history"
      tabs={config?.tabs ?? statusDashboardTabs}
      contextLabel={config?.contextLabel ?? "진행상황"}
    >
      <ArtistHistoryTabs albumGroups={albumGroups} mvGroups={mvGroups} />
    </DashboardShell>
  );
}

export default async function HistoryPage() {
  return HistoryPageView();
}

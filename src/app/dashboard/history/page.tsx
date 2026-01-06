import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ArtistHistoryTabs } from "@/components/dashboard/artist-history";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "나의 심의 내역",
};

type SubmissionRow = {
  id: string;
  title: string | null;
  artist_name: string | null;
  artist_id: string | null;
  artist?: { id: string; name: string; thumbnail_url: string | null } | null;
  status: string;
  payment_status?: string | null;
  payment_method?: string | null;
  created_at: string;
  updated_at: string | null;
  type: string;
  amount_krw: number | null;
  is_oneclick: boolean | null;
  package?:
    | Array<{ name?: string | null; station_count?: number | null }>
    | { name?: string | null; station_count?: number | null }
    | null;
  album_tracks?: Array<{
    id: string;
    track_no: number;
    track_title: string | null;
  }> | null;
  station_reviews?: Array<{
    id: string;
    status: string;
    updated_at: string | null;
    station?: { name?: string | null } | Array<{ name?: string | null }>;
  }> | null;
};

export default async function HistoryPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const fullSelect =
    "id, title, artist_name, artist_id, artist:artists ( id, name, thumbnail_url ), status, payment_status, payment_method, created_at, updated_at, type, amount_krw, is_oneclick, package:packages ( name, station_count ), album_tracks ( id, track_no, track_title ), station_reviews ( id, status, updated_at, station:stations ( name ) )";
  const fallbackSelect =
    "id, title, artist_name, artist_id, status, created_at, updated_at, type, amount_krw, is_oneclick, station_reviews ( id, status, updated_at, station:stations ( name ) )";

  // 1) 기본 쿼리: artist join 포함
  const { data: initialData, error: submissionError } = await supabase
    .from("submissions")
    .select(fullSelect)
    .order("updated_at", { ascending: false })
    .eq("user_id", user.id);

  let submissions = (initialData ?? null) as SubmissionRow[] | null;

  // 2) 에러 발생 시 컬럼 축소한 fallback
  if (submissionError) {
    console.error("history full select error", submissionError);
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("submissions")
      .select(fallbackSelect)
      .order("updated_at", { ascending: false })
      .eq("user_id", user.id);

    if (fallbackError) {
      console.error("history fallback select error", fallbackError);
      submissions = [];
    } else {
      submissions =
        (fallbackData?.map((row) => ({
          ...row,
          payment_status: null,
          payment_method: null,
          package: null,
          album_tracks: [],
        })) as SubmissionRow[]) ?? [];
    }
  }

  if (submissions && submissions.length > 0) {
    await Promise.all(
      submissions
        .filter((submission) => submission.type === "ALBUM")
        .map((submission) => {
          const pkg = Array.isArray(submission.package)
            ? submission.package[0]
            : submission.package;
          return ensureAlbumStationReviews(
            supabase,
            submission.id,
            pkg?.station_count ?? null,
            pkg?.name ?? null,
          );
        }),
    );
  }

  // 그룹핑: 타입별 -> 아티스트별
  const groupByArtist = (typeFilter: string[]) => {
    const filtered = submissions?.filter((s) => typeFilter.includes(s.type)) ?? [];
    const map = new Map<
      string,
      { artistId: string | null; artistName: string; thumbnail: string | null; submissions: SubmissionRow[] }
    >();
    for (const s of filtered) {
      if (!s.id) {
        console.warn("[HistoryPage] submission without id skipped", s);
        continue;
      }
      const key = s.artist?.id ?? s.artist_id ?? s.artist_name ?? s.id;
      if (!map.has(key)) {
        map.set(key, {
          artistId: s.artist?.id ?? s.artist_id ?? null,
          artistName: s.artist?.name || s.artist_name || "아티스트 미입력",
          thumbnail: s.artist?.thumbnail_url ?? null,
          submissions: [],
        });
      }
      map.get(key)?.submissions.push(s);
    }
    return Array.from(map.values());
  };

  const albumGroups = groupByArtist(["ALBUM"]);
  const mvGroups = groupByArtist(["MV_BROADCAST", "MV_DISTRIBUTION"]);

  return (
    <DashboardShell
      title="나의 심의 내역"
      description="심의 기록을 발매 음원 단위로 확인합니다."
      activeTab="history"
    >
      <ArtistHistoryTabs albumGroups={albumGroups} mvGroups={mvGroups} />
    </DashboardShell>
  );
}

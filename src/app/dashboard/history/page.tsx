import { redirect } from "next/navigation";

import {
  DashboardShell,
  statusDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
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
    track_results?: unknown;
    updated_at: string | null;
    station?: { name?: string | null } | Array<{ name?: string | null }>;
  }> | null;
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
};

export async function HistoryPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const fullSelect =
    "id, title, artist_name, artist_id, artist:artists ( id, name, thumbnail_url ), status, payment_status, payment_method, created_at, updated_at, type, amount_krw, is_oneclick, package:packages ( name, station_count ), album_tracks ( id, track_no, track_title ), station_reviews ( id, status, track_results, updated_at, station:stations ( name ) )";
  const fallbackSelect =
    "id, title, artist_name, artist_id, status, created_at, updated_at, type, amount_krw, is_oneclick, station_reviews ( id, status, track_results, updated_at, station:stations ( name ) )";
  const fullSelectWithoutTracks =
    "id, title, artist_name, artist_id, artist:artists ( id, name, thumbnail_url ), status, payment_status, payment_method, created_at, updated_at, type, amount_krw, is_oneclick, package:packages ( name, station_count ), album_tracks ( id, track_no, track_title )";
  const fallbackSelectWithoutTracks =
    "id, title, artist_name, artist_id, status, created_at, updated_at, type, amount_krw, is_oneclick";

  // 1) 기본 쿼리: artist join 포함
  const runSelect = (select: string) =>
    supabase
      .from("submissions")
      .select(select)
      .order("updated_at", { ascending: false })
      .eq("user_id", user.id)
      .or(
        "and(payment_method.eq.CARD,payment_status.eq.PAID),and(payment_method.eq.BANK,payment_status.in.(PAYMENT_PENDING,PAID))",
      );

  const { data: initialData, error: submissionError } = await runSelect(fullSelect);

  let submissions = (initialData ?? null) as SubmissionRow[] | null;
  let hasTrackResultsColumn = true;

  // 2) 에러 발생 시 컬럼 축소한 fallback
  if (submissionError) {
    console.error("history full select error", submissionError);
    const { data: fallbackData, error: fallbackError } = await runSelect(fallbackSelect);

    if (fallbackError) {
      console.error("history fallback select error", fallbackError);
      submissions = [];
      hasTrackResultsColumn =
        !fallbackError.message?.toLowerCase().includes("track_results") &&
        fallbackError.code !== "42703";
    } else {
      submissions =
        (fallbackData?.map((row) => {
          const safeRow =
            typeof row === "object" && row !== null
              ? (row as SubmissionRow)
              : ({} as SubmissionRow);
          return {
            ...safeRow,
            payment_status: null,
            payment_method: null,
            package: null,
            album_tracks: [],
          };
        }) as SubmissionRow[]) ?? [];
    }
  }

  // 3) track_results 컬럼이 없는 스키마 대응
  if (!submissions || submissions.length === 0) {
    const { data: noTrackData, error: noTrackError } = await runSelect(
      fullSelectWithoutTracks,
    );
    if (noTrackError) {
      console.error("history select without track_results error", noTrackError);
      const { data: fallbackNoTrack } = await runSelect(
        fallbackSelectWithoutTracks,
      );
      submissions = ((fallbackNoTrack ?? []) as unknown[]).map((row) =>
        (typeof row === "object" && row !== null ? row : {}) as SubmissionRow,
      );
    } else {
      submissions = ((noTrackData ?? []) as unknown[]).map((row) =>
        (typeof row === "object" && row !== null ? row : {}) as SubmissionRow,
      );
    }
    hasTrackResultsColumn = false;
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

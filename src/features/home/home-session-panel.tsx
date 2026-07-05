import type { ComponentProps } from "react";

import { getDashboardStatusData } from "@/lib/dashboard-status";
import { createServerSupabase } from "@/lib/supabase/server";

import { HomeReviewPanel } from "./home-review-panel";

type HomeReviewPanelProps = ComponentProps<typeof HomeReviewPanel>;
type SubmissionSummary = HomeReviewPanelProps["albumSubmissions"][number];
type StationItem = HomeReviewPanelProps["albumStationsMap"][string][number];
type StationMap = HomeReviewPanelProps["albumStationsMap"];

function buildExampleState() {
  const now = Date.now();
  const sampleStations: StationItem[] = [
    {
      id: "sample-1",
      status: "NOT_SENT",
      updated_at: new Date(now + 86400000).toISOString(),
      station: { name: "KBS" },
    },
    {
      id: "sample-2",
      status: "RECEIVED",
      updated_at: new Date(now - 86400000 * 2).toISOString(),
      station: { name: "MBC" },
    },
    {
      id: "sample-3",
      status: "APPROVED",
      updated_at: new Date(now - 86400000 * 5).toISOString(),
      station: { name: "SBS" },
    },
    {
      id: "sample-4",
      status: "NEEDS_FIX",
      updated_at: new Date(now - 86400000 * 3).toISOString(),
      station: { name: "YTN" },
    },
    {
      id: "sample-5",
      status: "NOT_SENT",
      updated_at: new Date(now + 86400000 * 2).toISOString(),
      station: { name: "CBS 기독교방송" },
    },
    {
      id: "sample-6",
      status: "RECEIVED",
      updated_at: new Date(now - 86400000).toISOString(),
      station: { name: "Arirang 방송" },
    },
  ];

  const sampleAlbum: SubmissionSummary = {
    id: "sample-album",
    title: "방송국별 진행 현황 예시",
    artist_name: "비회원 조회 코드 화면",
    status: "IN_PROGRESS",
    payment_status: "PAID",
    updated_at: new Date(now).toISOString(),
  };

  const sampleMv: SubmissionSummary = {
    id: "sample-mv",
    title: "뮤직비디오 결과 수령 예시",
    artist_name: "온라인 유통 심의",
    status: "WAITING_PAYMENT",
    payment_status: "PAYMENT_PENDING",
    updated_at: new Date(now).toISOString(),
  };

  return {
    albumSubmissions: [sampleAlbum],
    mvSubmissions: [sampleMv],
    albumStationsMap: { [sampleAlbum.id]: sampleStations },
    mvStationsMap: { [sampleMv.id]: sampleStations },
  };
}

const panelProps = {
  stationRowsPerPage: 3,
  showPartialTrackBreakdown: false,
  showDetailLink: false,
  panelMinHeightClassName: "h-full lg:min-h-0",
  compact: true,
};

function normalizeStationsMap(
  map:
    | Record<
        string,
        Array<
          Omit<StationItem, "station"> & {
            station?: StationItem["station"] | StationItem["station"][] | null;
          }
        >
      >
    | undefined,
): StationMap {
  return Object.fromEntries(
    Object.entries(map ?? {}).map(([submissionId, rows]) => [
      submissionId,
      rows.map((row) => ({
        ...row,
        station: Array.isArray(row.station)
          ? (row.station[0] ?? null)
          : (row.station ?? null),
      })),
    ]),
  );
}

export function HomeSessionPanelFallback() {
  return (
    <HomeReviewPanel
      isLoggedIn={false}
      albumSubmissions={[]}
      mvSubmissions={[]}
      albumStationsMap={{}}
      mvStationsMap={{}}
      enableRemoteSync={false}
      isLoading
      {...panelProps}
    />
  );
}

export async function HomeSessionPanel() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    if (!error.message.toLowerCase().includes("auth session missing")) {
      console.error("[HomeSessionPanel] Failed to read session:", error.message);
    }
  }

  if (!user) {
    const exampleState = buildExampleState();
    return (
      <HomeReviewPanel
        isLoggedIn={false}
        albumSubmissions={exampleState.albumSubmissions}
        mvSubmissions={exampleState.mvSubmissions}
        albumStationsMap={exampleState.albumStationsMap}
        mvStationsMap={exampleState.mvStationsMap}
        enableRemoteSync={false}
        {...panelProps}
      />
    );
  }

  const result = await getDashboardStatusData(user.id);
  if (result.error || !result.data) {
    console.error(
      "[HomeSessionPanel] Failed to load dashboard status:",
      result.error ?? "empty dashboard status",
    );
  }

  return (
    <HomeReviewPanel
      isLoggedIn
      albumSubmissions={result.data?.albumSubmissions ?? []}
      mvSubmissions={result.data?.mvSubmissions ?? []}
      albumStationsMap={normalizeStationsMap(result.data?.albumStationsMap)}
      mvStationsMap={normalizeStationsMap(result.data?.mvStationsMap)}
      enableRemoteSync={Boolean(result.error || !result.data)}
      {...panelProps}
    />
  );
}

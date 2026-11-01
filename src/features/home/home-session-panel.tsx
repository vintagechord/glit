"use client";

import * as React from "react";
import type { ComponentProps } from "react";

import type { DashboardStatusData } from "@/lib/dashboard-status";
import { hasBrowserAuthCookie, loadBrowserSupabase } from "@/lib/supabase/browser-session";

import { dashboardStatusResource } from "./dashboard-status-resource";
import { HomeReviewPanel } from "./home-review-panel";

type HomeReviewPanelProps = ComponentProps<typeof HomeReviewPanel>;
type SubmissionSummary = HomeReviewPanelProps["albumSubmissions"][number];
type StationItem = HomeReviewPanelProps["albumStationsMap"][string][number];
type StationMap = HomeReviewPanelProps["albumStationsMap"];

// Relative example dates only order the sample rows; nothing in the markup
// prints them, so the server and the browser may anchor them differently.
const exampleAnchor = Date.now();

function buildExampleState(now = exampleAnchor) {
  const sampleStations: StationItem[] = [
    {
      id: "sample-1",
      status: "NOT_SENT",
      updated_at: new Date(now - 86400000).toISOString(),
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
      updated_at: new Date(now - 86400000 * 2).toISOString(),
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
    title: "앨범 심의",
    artist_name: "진행 예시",
    status: "IN_PROGRESS",
    payment_status: "PAID",
    updated_at: new Date(now).toISOString(),
  };

  const sampleMv: SubmissionSummary = {
    id: "sample-mv",
    title: "MV 심의",
    artist_name: "결과 예시",
    type: "MV_BROADCAST",
    status: "COMPLETED",
    payment_status: "PAID",
    result_status: "APPROVED",
    updated_at: new Date(now).toISOString(),
  };
  const sampleMvStations: StationItem[] = ["KBS", "MBC", "SBS", "ETN"].map(
    (name) => ({
      id: `sample-mv-${name.toLowerCase()}`,
      status: "APPROVED",
      updated_at: sampleMv.updated_at,
      station: { name, code: name },
    }),
  );

  return {
    albumSubmissions: [sampleAlbum],
    mvSubmissions: [sampleMv],
    albumStationsMap: { [sampleAlbum.id]: sampleStations },
    mvStationsMap: { [sampleMv.id]: sampleMvStations },
  };
}

const panelProps = {
  stationRowsPerPage: 6,
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
      key="loading"
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

const noSubmissions: SubmissionSummary[] = [];

type Viewer =
  | { kind: "checking" }
  | { kind: "guest" }
  | { kind: "member"; userId: string; data: DashboardStatusData | null; failed: boolean };

const panelSlotClass = "min-w-0 w-full h-full lg:min-h-0";

/**
 * The home page is served from the CDN, so the visitor's session is read in
 * the browser. The HTML carries both the guest example and the loading state,
 * and the inline session script in the root layout lets CSS show the right
 * one before hydration. Guests (no session cookie) keep the example without
 * loading the Supabase SDK; members get their live status straight from
 * /api/dashboard/status, which verifies the session on the server and names
 * the account, so the SDK is off that path too.
 */
export function HomeSessionPanel() {
  const [viewer, setViewer] = React.useState<Viewer>({ kind: "checking" });
  const example = React.useMemo(() => buildExampleState(), []);

  React.useEffect(() => {
    const controller = new AbortController();
    const showGuest = () => {
      if (!controller.signal.aborted) setViewer({ kind: "guest" });
    };
    const read = async () => {
      if (!hasBrowserAuthCookie()) return showGuest();
      try {
        const { viewerId, data } = await dashboardStatusResource.readSession({ signal: controller.signal });
        if (!controller.signal.aborted) setViewer({ kind: "member", userId: viewerId, data, failed: false });
      } catch (failure) {
        if (controller.signal.aborted) return;
        // A cookie the server no longer accepts is a signed-out visitor.
        if ((failure as { status?: number }).status === 401) return showGuest();
        console.error("[HomeSessionPanel] Failed to load dashboard status:", failure instanceof Error ? failure.message : failure);
        // The panel's own retry needs the account id, which the SDK reads from the cookie.
        const supabase = await loadBrowserSupabase();
        const { data: { session } } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        const userId = session?.user?.id;
        if (!userId) return showGuest();
        setViewer({ kind: "member", userId, data: dashboardStatusResource.peek(userId), failed: true });
      }
    };
    void read().catch(showGuest);
    // A page restored from the back-forward cache may predate a login or logout.
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) void read().catch(showGuest);
    };
    window.addEventListener("pageshow", restored);
    return () => {
      controller.abort();
      window.removeEventListener("pageshow", restored);
    };
  }, []);

  const memberData = viewer.kind === "member" ? viewer.data : null;
  const albumStations = React.useMemo(() => normalizeStationsMap(memberData?.albumStationsMap), [memberData]);
  const mvStations = React.useMemo(() => normalizeStationsMap(memberData?.mvStationsMap), [memberData]);

  if (viewer.kind === "checking" || viewer.kind === "guest") {
    const resolved = viewer.kind === "guest";
    return (
      <div className="contents">
        <div data-home-panel={resolved ? "ready" : "guest"} className={panelSlotClass}>
          <HomeReviewPanel
            key="guest"
            isLoggedIn={false}
            albumSubmissions={example.albumSubmissions}
            mvSubmissions={example.mvSubmissions}
            albumStationsMap={example.albumStationsMap}
            mvStationsMap={example.mvStationsMap}
            enableRemoteSync={false}
            {...panelProps}
          />
        </div>
        {resolved ? null : (
          <div data-home-panel="checking" className={panelSlotClass}>
            <HomeSessionPanelFallback />
          </div>
        )}
      </div>
    );
  }

  if (!viewer.data && !viewer.failed) {
    return <HomeSessionPanelFallback />;
  }

  return (
    <HomeReviewPanel
      key={viewer.userId}
      isLoggedIn
      viewerId={viewer.userId}
      albumSubmissions={memberData?.albumSubmissions ?? noSubmissions}
      mvSubmissions={memberData?.mvSubmissions ?? noSubmissions}
      albumStationsMap={albumStations}
      mvStationsMap={mvStations}
      // After a failed read the panel shows its own error and retry button.
      enableRemoteSync={viewer.failed}
      {...panelProps}
    />
  );
}

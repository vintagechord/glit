"use client";

import * as React from "react";

import { createClient } from "@/lib/supabase/client";

import { HomeReviewPanel } from "./home-review-panel";

type HomeReviewPanelProps = React.ComponentProps<typeof HomeReviewPanel>;
type SubmissionSummary = HomeReviewPanelProps["albumSubmissions"][number];
type StationItem = HomeReviewPanelProps["albumStationsMap"][string][number];

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
    title: "샘플 앨범 심의",
    artist_name: "온사이드",
    status: "IN_PROGRESS",
    payment_status: "PAID",
    updated_at: new Date(now).toISOString(),
  };

  const sampleMv: SubmissionSummary = {
    id: "sample-mv",
    title: "샘플 MV 심의",
    artist_name: "온사이드",
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

export function HomeSessionPanel() {
  const [isLoggedIn, setIsLoggedIn] = React.useState(false);
  const [exampleState] = React.useState(() => buildExampleState());

  React.useEffect(() => {
    const supabase = createClient();
    let active = true;

    const syncSession = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (!active) return;
      if (error) {
        console.error("[HomeSessionPanel] Failed to read session:", error.message);
        setIsLoggedIn(false);
        return;
      }
      setIsLoggedIn(Boolean(user));
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setIsLoggedIn(Boolean(session?.user));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <HomeReviewPanel
      isLoggedIn={isLoggedIn}
      albumSubmissions={isLoggedIn ? [] : exampleState.albumSubmissions}
      mvSubmissions={isLoggedIn ? [] : exampleState.mvSubmissions}
      albumStationsMap={isLoggedIn ? {} : exampleState.albumStationsMap}
      mvStationsMap={isLoggedIn ? {} : exampleState.mvStationsMap}
      enableRemoteSync={isLoggedIn}
      stationRowsPerPage={5}
      showPartialTrackBreakdown={false}
      mobileStationLayout="table"
    />
  );
}

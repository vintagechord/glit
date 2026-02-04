"use client";

import * as React from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HomeReviewPanel } from "@/features/home/home-review-panel";

type StationItem = {
  id: string;
  status: string;
  updated_at: string;
  track_results?: unknown;
  result_note?: string | null;
  station?: {
    name?: string | null;
  } | null;
};

type StatusResponse = {
  albumSubmissions: Array<{
    id: string;
    title: string | null;
    artist_name?: string | null;
    status: string;
    updated_at: string;
    payment_status?: string | null;
    package?: { name?: string | null; station_count?: number | null }[];
  }>;
  mvSubmissions: Array<{
    id: string;
    title: string | null;
    artist_name?: string | null;
    status: string;
    updated_at: string;
    payment_status?: string | null;
    type: string;
  }>;
  albumStationsMap: Record<string, StationItem[]>;
  mvStationsMap: Record<string, StationItem[]>;
};

export function DashboardStatusClient({
  title,
  description,
  tabs,
  contextLabel,
  activeTab,
}: {
  title: string;
  description: string;
  tabs: React.ComponentProps<typeof DashboardShell>["tabs"];
  contextLabel?: string;
  activeTab?: string;
}) {
  const [data, setData] = React.useState<StatusResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let aborted = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/dashboard/status", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as StatusResponse & { error?: string };
        if (aborted) return;
        if (!res.ok || json?.error) {
          throw new Error(json?.error || "진행 현황을 불러오지 못했습니다.");
        }
        setData(json);
      } catch (err) {
        if (!aborted) setError(err instanceof Error ? err.message : "불러오기 실패");
      } finally {
        if (!aborted) setLoading(false);
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, []);

  return (
    <DashboardShell
      title={title}
      description={description}
      activeTab={activeTab ?? "status"}
      tabs={tabs}
      contextLabel={contextLabel}
    >
      {loading ? (
        <div className="rounded-3xl border border-border/70 bg-card/70 p-8 text-sm text-muted-foreground">
          진행 현황을 불러오는 중입니다...
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-200/70 bg-rose-50/80 p-8 text-sm text-rose-700">
          {error}
        </div>
      ) : data ? (
        <HomeReviewPanel
          isLoggedIn
          albumSubmissions={data.albumSubmissions}
          mvSubmissions={data.mvSubmissions}
          albumStationsMap={data.albumStationsMap}
          mvStationsMap={data.mvStationsMap}
          hideEmptyTabs={false}
          forceLiveBadge
        />
      ) : null}
    </DashboardShell>
  );
}

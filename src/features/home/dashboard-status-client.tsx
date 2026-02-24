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

const STATUS_CLIENT_CACHE_TTL_MS = 30_000;

const cachedStatusByUser = new Map<
  string,
  { expiresAt: number; data: StatusResponse }
>();
const inflightStatusRequestByUser = new Map<string, Promise<StatusResponse>>();

function readCachedStatus(viewerId: string) {
  const cached = cachedStatusByUser.get(viewerId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cachedStatusByUser.delete(viewerId);
    return null;
  }
  return cached.data;
}

function writeCachedStatus(viewerId: string, data: StatusResponse) {
  cachedStatusByUser.set(viewerId, {
    data,
    expiresAt: Date.now() + STATUS_CLIENT_CACHE_TTL_MS,
  });

  if (cachedStatusByUser.size <= 20) return;
  const now = Date.now();
  for (const [key, value] of cachedStatusByUser.entries()) {
    if (value.expiresAt <= now) {
      cachedStatusByUser.delete(key);
    }
  }
}

async function fetchDashboardStatus(viewerId: string) {
  const cached = readCachedStatus(viewerId);
  if (cached) {
    return cached;
  }

  const inflight = inflightStatusRequestByUser.get(viewerId);
  if (inflight) {
    return inflight;
  }

  const requestPromise = (async () => {
    const res = await fetch("/api/dashboard/status", { cache: "default" });
    const json = (await res.json().catch(() => null)) as
      | (StatusResponse & { error?: string })
      | null;
    if (!res.ok || !json || json.error) {
      throw new Error(json?.error || "진행 현황을 불러오지 못했습니다.");
    }

    writeCachedStatus(viewerId, json);
    return json;
  })();
  inflightStatusRequestByUser.set(viewerId, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inflightStatusRequestByUser.delete(viewerId);
  }
}

export function DashboardStatusClient({
  viewerId,
  title,
  description,
  tabs,
  contextLabel,
  activeTab,
}: {
  viewerId: string;
  title: string;
  description: string;
  tabs: React.ComponentProps<typeof DashboardShell>["tabs"];
  contextLabel?: string;
  activeTab?: string;
}) {
  const initialData = React.useMemo(() => readCachedStatus(viewerId), [viewerId]);
  const [data, setData] = React.useState<StatusResponse | null>(initialData);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(initialData == null);

  React.useEffect(() => {
    setData(initialData);
    setError(null);
    setLoading(initialData == null);
  }, [initialData, viewerId]);

  React.useEffect(() => {
    let aborted = false;
    const load = async () => {
      const showBlockingLoading = initialData == null;
      if (showBlockingLoading) {
        setLoading(true);
      }

      try {
        const nextData = await fetchDashboardStatus(viewerId);
        if (aborted) return;
        setData(nextData);
        setError(null);
      } catch (err) {
        if (!aborted && showBlockingLoading) {
          setError(err instanceof Error ? err.message : "불러오기 실패");
        }
      } finally {
        if (!aborted && showBlockingLoading) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      aborted = true;
    };
  }, [initialData, viewerId]);

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

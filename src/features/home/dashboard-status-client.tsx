"use client";

import * as React from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { HomeReviewPanel } from "@/features/home/home-review-panel";
import type { DashboardStatusData } from "@/lib/dashboard-status";
import { dashboardStatusResource } from "./dashboard-status-resource";

type Props = {
  viewerId: string;
  title: string;
  description?: string;
  tabs: React.ComponentProps<typeof DashboardShell>["tabs"];
  contextLabel?: string;
  activeTab?: string;
  initialReviewTab?: "album" | "mv";
  forceStatusRefresh?: boolean;
  initialData?: DashboardStatusData | null;
  initialDataAt?: number;
};

function normalizeStations(map: DashboardStatusData["albumStationsMap"]) {
  return Object.fromEntries(Object.entries(map).map(([id, rows]) => [
    id,
    rows.map((row) => ({
      ...row,
      station: Array.isArray(row.station) ? row.station[0] ?? null : row.station,
    })),
  ]));
}

export function DashboardStatusClient(props: Props) {
  // Never retain another account's visible data while a new request starts.
  return <DashboardStatusView key={props.viewerId} {...props} />;
}

function DashboardStatusView({
  viewerId, title, description, tabs, contextLabel, activeTab,
  initialReviewTab, forceStatusRefresh, initialData, initialDataAt,
}: Props) {
  const router = useRouter();
  const [data, setData] = React.useState<DashboardStatusData | null>(() =>
    initialData ?? (typeof window !== "undefined" && !forceStatusRefresh
      ? dashboardStatusResource.peek(viewerId) : null),
  );
  const dataRef = React.useRef(data);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(data == null);
  const [reloadSeq, setReloadSeq] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let authorizationChanged = false;
    let needsFreshRead = Boolean(forceStatusRefresh || reloadSeq);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const accept = (next: DashboardStatusData) => {
      dataRef.current = next;
      setData(next);
      setError(null);
      setLoading(false);
    };
    const schedule = () => {
      if (!controller.signal.aborted && !authorizationChanged) timer = setTimeout(() => void refresh(), 15_000);
    };
    const refresh = async (bypassCache = false) => {
      if (controller.signal.aborted || pending || authorizationChanged) return;
      if (timer) clearTimeout(timer);
      if (document.visibilityState !== "visible") { schedule(); return; }
      pending = true;
      if (!dataRef.current) setLoading(true);
      try {
        const next = await dashboardStatusResource.read(viewerId, {
          signal: controller.signal, bypassCache: bypassCache || needsFreshRead,
        });
        if (!controller.signal.aborted) { needsFreshRead = false; accept(next); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        if ((failure as { status?: number }).status === 401) {
          authorizationChanged = true;
          dataRef.current = null;
          setData(null);
          router.refresh();
        }
        if (!dataRef.current) setError(failure instanceof Error ? failure.message : "불러오기 실패");
      } finally {
        pending = false;
        if (!controller.signal.aborted) { setLoading(false); schedule(); }
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    // The server has already authenticated and fetched this snapshot. Avoid a
    // second auth/DB round trip immediately after hydration.
    if (initialData && reloadSeq === 0) {
      needsFreshRead = false;
      dashboardStatusResource.seed(viewerId, initialData, initialDataAt);
      const freshData = dashboardStatusResource.peek(viewerId);
      accept(freshData ?? initialData);
      if (freshData) schedule();
      else void refresh(Boolean(forceStatusRefresh));
    } else {
      void refresh(Boolean(forceStatusRefresh || reloadSeq));
    }
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [forceStatusRefresh, initialData, initialDataAt, reloadSeq, router, viewerId]);

  const albumStations = React.useMemo(() => normalizeStations(data?.albumStationsMap ?? {}), [data?.albumStationsMap]);
  const mvStations = React.useMemo(() => normalizeStations(data?.mvStationsMap ?? {}), [data?.mvStationsMap]);

  return (
    <DashboardShell
      title={title}
      description={description}
      activeTab={activeTab ?? "status"}
      tabs={tabs}
      contextLabel={contextLabel}
    >
      {loading && !data ? (
        <div className="flex min-h-40 items-center justify-center rounded-[10px] border-2 border-[#111111] bg-card p-8 text-muted-foreground shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
          <span className="sr-only">진행 현황을 불러오는 중</span>
        </div>
      ) : error && !data ? (
        <div className="rounded-[10px] border-2 border-[#d9362c] bg-[#d9362c]/10 p-8 text-sm font-semibold text-[#d9362c]">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setReloadSeq((value) => value + 1)}
            className="mt-4 rounded-[8px] border-2 border-[#111111] bg-white px-4 py-2 text-xs font-black uppercase tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5"
          >
            <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
            다시
          </button>
        </div>
      ) : data ? (
        <HomeReviewPanel
          isLoggedIn
          viewerId={viewerId}
          albumSubmissions={data.albumSubmissions}
          mvSubmissions={data.mvSubmissions}
          albumStationsMap={albumStations}
          mvStationsMap={mvStations}
          hideEmptyTabs={false}
          forceLiveBadge
          initialTab={initialReviewTab}
        />
      ) : null}
    </DashboardShell>
  );
}

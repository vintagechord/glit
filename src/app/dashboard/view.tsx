import { redirect } from "next/navigation";
import { Suspense, type ComponentProps } from "react";

import {
  DashboardShell,
  statusDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";

import { DashboardStatusClient } from "@/features/home/dashboard-status-client";
import { ReviewPageLoading } from "@/components/dashboard/review-page-loading";
import { getDashboardStatusData, type DashboardStatusResult } from "@/lib/dashboard-status";

import { createServerSupabase } from "@/lib/supabase/server";

import { getServerSessionUser } from "@/lib/supabase/server-user";

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
  loginPath?: string;
  initialReviewTab?: "album" | "mv";
  forceStatusRefresh?: boolean;
};

async function readStatusSnapshot(result: Promise<DashboardStatusResult>) {
  const status = await result;
  return { ...status, fetchedAt: Date.now() };
}

async function StatusContent({
  result,
  ...props
}: ComponentProps<typeof DashboardStatusClient> & {
  result: Promise<DashboardStatusResult>;
}) {
  const status = await readStatusSnapshot(result);
  return <DashboardStatusClient {...props} initialData={status.data ?? null} initialDataAt={status.fetchedAt} />;
}

type DashboardSearchParams = Record<string, string | string[] | undefined>;

const firstSearchParamValue = (value?: string | string[]) =>
  Array.isArray(value) ? value[0] : value;

const parseReviewTab = (value?: string | string[]) => {
  const normalized = firstSearchParamValue(value)?.toLowerCase();
  if (!normalized) return undefined;
  if (["mv", "music-video", "musicvideo", "video"].includes(normalized)) {
    return "mv" as const;
  }
  if (["album", "music"].includes(normalized)) {
    return "album" as const;
  }
  return undefined;
};

// Shared by /dashboard and /en/dashboard: the wizards finish on
// `?tab=…&refresh=1` in both locales.
export const readStatusPageSearchParams = (searchParams: DashboardSearchParams) => ({
  initialReviewTab:
    parseReviewTab(searchParams.tab) ?? parseReviewTab(searchParams.type),
  forceStatusRefresh: firstSearchParamValue(searchParams.refresh) === "1",
});

export async function StatusPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    redirect(config?.loginPath ?? "/login");
  }

  const clientProps = {
    viewerId: user.id,
    title: "접수 현황",
    activeTab: "status",
    tabs: config?.tabs ?? statusDashboardTabs,
    contextLabel: config?.contextLabel ?? "진행상황",
    initialReviewTab: config?.initialReviewTab,
    forceStatusRefresh: config?.forceStatusRefresh,
  };
  // Fetch while the shell streams; successful SSR data removes the hydration
  // -> status API -> second auth check waterfall on the first visit.
  const result = getDashboardStatusData(user.id, {
    bypassCache: config?.forceStatusRefresh,
  });

  return (
    <Suspense fallback={
      <DashboardShell {...clientProps}>
        <ReviewPageLoading english={config?.loginPath?.startsWith("/en/")} />
      </DashboardShell>
    }>
      <StatusContent {...clientProps} result={result} />
    </Suspense>
  );
}

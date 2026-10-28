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

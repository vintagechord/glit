import { redirect } from "next/navigation";

import {
  statusDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { DashboardStatusClient } from "@/features/home/dashboard-status-client";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "진행상황",
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
  loginPath?: string;
  initialReviewTab?: "album" | "mv";
  forceStatusRefresh?: boolean;
};

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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

export async function StatusPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    redirect(config?.loginPath ?? "/login");
  }

  return (
    <DashboardStatusClient
      viewerId={user.id}
      title="접수 현황"
      activeTab="status"
      tabs={config?.tabs ?? statusDashboardTabs}
      contextLabel={config?.contextLabel ?? "진행상황"}
      initialReviewTab={config?.initialReviewTab}
      forceStatusRefresh={config?.forceStatusRefresh}
    />
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const initialReviewTab =
    parseReviewTab(resolvedSearchParams.tab) ??
    parseReviewTab(resolvedSearchParams.type);
  const forceStatusRefresh =
    firstSearchParamValue(resolvedSearchParams.refresh) === "1";

  return StatusPageView({
    tabs: statusDashboardTabs,
    contextLabel: "진행상황",
    initialReviewTab,
    forceStatusRefresh,
  });
}

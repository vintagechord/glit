import { redirect } from "next/navigation";

import {
  statusDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";

import { DashboardStatusClient } from "@/features/home/dashboard-status-client";

import { createServerSupabase } from "@/lib/supabase/server";

import { getServerSessionUser } from "@/lib/supabase/server-user";

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
  loginPath?: string;
  initialReviewTab?: "album" | "mv";
  forceStatusRefresh?: boolean;
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

import { redirect } from "next/navigation";

import {
  statusDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { DashboardStatusClient } from "@/features/home/dashboard-status-client";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "진행상황",
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
};

export async function StatusPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardStatusClient
      title="접수 현황"
      description="접수한 심의의 현재 상태를 확인할 수 있습니다."
      activeTab="status"
      tabs={config?.tabs ?? statusDashboardTabs}
      contextLabel={config?.contextLabel ?? "진행상황"}
    />
  );
}

export default async function DashboardPage() {
  return StatusPageView();
}

import { statusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { readStatusPageSearchParams, StatusPageView } from "./view";

export const metadata = {
  title: "진행상황",
};

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { initialReviewTab, forceStatusRefresh } = readStatusPageSearchParams(
    (await searchParams) ?? {},
  );

  return StatusPageView({
    tabs: statusDashboardTabs,
    contextLabel: "진행상황",
    initialReviewTab,
    forceStatusRefresh,
  });
}

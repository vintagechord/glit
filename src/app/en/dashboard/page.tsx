import { englishStatusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { readStatusPageSearchParams, StatusPageView } from "@/app/dashboard/view";

export { metadata } from "@/app/dashboard/page";

type EnglishDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EnglishDashboardPage({ searchParams }: EnglishDashboardPageProps) {
  const { initialReviewTab, forceStatusRefresh } = readStatusPageSearchParams(
    (await searchParams) ?? {},
  );

  return StatusPageView({
    contextLabel: "Status",
    tabs: englishStatusDashboardTabs,
    loginPath: "/en/login",
    initialReviewTab,
    forceStatusRefresh,
  });
}

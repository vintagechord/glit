import { englishStatusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { readStatusPageSearchParams, StatusPageView } from "@/app/dashboard/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "Review Progress | Onside" },
  robots: { index: false, follow: false },
};

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

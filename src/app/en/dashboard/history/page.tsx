import { englishStatusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { HistoryPageView } from "@/app/dashboard/history/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "My Review History | Onside" },
  robots: { index: false, follow: false },
};

export default async function EnglishDashboardHistoryPage() {
  return HistoryPageView({
    contextLabel: "Status",
    tabs: englishStatusDashboardTabs,
    loginPath: "/en/login",
  });
}

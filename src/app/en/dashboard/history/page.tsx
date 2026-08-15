import { englishStatusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { HistoryPageView } from "@/app/dashboard/history/page";

export { metadata } from "@/app/dashboard/history/page";

export default async function EnglishDashboardHistoryPage() {
  return HistoryPageView({
    contextLabel: "Status",
    tabs: englishStatusDashboardTabs,
    loginPath: "/en/login",
  });
}

import { statusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { HistoryPageView } from "@/app/dashboard/history/page";

export { metadata } from "@/app/dashboard/history/page";

export default async function EnglishDashboardHistoryPage() {
  return HistoryPageView({
    contextLabel: "진행상황",
    tabs: statusDashboardTabs,
    loginPath: "/en/login",
  });
}

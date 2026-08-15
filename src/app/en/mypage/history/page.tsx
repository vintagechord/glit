import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { HistoryPageView } from "@/app/dashboard/history/page";

export { metadata } from "@/app/mypage/history/page";

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageHistoryPage() {
  return HistoryPageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

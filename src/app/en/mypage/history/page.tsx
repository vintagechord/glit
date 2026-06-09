import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { HistoryPageView } from "@/app/dashboard/history/page";

export { metadata } from "@/app/mypage/history/page";

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function EnglishMyPageHistoryPage() {
  return HistoryPageView({
    contextLabel: "마이페이지",
    tabs,
    loginPath: "/en/login",
  });
}

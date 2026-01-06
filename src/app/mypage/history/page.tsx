import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { HistoryPageView } from "@/app/dashboard/history/page";

export const metadata = {
  title: "마이페이지 - 나의 심의 내역",
};

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function MyPageHistoryPage() {
  return HistoryPageView({
    contextLabel: "마이페이지",
    tabs,
  });
}

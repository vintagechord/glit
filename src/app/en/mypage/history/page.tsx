import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { HistoryPageView } from "@/app/dashboard/history/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "My Page - My Review History | Onside" },
  robots: { index: false, follow: false },
};

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageHistoryPage() {
  return HistoryPageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

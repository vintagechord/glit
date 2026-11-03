import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { StatusPageView } from "@/app/dashboard/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "My Page - Submission Status | Onside" },
  robots: { index: false, follow: false },
};

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageStatusPage() {
  return StatusPageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

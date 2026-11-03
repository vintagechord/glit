import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { DraftSubmissionsPageView } from "@/app/dashboard/drafts/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "My Page - Applications in Progress | Onside" },
  robots: { index: false, follow: false },
};

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageDraftsPage() {
  return DraftSubmissionsPageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

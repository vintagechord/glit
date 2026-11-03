import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { ProfilePageView } from "@/app/dashboard/profile/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "My Page - Account | Onside" },
  robots: { index: false, follow: false },
};

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageProfilePage() {
  return ProfilePageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

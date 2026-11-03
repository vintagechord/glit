import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { SubmissionCartPageView } from "@/app/dashboard/cart/view";

// Private member page: English tab title, never indexed (the Korean twin
// is disallowed in robots.txt).
export const metadata = {
  title: { absolute: "My Page - Cart | Onside" },
  robots: { index: false, follow: false },
};

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageSubmissionCartPage() {
  return SubmissionCartPageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

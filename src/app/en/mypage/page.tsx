import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { StatusPageView } from "@/app/dashboard/view";

export { metadata } from "@/app/mypage/page";

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageStatusPage() {
  return StatusPageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

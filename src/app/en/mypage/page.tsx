import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { StatusPageView } from "@/app/dashboard/page";

export { metadata } from "@/app/mypage/page";

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageStatusPage() {
  return StatusPageView({
    contextLabel: "마이페이지",
    tabs,
    loginPath: "/en/login",
  });
}

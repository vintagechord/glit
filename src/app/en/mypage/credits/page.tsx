import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { CreditsPageView } from "@/app/dashboard/credits/page";

export { metadata } from "@/app/mypage/credits/page";

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function EnglishMyPageCreditsPage() {
  return CreditsPageView({
    contextLabel: "마이페이지",
    tabs,
    loginPath: "/en/login",
  });
}

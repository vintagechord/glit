import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { ProfilePageView } from "@/app/dashboard/profile/page";

export { metadata } from "@/app/mypage/profile/page";

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageProfilePage() {
  return ProfilePageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

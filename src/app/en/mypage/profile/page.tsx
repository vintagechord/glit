import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { ProfilePageView } from "@/app/dashboard/profile/page";

export { metadata } from "@/app/mypage/profile/page";

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function EnglishMyPageProfilePage() {
  return ProfilePageView({
    contextLabel: "마이페이지",
    tabs,
    loginPath: "/en/login",
  });
}

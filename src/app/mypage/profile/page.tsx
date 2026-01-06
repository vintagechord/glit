import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { ProfilePageView } from "@/app/dashboard/profile/page";

export const metadata = {
  title: "마이페이지 - 계정 정보",
};

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function MyPageProfilePage() {
  return ProfilePageView({
    contextLabel: "마이페이지",
    tabs,
  });
}

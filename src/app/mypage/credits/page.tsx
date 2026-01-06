import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { CreditsPageView } from "@/app/dashboard/credits/page";

export const metadata = {
  title: "마이페이지 - 크레딧",
};

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function MyPageCreditsPage() {
  return CreditsPageView({
    contextLabel: "마이페이지",
    tabs,
  });
}

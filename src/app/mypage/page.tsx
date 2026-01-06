import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { StatusPageView } from "@/app/dashboard/page";

export const metadata = {
  title: "마이페이지 - 접수현황",
};

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function MyPageStatusPage() {
  return StatusPageView({
    contextLabel: "마이페이지",
    tabs,
  });
}

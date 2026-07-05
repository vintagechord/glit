import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { SubmissionCartPageView } from "@/app/dashboard/cart/page";

export const metadata = {
  title: "마이페이지 - 장바구니",
};

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function MyPageSubmissionCartPage() {
  return SubmissionCartPageView({
    contextLabel: "마이페이지",
    tabs,
  });
}

import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { SubmissionCartPageView } from "@/app/dashboard/cart/page";

export { metadata } from "@/app/mypage/cart/page";

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function EnglishMyPageSubmissionCartPage() {
  return SubmissionCartPageView({
    contextLabel: "마이페이지",
    tabs,
    loginPath: "/en/login",
  });
}

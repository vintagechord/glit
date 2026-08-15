import {
  englishDefaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { SubmissionCartPageView } from "@/app/dashboard/cart/page";

export { metadata } from "@/app/mypage/cart/page";

const tabs: DashboardTab[] = englishDefaultDashboardTabs;

export default async function EnglishMyPageSubmissionCartPage() {
  return SubmissionCartPageView({
    contextLabel: "My Page",
    tabs,
    loginPath: "/en/login",
  });
}

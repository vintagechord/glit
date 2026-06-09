import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { DraftSubmissionsPageView } from "@/app/dashboard/drafts/page";

export { metadata } from "@/app/mypage/drafts/page";

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function EnglishMyPageDraftsPage() {
  return DraftSubmissionsPageView({
    contextLabel: "마이페이지",
    tabs,
    loginPath: "/en/login",
  });
}

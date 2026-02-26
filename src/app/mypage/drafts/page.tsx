import {
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { DraftSubmissionsPageView } from "@/app/dashboard/drafts/page";

export const metadata = {
  title: "마이페이지 - 작성중 신청서",
};

const tabs: DashboardTab[] = defaultDashboardTabs;

export default async function MyPageDraftSubmissionsPage() {
  return DraftSubmissionsPageView({
    contextLabel: "마이페이지",
    tabs,
  });
}

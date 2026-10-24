import { englishStatusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { StatusPageView } from "@/app/dashboard/view";

export { metadata } from "@/app/dashboard/page";

export default async function EnglishDashboardPage() {
  return StatusPageView({
    contextLabel: "Status",
    tabs: englishStatusDashboardTabs,
    loginPath: "/en/login",
  });
}

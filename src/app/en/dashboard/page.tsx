import { statusDashboardTabs } from "@/components/dashboard/dashboard-shell";
import { StatusPageView } from "@/app/dashboard/page";

export { metadata } from "@/app/dashboard/page";

export default async function EnglishDashboardPage() {
  return StatusPageView({
    contextLabel: "진행상황",
    tabs: statusDashboardTabs,
    loginPath: "/en/login",
  });
}

import { SubmissionOrdersPageView } from "@/app/dashboard/orders/page";
import { englishDefaultDashboardTabs } from "@/components/dashboard/dashboard-shell";
export const dynamic = "force-dynamic";
export const metadata = { title: "My Page - Orders" };
export default async function EnglishOrdersPage() {
  return SubmissionOrdersPageView({ tabs: englishDefaultDashboardTabs, contextLabel: "My Page" });
}

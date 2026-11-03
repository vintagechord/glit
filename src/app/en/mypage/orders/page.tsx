import { SubmissionOrdersPageView } from "@/app/dashboard/orders/view";
import { englishDefaultDashboardTabs } from "@/components/dashboard/dashboard-shell";
export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "My Page - Orders | Onside" }, robots: { index: false, follow: false } };
export default async function EnglishOrdersPage() {
  return SubmissionOrdersPageView({ tabs: englishDefaultDashboardTabs, contextLabel: "My Page" });
}

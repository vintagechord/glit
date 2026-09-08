import { redirect } from "next/navigation";
import { DashboardShell, defaultDashboardTabs, type DashboardTab } from "@/components/dashboard/dashboard-shell";
import { SubmissionOrdersClient } from "@/components/dashboard/submission-orders-client";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";
export const metadata = { title: "주문내역" };

export async function SubmissionOrdersPageView({ tabs = defaultDashboardTabs, contextLabel = "마이페이지" }: { tabs?: DashboardTab[]; contextLabel?: string } = {}) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  return <DashboardShell title="주문내역" activeTab="orders" tabs={tabs} contextLabel={contextLabel}>
    <SubmissionOrdersClient userId={user?.id ?? null} />
  </DashboardShell>;
}
export default function DashboardOrdersPage() { redirect("/mypage/orders"); }

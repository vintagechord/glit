import { Suspense } from "react";
import { DashboardShell, defaultDashboardTabs, type DashboardTab } from "@/components/dashboard/dashboard-shell";
import { SubmissionOrdersClient } from "@/components/dashboard/submission-orders-client";
import { listSubmissionOrders } from "@/lib/submission-orders";
import type { SubmissionOrdersPage } from "@/lib/submission-orders-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

async function loadInitialOrders(userId: string) {
  let initialPage: SubmissionOrdersPage | undefined;
  let initialError: string | null = null;
  try {
    initialPage = await listSubmissionOrders(createAdminClient(), {
      userId,
      guestTokensBySubmissionId: {},
    });
  } catch {
    initialError = "주문내역을 불러오지 못했습니다. 다시 시도해주세요.";
  }
  return { initialPage, initialError, initialFetchedAt: Date.now() };
}

async function SubmissionOrdersContent() {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  if (!user) return <SubmissionOrdersClient key="guest" userId={null} />;
  const initial = await loadInitialOrders(user.id);
  return <SubmissionOrdersClient key={user.id} userId={user.id} {...initial} />;
}

export function SubmissionOrdersPageView({ tabs = defaultDashboardTabs, contextLabel = "마이페이지" }: { tabs?: DashboardTab[]; contextLabel?: string } = {}) {
  return <DashboardShell title="주문내역" activeTab="orders" tabs={tabs} contextLabel={contextLabel}>
    <Suspense fallback={<p role="status" className="py-8 text-sm text-muted-foreground">주문내역을 불러오는 중입니다...</p>}>
      <SubmissionOrdersContent />
    </Suspense>
  </DashboardShell>;
}

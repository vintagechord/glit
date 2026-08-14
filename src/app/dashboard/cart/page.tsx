import { redirect } from "next/navigation";

import {
  DashboardShell,
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { SubmissionCartCheckout } from "@/components/dashboard/submission-cart-checkout";
import { getSubmissionCartItems } from "@/lib/submission-cart";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "장바구니",
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
  loginPath?: string;
};

export async function SubmissionCartPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);
  const { items, error } = user
    ? await getSubmissionCartItems(user.id)
    : { items: [], error: null };

  if (error) {
    console.error("[SubmissionCartPage] query failed", error);
  }

  return (
    <DashboardShell
      title="장바구니"
      description="작성 완료된 미결제 신청서를 담아 두고 한 번에 결제할 수 있습니다."
      activeTab="cart"
      tabs={config?.tabs ?? defaultDashboardTabs}
      contextLabel={config?.contextLabel ?? "마이페이지"}
    >
      <SubmissionCartCheckout userId={user?.id ?? null} initialItems={items} />
    </DashboardShell>
  );
}

export default function DashboardSubmissionCartPage() {
  redirect("/mypage/cart");
}

import { redirect } from "next/navigation";

import {
  DashboardShell,
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import {
  DraftSubmissionList,
  type DraftSubmissionItem,
} from "@/components/dashboard/draft-submission-list";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "작성중 신청서",
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
  loginPath?: string;
};

export async function DraftSubmissionsPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    redirect(config?.loginPath ?? "/login");
  }

  const { data, error } = await supabase
    .from("submissions")
    .select("id, type, status, payment_status, title, artist_name, updated_at")
    .eq("user_id", user.id)
    .in("status", ["DRAFT", "PRE_REVIEW"])
    .or("payment_status.is.null,payment_status.in.(UNPAID,PAYMENT_PENDING)")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[DraftSubmissionsPage] query failed", error);
  }

  const initialItems: DraftSubmissionItem[] = ((data ?? []) as Array<{
    id: string;
    type: string;
    status: string;
    payment_status: string | null;
    title: string | null;
    artist_name: string | null;
    updated_at: string | null;
  }>).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    paymentStatus: row.payment_status,
    title: row.title,
    artistName: row.artist_name,
    updatedAt: row.updated_at,
  }));

  return (
    <DashboardShell
      title="작성중 신청서"
      activeTab="drafts"
      tabs={config?.tabs ?? defaultDashboardTabs}
      contextLabel={config?.contextLabel ?? "마이페이지"}
    >
      <DraftSubmissionList userId={user.id} initialItems={initialItems} />
    </DashboardShell>
  );
}

export default function DashboardDraftSubmissionsPage() {
  redirect("/mypage/drafts");
}

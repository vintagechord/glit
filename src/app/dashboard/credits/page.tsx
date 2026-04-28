import { redirect } from "next/navigation";

import {
  DashboardShell,
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "크레딧",
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
};

export async function CreditsPageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const { data: creditRow } = await supabase
    .from("karaoke_credits")
    .select("balance")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <DashboardShell
      title="크레딧"
      description="노래방 등록 추천을 위한 크레딧 현황을 확인합니다."
      activeTab="credits"
      tabs={config?.tabs ?? defaultDashboardTabs}
      contextLabel={config?.contextLabel ?? "마이페이지"}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            보유 크레딧
          </p>
          <p className="mt-4 text-3xl font-black text-foreground">
            {creditRow?.balance ?? 0}
          </p>
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            추천 인증이 승인되면 크레딧이 적립됩니다.
          </p>
        </div>
        <div className="rounded-[10px] border-2 border-[#111111] bg-background/80 p-6 text-sm font-semibold text-muted-foreground shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            크레딧 안내
          </p>
          <p className="mt-4">
            크레딧은 노래방 등록 추천에 사용됩니다. 추천 인증샷이 관리자 승인
            처리되면 크레딧이 자동 반영됩니다.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}

export default function DashboardCreditsPage() {
  redirect("/mypage/credits");
}

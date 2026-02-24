import { redirect } from "next/navigation";

import {
  DashboardShell,
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";
import { ProfileForm } from "@/features/profile/profile-form";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "계정 정보",
};

type ShellConfig = {
  contextLabel?: string;
  tabs?: DashboardTab[];
};

export async function ProfilePageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, company, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <DashboardShell
      title="계정 정보"
      description="담당자 정보를 최신 상태로 유지해주세요."
      activeTab="profile"
      tabs={config?.tabs ?? defaultDashboardTabs}
      contextLabel={config?.contextLabel ?? "마이페이지"}
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[32px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            프로필 수정
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            담당자 정보를 업데이트하세요.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            접수 진행 및 결과 통보를 위한 기본 정보를 관리합니다.
          </p>
          <div className="mt-6">
            <ProfileForm
              defaultValues={{
                name: profile?.name ?? user.user_metadata?.name ?? "",
                company: profile?.company ?? user.user_metadata?.company ?? "",
                phone: profile?.phone ?? user.user_metadata?.phone ?? "",
              }}
            />
          </div>
        </div>

        <div className="space-y-4 rounded-[32px] border border-border/60 bg-background/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            계정 요약
          </p>
          <div className="rounded-2xl border border-border/60 bg-card/80 p-4">
            <p className="text-xs text-muted-foreground">로그인 이메일</p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {user.email}
            </p>
          </div>
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/80 p-4 text-xs text-muted-foreground">
            저장된 정보는 접수 확인 및 심의 통보에 활용됩니다.
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

export default function DashboardProfilePage() {
  redirect("/mypage/profile");
}

import { redirect } from "next/navigation";
import { Mail, UserRound } from "lucide-react";

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
  loginPath?: string;
};

export async function ProfilePageView(config?: ShellConfig) {
  const supabase = await createServerSupabase();
  const user = await getServerSessionUser(supabase);

  if (!user) {
    redirect(config?.loginPath ?? "/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, company, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <DashboardShell
      title="계정 정보"
      activeTab="profile"
      tabs={config?.tabs ?? defaultDashboardTabs}
      contextLabel={config?.contextLabel ?? "마이페이지"}
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <h2 className="flex items-center gap-2 text-lg font-black text-foreground">
            <UserRound className="h-5 w-5" aria-hidden="true" />
            프로필
          </h2>
          <div className="mt-5">
            <ProfileForm
              defaultValues={{
                name: profile?.name ?? user.user_metadata?.name ?? "",
                company: profile?.company ?? user.user_metadata?.company ?? "",
                phone: profile?.phone ?? user.user_metadata?.phone ?? "",
              }}
            />
          </div>
        </div>

        <div className="h-fit rounded-[10px] border-2 border-[#111111] bg-background/80 p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#f2cf27] text-[#111111]">
              <Mail className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-black text-muted-foreground">로그인 이메일</p>
              <p className="mt-1 break-all text-sm font-semibold text-foreground">
                {user.email}
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

export default function DashboardProfilePage() {
  redirect("/mypage/profile");
}

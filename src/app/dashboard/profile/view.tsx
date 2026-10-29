import { redirect } from "next/navigation";

import { Mail, UserRound } from "lucide-react";

import {
  DashboardShell,
  defaultDashboardTabs,
  type DashboardTab,
} from "@/components/dashboard/dashboard-shell";

import { ProfileForm } from "@/features/profile/profile-form";
import { ProfileSocialAccountsView } from "@/features/profile/profile-social-accounts-view";
import { getProfileAuthDetails } from "@/features/profile/profile-auth";

import { createServerSupabase } from "@/lib/supabase/server";

import { getServerSessionUser } from "@/lib/supabase/server-user";
import { isEmailLessSocialMember } from "@/lib/member-notification-email";

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

  const english = config?.loginPath?.startsWith("/en/") ?? false;
  const auth = getProfileAuthDetails(user);
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, company, phone, notification_email")
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
              canChangePassword={auth.canChangePassword}
              canEditNotificationEmail={isEmailLessSocialMember(user)}
              english={english}
              defaultValues={{
                name: profile?.name ?? user.user_metadata?.name ?? "",
                company: profile?.company ?? user.user_metadata?.company ?? "",
                phone: profile?.phone ?? user.user_metadata?.phone ?? "",
                notificationEmail: profile?.notification_email ?? "",
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
              <p className="text-[11px] font-black text-muted-foreground">{auth.hasEmailIdentity ? (english ? "Login email" : "로그인 이메일") : (english ? "Account email" : "계정 이메일")}</p>
              <p className="mt-1 break-all text-sm font-semibold text-foreground">
                {auth.email ?? (english ? "Email not provided" : "제공된 이메일 없음")}
              </p>
            </div>
          </div>
          {!auth.email && <div className="mt-4 space-y-2">
            <p className="text-xs leading-5 text-muted-foreground">{english ? "This social account does not provide an email address. Save your review notification email in your profile to receive results and updates." : "이 소셜 계정은 이메일을 제공하지 않습니다. 프로필에 심의 안내 수신 이메일을 저장하면 결과와 진행 안내를 받을 수 있습니다."}</p>
            {profile?.notification_email && <p className="break-all text-xs font-semibold text-foreground">{english ? "Notification email: " : "안내 수신 이메일: "}{profile.notification_email}</p>}
          </div>}
          <ProfileSocialAccountsView linkedProviders={auth.linkedProviders} english={english} />
        </div>
      </div>
    </DashboardShell>
  );
}

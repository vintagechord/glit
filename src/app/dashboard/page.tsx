import { redirect } from "next/navigation";

import { ProfileForm } from "@/features/profile/profile-form";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "대시보드",
};

export default async function DashboardPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, company, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Dashboard
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            접수 현황을 준비 중입니다.
          </h1>
        </div>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            로그아웃
          </button>
        </form>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[32px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            내 정보
          </p>
          <h2 className="mt-3 text-xl font-semibold text-foreground">
            프로필을 업데이트하세요.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            접수 진행 상황 업데이트와 결과 통보에 필요한 정보를 관리합니다.
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
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            계정 요약
          </p>
          <div className="rounded-2xl border border-border/60 bg-card/80 p-4">
            <p className="text-xs text-muted-foreground">로그인 이메일</p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {user.email}
            </p>
          </div>
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/80 p-4 text-xs text-muted-foreground">
            곧 접수 내역, 진행 상태, 실시간 알림이 이 영역에 표시됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}

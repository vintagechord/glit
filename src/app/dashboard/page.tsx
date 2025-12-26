import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "@/features/profile/profile-form";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "대시보드",
};

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
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

  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      "id, title, artist_name, status, payment_status, created_at, updated_at, type, package:packages ( name, price_krw )",
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Dashboard
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            내 심의 접수 현황
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/new"
            className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
          >
            새 접수
          </Link>
          <form action="/logout" method="post">
            <button
              type="submit"
              className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              로그아웃
            </button>
          </form>
        </div>
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
            심의 진행 상태와 결과는 접수 상세 페이지에서 확인할 수 있습니다.
          </div>
        </div>
      </div>

      <div className="mt-10 rounded-[32px] border border-border/60 bg-card/80 p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            최근 접수
          </p>
          <Link
            href="/dashboard/history"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:text-foreground"
          >
            전체 보기
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {submissions && submissions.length > 0 ? (
            submissions.map((submission) => (
              <Link
                key={submission.id}
                href={`/dashboard/submissions/${submission.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm transition hover:border-foreground"
              >
                <div>
                  <p className="font-semibold text-foreground">
                    {submission.title || "제목 미입력"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {submission.artist_name || "아티스트 미입력"} ·{" "}
                    {submission.type}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>
                    {submission.package?.price_krw
                      ? `${formatCurrency(submission.package.price_krw)}원`
                      : "-"}
                  </p>
                  <p>{formatDateTime(submission.updated_at)}</p>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
              아직 접수된 내역이 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

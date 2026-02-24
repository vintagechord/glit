import Link from "next/link";
import { redirect } from "next/navigation";

import { TrackLookupForm } from "@/features/track/track-lookup-form";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "진행상황",
};

export default async function TrackPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="page-centered mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-[32px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          진행상황 조회
        </p>
        <h1 className="font-display mt-3 text-3xl text-foreground">
          {isLoggedIn ? "접수된 심의가 없습니다" : "비회원 진행상황 확인"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {isLoggedIn
            ? "심의 접수를 진행하면 진행상황을 바로 확인할 수 있습니다."
            : "접수 시 발급받은 조회 코드를 입력하면 진행상황을 확인할 수 있으며, 코드를 잊어도 이름/이메일로 다시 찾을 수 있습니다."}
        </p>
        {isLoggedIn ? (
          <div className="mt-6">
            <Link
              href="/dashboard/new"
              className="inline-flex items-center rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-[#f6d64a] hover:text-black"
            >
              새 접수 시작 →
            </Link>
          </div>
        ) : (
          <>
            <TrackLookupForm />
            <div className="mt-6 text-xs text-muted-foreground">
              회원이라면 마이페이지에서 진행상황을 바로 확인할 수 있습니다.
            </div>
            <div className="mt-4">
              <Link
                href="/login"
                className="text-xs font-semibold text-muted-foreground transition hover:text-foreground"
              >
                로그인하러 가기 →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

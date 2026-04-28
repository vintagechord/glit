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
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]">
        <p className="bauhaus-kicker">
          진행상황 조회
        </p>
        <h1 className="font-display mt-4 text-3xl font-black text-foreground">
          {isLoggedIn ? "접수된 심의가 없습니다" : "비회원 진행상황 확인"}
        </h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-muted-foreground">
          {isLoggedIn
            ? "심의 접수를 진행하면 진행상황을 바로 확인할 수 있습니다."
            : "접수 시 발급받은 조회 코드를 입력하면 진행상황을 확인할 수 있으며, 코드를 잊어도 이름/이메일로 다시 찾을 수 있습니다."}
        </p>
        {isLoggedIn ? (
          <div className="mt-6">
            <Link
              href="/dashboard/new"
              className="bauhaus-button px-4 py-2 text-xs uppercase"
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

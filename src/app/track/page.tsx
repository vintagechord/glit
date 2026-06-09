import { redirect } from "next/navigation";

import { TrackLookupForm } from "@/features/track/track-lookup-form";
import { TrackLookupSelector } from "@/features/track/track-lookup-selector";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "진행상황",
};

type TrackPageProps = {
  searchParams?: Promise<{ mode?: string | string[] }>;
};

export default async function TrackPage({ searchParams }: TrackPageProps) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const modeRaw = Array.isArray(resolvedSearchParams.mode)
    ? resolvedSearchParams.mode[0]
    : resolvedSearchParams.mode;
  const isGuestMode = modeRaw === "guest";

  return (
    <div className="page-centered mx-auto w-full max-w-4xl px-6 py-12">
      <div>
        <p className="bauhaus-kicker">
          진행/결과 조회
        </p>
        <h1 className="font-display mt-4 text-3xl font-black text-foreground">
          {isGuestMode ? "비회원 진행/결과 조회" : "조회 방식을 선택하세요"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
          {isGuestMode
            ? "접수 시 발급받은 조회 코드를 입력하면 진행 상태와 결과를 확인할 수 있습니다."
            : "회원은 로그인 후 접수 현황으로 이동하고, 비회원은 조회 코드로 진행 상태와 결과를 확인합니다."}
        </p>
        {isGuestMode ? (
          <div className="mt-8 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
            <TrackLookupForm />
          </div>
        ) : (
          <TrackLookupSelector />
        )}
      </div>
    </div>
  );
}

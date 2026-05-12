import Link from "next/link";

import { TrackLookupForm } from "@/features/track/track-lookup-form";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "결과 확인",
};

export default async function TrackPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(user);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="rounded-[8px] border border-[#d8e1ef] bg-white p-5 dark:border-white/10 dark:bg-[#111827] sm:p-6">
        <p className="text-sm font-semibold text-[#2f6f9f] dark:text-[#a9c8dc]">
          Review Result
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-[#2f3a4d] dark:text-white sm:text-3xl">
          결과 확인
        </h1>
        <p className="mt-3 break-keep text-sm leading-6 text-[#667085] dark:text-white/64">
          접수 시 발급받은 코드로 진행 상황과 결과를 확인할 수 있습니다.
        </p>
        {isLoggedIn ? (
          <div className="mt-5 rounded-[8px] border border-[#cbdde8] bg-[#edf4f7] p-4 text-sm text-[#526071] dark:border-[#a9c8dc]/30 dark:bg-[#a9c8dc]/10 dark:text-white/70">
            <p className="font-semibold text-[#2f3a4d] dark:text-white">
              로그인 접수 내역은 마이페이지에서도 확인할 수 있습니다.
            </p>
            <Link
              href="/dashboard"
              className="mt-3 inline-flex h-10 items-center rounded-[8px] bg-[#2f6f9f] px-4 text-sm font-semibold text-white transition hover:bg-[#285f87] dark:bg-[#78a7c3] dark:text-[#06111f]"
            >
              내 접수 현황 보기
            </Link>
          </div>
        ) : null}
        <TrackLookupForm />
        {!isLoggedIn ? (
          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            <Link
              href="/login"
              className="font-semibold text-[#2f6f9f] transition hover:text-[#285f87]"
            >
              로그인하러 가기
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

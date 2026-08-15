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

type TrackPageViewOptions = {
  dashboardPath?: string;
};

export async function TrackPageView({
  searchParams,
  dashboardPath = "/dashboard",
}: TrackPageProps & TrackPageViewOptions) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(dashboardPath);
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const modeRaw = Array.isArray(resolvedSearchParams.mode)
    ? resolvedSearchParams.mode[0]
    : resolvedSearchParams.mode;
  const isGuestMode = modeRaw === "guest";

  return (
    <div className="page-centered mx-auto w-full max-w-4xl px-6 py-12">
      <div>
        <h1 className="font-display text-3xl font-black text-foreground">
          {isGuestMode ? "비회원 진행/결과 조회" : "조회 방식을 선택하세요"}
        </h1>
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

export default async function TrackPage({ searchParams }: TrackPageProps) {
  return TrackPageView({ searchParams });
}

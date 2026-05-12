import { MvWizard } from "@/features/submissions/mv-wizard";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "MV 심의 접수",
};

export default async function MvSubmissionPage() {
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 === "true";
  const user = await getServerSessionUser(supabase);

  const { data: stationRows } = await supabase
    .from("stations")
    .select("id, name, code")
    .in("code", ["KBS", "MBC", "SBS", "ETN", "MNET"])
    .eq("is_active", true);

  const { data: profanityRows } = await supabase
    .from("profanity_terms")
    .select("term, language")
    .eq("is_active", true)
    .order("term", { ascending: true });

  const profanityTerms =
    profanityRows?.map((row) => ({
      term: row.term,
      language: row.language,
    })) ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[15px] leading-relaxed sm:px-6 sm:py-12 sm:text-base">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[#2f6f9f] dark:text-[#a9c8dc]">
            MV Review
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-[#2f3a4d] dark:text-white">
            MV 심의 접수
          </h1>
          <p className="mt-3 break-keep text-base text-[#667085] dark:text-white/64">
            비회원도 접수할 수 있으며, 로그인 시 마이페이지에서 진행 상황을
            확인할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="relative mt-8 rounded-[8px] border border-[#d8e1ef] bg-white p-6 dark:border-white/10 dark:bg-[#111827]">
        <p className="text-sm font-semibold tracking-normal text-[#667085] dark:text-white/64">
          접수 전 참고사항
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[#2f3a4d] dark:text-white">
          뮤직비디오 심의, 이것만 확인하세요
        </h2>
        <ul className="mt-4 space-y-2 text-base text-[#667085] dark:text-white/64">
          <li>TV 송출 목적은 방송국별 개별 심의가 필요합니다.</li>
          <li>온라인 업로드 목적은 기본 MV 심의로 유통/업로드 가능합니다.</li>
        </ul>
      </div>

      <div className="mt-8">
        <MvWizard
          stations={stationRows ?? []}
          userId={user?.id ?? null}
          userEmail={user?.email ?? null}
          profanityTerms={profanityTerms}
          profanityFilterV2Enabled={profanityFilterV2Enabled}
        />
      </div>
    </div>
  );
}

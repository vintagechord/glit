import { MvWizard } from "@/features/submissions/mv-wizard";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "MV 심의 접수",
};

export default async function MvSubmissionPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: stationRows } = await supabase
    .from("stations")
    .select("id, name, code")
    .in("code", ["KBS", "MBC", "SBS", "ETN", "MNET"])
    .eq("is_active", true);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 text-[15px] leading-relaxed sm:text-base">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            MV Review
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            MV 심의 접수
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            비회원도 접수할 수 있으며, 로그인 시 마이페이지에서 진행 상황을
            확인할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="mt-8 rounded-[28px] border border-border/60 bg-background/80 p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          접수 전 참고사항
        </p>
        <h2 className="font-display mt-2 text-2xl text-foreground">
          뮤직비디오 심의, 이것만 확인하세요
        </h2>
        <ul className="mt-4 space-y-2 text-base text-muted-foreground">
          <li>뮤직비디오 심의는 음원 심의 완료 후 진행 가능합니다.</li>
          <li>TV 송출 목적은 방송국별 개별 심의가 필요합니다.</li>
          <li>온라인 업로드 목적은 기본 MV 심의로 유통/업로드 가능합니다.</li>
        </ul>
      </div>

      <div className="mt-8">
        <MvWizard stations={stationRows ?? []} userId={user?.id ?? null} />
      </div>
    </div>
  );
}

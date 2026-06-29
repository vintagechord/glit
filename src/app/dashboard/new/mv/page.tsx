import { MvWizard } from "@/features/submissions/mv-wizard";
import { createServerSupabase } from "@/lib/supabase/server";
import { getServerSessionUser } from "@/lib/supabase/server-user";

export const metadata = {
  title: "뮤직비디오 심의 접수",
};

const mvChecklist = [
  "영상 파일: MOV 또는 MP4 권장",
  "해상도: 1920×1080 권장",
  "프레임: 29.97fps 권장",
  "TV 송출용은 방송국별 제출 조건 확인",
];

const purposeNotes = [
  {
    title: "온라인 유통/업로드",
    description:
      "멜론·지니·벅스·플로·유튜브 등 유통사 제출이나 온라인 업로드용으로 진행합니다.",
  },
  {
    title: "TV 송출",
    description:
      "방송국 송출 목적은 KBS, MBC, SBS 등 방송국별 조건과 편성 여부를 확인한 뒤 접수합니다.",
  },
];

export default async function MvSubmissionPage() {
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 !== "false";
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
    <div className="mx-auto w-full max-w-6xl px-6 py-12 text-[15px] leading-relaxed sm:text-base">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="bauhaus-kicker">뮤직비디오 심의 신청</p>
          <h1 className="font-display mt-4 text-3xl font-black text-foreground">
            뮤직비디오 심의 접수
          </h1>
          <p className="mt-3 text-base font-semibold text-muted-foreground">
            비회원도 접수할 수 있으며, 로그인 시 마이페이지에서 진행 상황을
            확인할 수 있습니다.
          </p>
        </div>
      </div>

      <div className="relative mt-8 rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27] sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)] lg:items-stretch">
          <div className="flex min-h-full flex-col">
            <p className="text-sm font-black uppercase tracking-normal text-muted-foreground">
              업로드 전 확인
            </p>
            <h2 className="font-display mt-2 text-2xl font-black text-foreground">
              뮤직비디오 심의, 이것만 확인하세요
            </h2>
            <ul className="mt-5 space-y-2 text-sm font-semibold leading-6 text-muted-foreground">
              {mvChecklist.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-2 w-2 shrink-0 bg-[#1556a4]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:h-full lg:grid-cols-1 lg:auto-rows-fr">
            {purposeNotes.map((item) => (
              <div
                key={item.title}
                className="flex min-h-[112px] flex-col justify-center rounded-[8px] border-2 border-border bg-background px-4 py-4 lg:min-h-0"
              >
                <p className="text-base font-black text-foreground">
                  {item.title}
                </p>
                <p className="mt-2 break-keep text-sm font-semibold leading-6 text-muted-foreground sm:text-[15px]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
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

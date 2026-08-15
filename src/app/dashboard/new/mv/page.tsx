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

const mvStationRows = [
  { id: "", name: "KBS", code: "KBS" },
  { id: "", name: "MBC", code: "MBC" },
  { id: "", name: "SBS", code: "SBS" },
  { id: "", name: "ETN", code: "ETN" },
  { id: "", name: "Mnet", code: "MNET" },
];

export default async function MvSubmissionPage() {
  const supabase = await createServerSupabase();
  const profanityFilterV2Enabled = process.env.PROFANITY_FILTER_V2 !== "false";
  const user = await getServerSessionUser(supabase);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[15px] leading-relaxed sm:px-6 sm:py-12 sm:text-base">
      <section className="rounded-[10px] border-2 border-[#111111] bg-card p-6 shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27] sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-black text-foreground">
              뮤직비디오 심의 접수
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-black text-foreground">
                비회원 가능
              </span>
            </div>
          </div>
          <details className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 sm:w-auto sm:min-w-72">
            <summary className="cursor-pointer text-sm font-black text-foreground">
              영상 규격 확인
            </summary>
            <ul className="mt-3 grid gap-2 text-xs font-semibold text-muted-foreground">
              {mvChecklist.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 bg-[#1556a4]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </section>

      <div className="mt-8">
        <MvWizard
          stations={mvStationRows}
          userId={user?.id ?? null}
          userEmail={user?.email ?? null}
          profanityFilterV2Enabled={profanityFilterV2Enabled}
        />
      </div>
    </div>
  );
}

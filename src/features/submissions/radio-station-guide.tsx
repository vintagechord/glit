"use client";

import { ArrowUpRight, ListMusic, MessageSquareText, Radio } from "lucide-react";
import { getRadioStationGuide } from "@/lib/radio-station-guide";

const linkClass = "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] [&>svg]:shrink-0";

export function RadioStationGuideContent({ stationCode, stationName, isEnglish = false, onSelectProgram, selectedProgram }: {
  stationCode?: string | null;
  stationName?: string | null;
  isEnglish?: boolean;
  onSelectProgram?: (name: string) => void;
  selectedProgram?: string;
}) {
  const guide = getRadioStationGuide({ stationCode, stationName });
  const locale = isEnglish ? "en" : "ko";
  if (!guide) return (
    <div className="rounded-xl border border-border bg-muted/50 p-5 text-sm leading-6">
      <h3 className="font-bold">{isEnglish ? "Confirm the participation route first" : "참여 경로를 먼저 확인해주세요"}</h3>
      <p className="mt-2 text-muted-foreground">{isEnglish ? "A public request board has not been verified for this broadcaster. Contact the broadcaster for its participation route. Approval from another station does not apply here." : "이 방송국의 공개 신청곡 게시판은 확인되지 않았습니다. 방송국에 참여 경로를 문의해주세요. 다른 방송국의 적격 결과를 대신 적용할 수는 없습니다."}</p>
    </div>
  );

  return (
    <div className="min-w-0 space-y-5" data-testid="radio-station-guide">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-[#1556a4] text-xs font-black text-white">1</span>
          <h3 className="text-base font-black">{isEnglish ? "Find a program for your song" : "내 곡과 맞는 프로그램 찾기"}</h3>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{guide.introduction[locale]}</p>
      </div>
      {guide.programs.length > 0 ? (
        <div className="space-y-3">
          {guide.programs.map(program => (
            <article key={program.url} className="min-w-0 rounded-xl border border-[#1556a4]/25 bg-[#1556a4]/[0.04] p-4 dark:border-blue-300/30 dark:bg-blue-300/5">
              <div className="flex items-start gap-2">
                <Radio className="mt-0.5 size-5 shrink-0 text-[#1556a4] dark:text-blue-300" aria-hidden />
                <a href={program.url} target="_blank" rel="noopener noreferrer" className="min-w-0 text-base font-black underline decoration-border underline-offset-4 hover:decoration-current">{program.name}<span className="sr-only">{isEnglish ? " (official program, new tab)" : " (공식 프로그램, 새 창)"}</span></a>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{program.description[locale]}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <a href={program.playlistUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} border border-border bg-background hover:bg-muted`}><ListMusic size={16} aria-hidden />{isEnglish ? "View tracklist" : "최근 선곡표 보기"}<span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>
                <a href={program.messageUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} bg-[#1556a4] text-white hover:bg-[#104581]`}><MessageSquareText size={16} aria-hidden />{isEnglish ? "Send Message board" : "메시지 게시판 열기"}<span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>
              </div>
              {onSelectProgram && <button type="button" onClick={() => onSelectProgram(program.name)} aria-pressed={selectedProgram === program.name} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-bold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4]">{selectedProgram === program.name ? (isEnglish ? "Selected for draft" : "신청 문구에 선택됨") : (isEnglish ? "Use this program in my draft" : "이 프로그램으로 문구 준비")}</button>}
            </article>
          ))}
        </div>
      ) : null}
      <a href={guide.directoryUrl} target="_blank" rel="noopener noreferrer" className={`${linkClass} w-full border border-border bg-background hover:bg-muted`}>
        {guide.name} · {isEnglish ? "All programs" : "전체 프로그램 보기"}<ArrowUpRight size={17} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span>
      </a>
      <div className="space-y-4 rounded-xl bg-muted/60 p-4 text-sm leading-6">
        <div><h4 className="font-bold">{isEnglish ? "Where to post" : "어디에 등록하나요?"}</h4><p className="mt-1 text-muted-foreground">{guide.route[locale]}</p></div>
        {guide.participationLink && <div><h4 className="font-bold">{isEnglish ? "Join during the show" : "방송 중에 참여하려면"}</h4><p className="mt-1 text-muted-foreground">{guide.participationLink.description[locale]}</p><a href={guide.participationLink.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 font-bold underline underline-offset-4">{guide.participationLink.name}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a></div>}
        <div><h4 className="font-bold">{isEnglish ? "What to check afterward" : "신청한 다음에는?"}</h4><p className="mt-1 text-muted-foreground">{guide.followUp[locale]}</p></div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{isEnglish ? "Official links checked" : "공식 링크 확인"} {guide.verifiedAt} · {isEnglish ? "Check current board notices before posting." : "게시 전 최신 프로그램 공지를 확인해주세요."}</p>
    </div>
  );
}

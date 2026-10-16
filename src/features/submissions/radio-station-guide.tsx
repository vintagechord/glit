"use client";

import { ArrowRight, ArrowUpRight, Check, ChevronDown, ListMusic, MessageSquareText } from "lucide-react";
import { getRadioStationGuide } from "@/lib/radio-station-guide";

const linkClass = "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-slate-950 [&>svg]:shrink-0";
const primaryClass = `${linkClass} bg-[#1556a4] text-white hover:bg-[#104581]`;
const secondaryClass = `${linkClass} text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white`;

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
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="font-semibold">{isEnglish ? "Confirm the participation route first" : "참여 경로를 먼저 확인해주세요"}</h3>
      <p className="mt-2 text-muted-foreground">{isEnglish ? "A public request board has not been verified for this broadcaster. Contact the broadcaster for its participation route. Approval from another station does not apply here." : "이 방송국의 공개 신청곡 게시판은 확인되지 않았습니다. 방송국에 참여 경로를 문의해주세요. 다른 방송국의 적격 결과를 대신 적용할 수는 없습니다."}</p>
    </div>
  );

  return (
    <div className="min-w-0 space-y-5" data-testid="radio-station-guide">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-slate-200 text-xs font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">1</span>
          <h3 className="text-base font-semibold tracking-tight">{isEnglish ? "Find a program for your song" : "내 곡과 맞는 프로그램 찾기"}</h3>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{guide.introduction[locale]}</p>
      </div>
      {guide.programs.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-4">
          {guide.programs.map((program, index) => (
            <article key={program.url} className={`flex min-w-0 flex-col rounded-[1rem] border p-5 transition sm:p-6 ${selectedProgram === program.name ? "border-[#1556a4]/40 bg-blue-50/50 dark:border-blue-400/50 dark:bg-blue-950/20" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"}`}>
              <div className="flex items-center justify-between gap-3 text-[11px] font-medium tracking-wider text-slate-400 dark:text-slate-500">
                <span>{isEnglish ? "LISTENER REQUEST" : "청취자 참여"}</span>
                <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h4 className="mt-3"><a href={program.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded text-lg font-semibold tracking-tight text-slate-900 hover:text-[#1556a4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] dark:text-slate-100 dark:hover:text-blue-300 sm:text-xl">{program.name}<ArrowUpRight size={15} className="shrink-0 text-slate-400" aria-hidden /><span className="sr-only">{isEnglish ? " (official program, new tab)" : " (공식 프로그램, 새 창)"}</span></a></h4>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{program.description[locale]}</p>
              <div className="mt-4 flex flex-wrap gap-x-3">
                <a href={program.playlistUrl} target="_blank" rel="noopener noreferrer" className={`${secondaryClass} -ml-2 px-2 text-xs`}><ListMusic size={14} aria-hidden />{isEnglish ? "View tracklist" : "최근 선곡표 보기"}<span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>
                {onSelectProgram && <a href={program.messageUrl} target="_blank" rel="noopener noreferrer" className={`${secondaryClass} px-2 text-xs`}><MessageSquareText size={14} aria-hidden />{isEnglish ? "Send Message board" : "메시지 게시판 열기"}<span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>}
              </div>
              {onSelectProgram ? <button type="button" onClick={() => onSelectProgram(program.name)} aria-pressed={selectedProgram === program.name} className={`${primaryClass} mt-2 w-full`}>{selectedProgram === program.name ? <Check size={16} aria-hidden /> : null}{selectedProgram === program.name ? (isEnglish ? "Selected for draft" : "신청 문구에 선택됨") : (isEnglish ? "Use this program in my draft" : "이 프로그램으로 문구 준비")}{selectedProgram !== program.name && <ArrowRight size={16} aria-hidden />}</button> : <a href={program.messageUrl} target="_blank" rel="noopener noreferrer" className={`${primaryClass} mt-2 w-full`}>{isEnglish ? "Send Message board" : "메시지 게시판 열기"}<ArrowUpRight size={16} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>}
            </article>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {guide.programs.length > 0 && <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{isEnglish ? "Official broadcaster site · Sign in and post yourself" : "공식 방송국 사이트 · 로그인 후 직접 등록"}</p>}
        <a href={guide.directoryUrl} target="_blank" rel="noopener noreferrer" className={`${secondaryClass} -mx-2 px-2 text-xs`}>
          {guide.name} · {isEnglish ? "All programs" : "전체 프로그램 보기"}<ArrowUpRight size={14} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span>
        </a>
      </div>
      <details open={guide.programs.length === 0} className="group border-y border-slate-200 dark:border-slate-800">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden dark:text-slate-300">{isEnglish ? "Posting & follow-up guide" : "참여 방법과 신청 후 확인"}<ChevronDown size={16} className="shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden /></summary>
        <div className="space-y-5 pb-5 text-sm leading-6">
          <div><h4 className="font-medium">{isEnglish ? "Where to post" : "어디에 등록하나요?"}</h4><p className="mt-1 text-slate-500 dark:text-slate-400">{guide.route[locale]}</p></div>
          {guide.participationLink && <div><h4 className="font-medium">{isEnglish ? "Join during the show" : "방송 중에 참여하려면"}</h4><p className="mt-1 text-slate-500 dark:text-slate-400">{guide.participationLink.description[locale]}</p><a href={guide.participationLink.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 rounded font-medium text-[#1556a4] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] dark:text-blue-300">{guide.participationLink.name}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a></div>}
          <div><h4 className="font-medium">{isEnglish ? "What to check afterward" : "신청한 다음에는?"}</h4><p className="mt-1 text-slate-500 dark:text-slate-400">{guide.followUp[locale]}</p></div>
          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{isEnglish ? "Official links checked" : "공식 링크 확인"} {guide.verifiedAt} · {isEnglish ? "Check current board notices before posting." : "게시 전 최신 프로그램 공지를 확인해주세요."}</p>
        </div>
      </details>
    </div>
  );
}

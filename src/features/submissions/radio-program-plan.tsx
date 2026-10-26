"use client";

import { ArrowUpRight, CalendarDays } from "lucide-react";
import type { RadioProgramGuide } from "@/lib/radio-station-guide";
import { formatRadioSchedule, getRadioProgramPlan } from "@/lib/radio-program-plans";
import { radioButtonClass, radioCardClass, radioNoteClass } from "./radio-request-ui";

export function RadioProgramSchedule({ programs, isEnglish = false }: { programs: RadioProgramGuide[]; isEnglish?: boolean }) {
  return <div className={radioCardClass} data-testid="radio-program-schedule">
    <h4 className="flex items-center gap-2 text-sm font-bold"><CalendarDays size={17} aria-hidden />{isEnglish ? "Request program schedule" : "신청 가능한 프로그램 편성 안내"}</h4>
    <p className={`mt-2 ${radioNoteClass}`}>{isEnglish ? "Reference times in Korea (KST), not a live feed. Check the official page for schedule changes and regional differences." : "한국시간 기준 정규 편성 안내입니다. 실시간 편성표가 아니므로 특집·개편·지역 차이는 신청 당일 공식 페이지에서 확인하세요."}</p>
    <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
      {programs.map(program => {
        const plan = getRadioProgramPlan(program);
        return <li key={program.url} className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm">
          <div><p className="font-semibold">{program.name}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatRadioSchedule(plan, isEnglish)}</p>{plan && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{isEnglish ? "Checked" : "확인일"} {plan.verifiedAt}</p>}</div>
          <a href={plan?.schedule?.sourceUrl ?? program.url} className={`${radioButtonClass} px-2 text-xs`} target="_blank" rel="noopener noreferrer">{isEnglish ? "Official schedule" : "공식 편성 확인"}<ArrowUpRight size={13} aria-hidden /></a>
        </li>;
      })}
    </ul>
  </div>;
}

export function RadioProgramStrategy({ program, isEnglish = false }: { program: RadioProgramGuide; isEnglish?: boolean }) {
  const plan = getRadioProgramPlan(program);
  const locale = isEnglish ? "en" : "ko";
  return <section className={`${radioCardClass} space-y-4`} aria-label={isEnglish ? "Program participation strategy" : "프로그램별 참여 전략"} data-testid="radio-program-strategy">
    <div><h4 className="text-base font-bold">{isEnglish ? "Which route fits your goal?" : "어떤 경로로 내 곡을 전할까요?"}</h4>
      <p className={`mt-2 ${radioNoteClass}`}>{plan?.fit[locale] ?? (isEnglish ? "Check the latest program announcements and playlist. Ask through its official message board whether it accepts requests for your track." : "최근 프로그램 공지와 선곡표를 확인하고, 공식 메시지 게시판에서 내 곡의 신청을 받는지 먼저 확인하세요.")}</p>
      <p className="mt-2 text-xs font-semibold text-blue-700 dark:text-blue-300">{formatRadioSchedule(plan, isEnglish)}</p>
    </div>
    {plan?.routes.map(route => <article key={route.name.ko} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2"><h5 className="text-sm font-bold">{route.name[locale]}</h5><span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold dark:bg-slate-800">{route.when[locale]}</span><span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{route.kind === "request" ? (isEnglish ? "Song requests accepted" : "곡 신청 가능") : (isEnglish ? "Story submission · producer selects music" : "사연 참여 · 제작진 선곡")}</span></div>
      <p className={`mt-2 ${radioNoteClass}`}>{route.instructions[locale]}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{route.songPolicy[locale]}</p>
      <div className="mt-2 flex flex-wrap gap-2"><a href={route.url} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} px-2 text-xs`}>{isEnglish ? "Open participation page" : "참여 경로 열기"}<ArrowUpRight size={13} aria-hidden /></a><a href={route.sourceUrl} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} px-2 text-xs`}>{isEnglish ? "Official instructions" : "공식 안내 근거"}<ArrowUpRight size={13} aria-hidden /></a></div>
    </article>)}
    <div className="rounded-xl bg-blue-50 p-3 text-sm leading-6 dark:bg-blue-950/40">
      <p className="font-semibold">{isEnglish ? "Onside preparation tips" : "온사이드 준비 제안"}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {(isEnglish ? ["Listen to a recent show and review three recent playlists. Note a song or segment that connects to your music.", "Write one real experience, why this song fits it, and the exact artist and title. If you are the artist, say so naturally.", "Check the segment’s theme and deadline. Submit ahead of a recorded show; use live messages only when the program invites them.", "After the show, check its dated playlist. If your song is absent, revise the fit or story before another request and follow the board’s posting rules."] : ["최근 방송 한 회와 선곡표 3회를 확인하고 내 곡과 연결되는 분위기·코너를 메모하세요.", "실제 경험 한 가지 → 이 곡과 연결되는 이유 → 정확한 곡명·아티스트 순으로 작성하세요. 본인 곡이라면 그 사실도 자연스럽게 밝히세요.", "코너 주제·접수 기한을 확인하세요. 녹음 코너는 미리 보내고, 실시간 참여는 방송에서 안내하는 채널을 이용하세요.", "방송 뒤 날짜별 선곡표를 확인하세요. 곡이 없다면 분위기나 사연을 다듬고 게시판 규칙에 맞춰 다음 신청을 준비하세요."]).map(item => <li key={item}>{item}</li>)}
      </ol>
      <p className="mt-2 text-xs">{isEnglish ? "These are preparation suggestions, not broadcaster selection criteria. Your draft below is for the general song-request board." : "위 내용은 준비를 돕는 제안이며 방송국의 채택 기준은 아닙니다. 아래 초안은 일반 ‘사연과 신청곡’ 게시판용입니다."}</p>
    </div>
    {plan && <p className={radioNoteClass}>{isEnglish ? "Official schedule and segment instructions checked" : "공식 편성·코너 안내 확인"} {plan.verifiedAt} · {isEnglish ? "Check the latest announcements before submitting." : "등록 전 최신 공지를 확인해주세요."}</p>}
  </section>;
}

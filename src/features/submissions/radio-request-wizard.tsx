"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ExternalLink, FileText, Headphones, ListMusic, Music2, Radio, RotateCcw, Search } from "lucide-react";
import { broadcastArtist, broadcastTrackTitle, buildRadioRequest, type BroadcastReview, type BroadcastSubmission, type BroadcastTrack } from "@/lib/broadcast-support";
import { getRadioStationGuide } from "@/lib/radio-station-guide";
import type { RadioRequestDraft, RadioRequestProgress, RadioRequestSelection } from "@/lib/radio-request-workspace";
import { useRadioRequestWorkspace } from "./use-radio-request-workspace";
import { RadioDraftEditor, downloadRadioText, radioExternalUrl, radioButtonClass, radioCardClass, radioControlClass, radioNoteClass, radioPrimaryClass } from "./radio-request-ui";

export { radioButtonClass } from "./radio-request-ui";
export type RadioRequestCandidate = { review: BroadcastReview; tracks: { key: string; track: BroadcastTrack }[]; manual: boolean };

export function RadioRequestWizard({ submission, candidates, isEnglish = false }: { submission: BroadcastSubmission; candidates: RadioRequestCandidate[]; isEnglish?: boolean }) {
  const id = useId();
  const workspace = useRadioRequestWorkspace(submission.id);
  const { stationId, selections, manualNames, drafts, progress } = workspace;
  const [query, setQuery] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = candidates.find(item => item.review.id === stationId) ?? candidates[0];
  const selection = selections[selected.review.id] ?? {};
  const manual = manualNames[selected.review.id] ?? { title: "", artist: broadcastArtist(submission) };
  const selectedTrack = selected.tracks.find(item => item.key === selection.track) ?? selected.tracks.find(item => item.track.is_title) ?? selected.tracks[0];
  const needsArtist = !selected.manual && !(selectedTrack.track.performer || broadcastArtist(submission)).trim();
  const track: BroadcastTrack = selected.manual
    ? { track_title: manual.title.trim(), performer: manual.artist.trim() }
    : needsArtist ? { ...selectedTrack.track, performer: manual.artist.trim() } : selectedTrack.track;
  const trackName = selected.manual ? manual.title.trim() : broadcastTrackTitle(track);
  const artistName = track.performer || broadcastArtist(submission);
  const stationName = selected.review.station?.name || selected.review.station?.code || (isEnglish ? "Broadcaster" : "방송국");
  const guide = getRadioStationGuide({ stationCode: selected.review.station?.code, stationName: selected.review.station?.name });
  const locale = isEnglish ? "en" : "ko";
  const language = selection.language ?? (isEnglish || guide?.language === "en" ? "en" : "ko");
  const program = selection.program?.trim() ?? "";
  const selectedProgram = guide?.programs.find(item => item.name === program);
  const trackIdentity = selected.manual ? ["manual", manual.title.trim(), manual.artist.trim()] : [selectedTrack.key, needsArtist ? manual.artist.trim() : ""];
  const identity = JSON.stringify([submission.id, selected.review.id, trackIdentity, program]);
  const draftKey = JSON.stringify([identity, language]);
  const initial = (): RadioRequestDraft => ({ ...buildRadioRequest({ submission, track, program, isEnglish: language === "en" }), story: "", prompt: 0, titleCopied: false, bodyCopied: false });
  const draft = drafts[draftKey] ?? initial();
  const currentProgress = progress[identity] ?? {};
  const songReady = Boolean(trackName && artistName.trim());
  const draftReady = Boolean(draft.title.trim() && draft.body.trim());
  const needsTrackConfirmation = Boolean(!selected.manual && selection.track && !selected.tracks.some(item => item.key === selection.track));
  const lastAvailableStep = !songReady || needsTrackConfirmation ? 1 : !program ? 2 : !draftReady ? 3 : 4;
  const step = Math.min(workspace.step, lastAvailableStep);
  const previousStep = useRef(step);
  const canContinue = step === 1 ? songReady : step === 2 ? Boolean(program) : draftReady;
  const listeningUrl = radioExternalUrl(draft.listeningUrl);
  const postUrl = radioExternalUrl(currentProgress.postUrl);
  const postedAt = currentProgress.postedAt
    ? new Intl.DateTimeFormat(isEnglish ? "en" : "ko", { dateStyle: "medium", timeStyle: "short" }).format(new Date(currentProgress.postedAt))
    : "";
  const filteredPrograms = (guide?.programs ?? []).filter(item => `${item.name} ${item.description[locale]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const stepLabels = isEnglish ? ["Your song", "Program", "Your story", "Submit & track"] : ["내 곡 확인", "프로그램", "신청글 작성", "신청·확인"];
  const titles = isEnglish
    ? ["Which song would you like to share?", "Choose the program for your song", "Make the request sound like you", "Send your music, then keep the link"]
    : ["방송에서 듣고 싶은 내 곡을 골라주세요", "내 음악을 전할 프로그램을 선택하세요", "내 곡의 이야기가 담긴 신청글을 만드세요", "방송국에 신청하고, 내 게시글을 남겨두세요"];
  const descriptions = isEnglish
    ? ["Only songs approved by the selected broadcaster are available.", "Read the introduction and recent playlist before choosing.", "Use the writing help, then check the final request.", "Sign in on the official site and post the request yourself."]
    : ["선택한 방송국에서 적격을 받은 곡을 확인합니다.", "프로그램 소개와 최근 선곡표를 보고 어울리는 곳을 골라보세요.", "작성 도움에서 사연을 더하고, 최종 신청글을 확인하세요.", "공식 사이트에 로그인한 뒤 직접 등록하면 됩니다."];
  const storyPrompts = isEnglish
    ? ["What inspired this song?", "When would you like listeners to hear it?", "How would you describe this song’s mood?"]
    : ["이 곡을 만들게 된 이야기는?", "어떤 순간에 함께 듣고 싶나요?", "내 곡의 분위기를 어떻게 소개하고 싶나요?"];

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const modal = document.querySelector("dialog[open]");
    if (rootRef.current?.closest("dialog")?.open === false || (modal && !modal.contains(rootRef.current))) return;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [step]);

  function updateSelection(update: Partial<RadioRequestSelection>) {
    workspace.setSelections(previous => ({ ...previous, [selected.review.id]: { ...previous[selected.review.id], ...update } }));
  }
  function activateContext() {
    if (stationId !== selected.review.id) workspace.setStationId(selected.review.id);
    if (!selected.manual && !selection.track) updateSelection({ track: selectedTrack.key });
  }
  function continueToNextStep() {
    if (step === 1 && !selected.manual) updateSelection({ track: selectedTrack.key });
    workspace.setStep(step + 1);
  }
  function updateDraft(update: (value: RadioRequestDraft) => RadioRequestDraft) {
    workspace.setDrafts(previous => ({ ...previous, [draftKey]: update(previous[draftKey] ?? initial()) }));
  }
  function updateProgress(update: Partial<RadioRequestProgress>) {
    workspace.setProgress(previous => ({ ...previous, [identity]: { ...previous[identity], ...update } }));
  }
  function downloadRequest() {
    downloadRadioText([
      isEnglish ? "Onside · My radio request" : "온사이드 · 나의 라디오 신청",
      `${artistName} · ${trackName}`, `${stationName} · ${program}`, "",
      draft.title, "", draft.body, "",
      selectedProgram?.messageUrl ?? guide?.directoryUrl ?? "",
      currentProgress.posted ? `${isEnglish ? "Posted (marked by you)" : "신청 완료 (직접 표시)"}${postedAt ? ` · ${postedAt}` : ""}` : "",
      postUrl ?? "", currentProgress.memo ?? "",
    ].join("\n"));
  }

  return (
    <div ref={rootRef} className="min-w-0 space-y-5" data-testid="radio-request-wizard" data-no-translate
      onFocusCapture={activateContext} onPointerDownCapture={activateContext}>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#12243b] p-4 text-white sm:px-5" data-testid="radio-song-context">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-blue-200"><Music2 size={21} aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-blue-200">{isEnglish ? "YOUR MUSIC, ON AIR" : "나의 음악만을 위한 방송 신청 가이드"}</p>
          <p className="mt-1 text-base font-bold leading-6">{trackName || (isEnglish ? "Choose your song" : "신청할 곡을 선택해주세요")}</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-300">{artistName || (isEnglish ? "Artist not entered" : "아티스트 입력 필요")}{submission.title ? ` · ${submission.title}` : ""}</p>
        </div>
        <div className="flex w-full max-w-full flex-wrap gap-1.5 text-[11px] font-semibold sm:w-auto">
          <span className="rounded-lg bg-white/10 px-2.5 py-1.5">{stationName}</span>
          <span className={`rounded-lg px-2.5 py-1.5 ${selected.manual ? "bg-amber-300/15 text-amber-200" : "bg-emerald-300/15 text-emerald-200"}`}>{selected.manual ? (isEnglish ? "Track approval unverified" : "곡별 적격 여부 미확인") : (isEnglish ? "Approved track" : "적격 곡")}</span>
        </div>
      </div>
      <nav aria-label={isEnglish ? "Request steps" : "방송 신청 단계"}>
        <ol className="grid grid-cols-4 gap-1.5 sm:gap-2">
          {stepLabels.map((label, index) => {
            const number = index + 1;
            return <li key={label} className="min-w-0">
              <button type="button" aria-current={step === number ? "step" : undefined} disabled={number > lastAvailableStep}
                aria-label={isEnglish ? `Step ${number}: ${label}` : `${number}단계: ${label}`}
                onClick={() => workspace.setStep(number)}
                className={`flex min-h-[76px] w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-2 text-center text-[11px] font-semibold leading-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:text-xs ${step === number ? "border-blue-700 bg-blue-700 text-white shadow-sm dark:border-blue-500 dark:bg-blue-600" : "border-slate-200 bg-slate-50 text-slate-600 enabled:hover:border-blue-400 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>
                <span className={`flex size-6 items-center justify-center rounded-full text-xs ${step === number ? "bg-white/20" : "bg-slate-200/70 dark:bg-slate-700"}`}>{number < step ? <Check size={14} aria-hidden /> : number}</span>
                <span className="[word-break:keep-all]">{label}</span>
              </button>
            </li>;
          })}
        </ol>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        <p data-testid="radio-storage-status">{workspace.storageStatus === "unavailable"
          ? (isEnglish ? "Tab saving unavailable. Download text before refreshing." : "탭 저장을 사용할 수 없습니다. 새로고침 전 TXT로 저장해주세요.")
          : workspace.storageStatus === "restored"
            ? (isEnglish ? "Your saved work is restored · kept in this tab" : "작성하던 내용을 불러왔어요 · 이 탭에 자동 저장")
            : (isEnglish ? "Auto-saved in this tab · continue after refresh" : "이 탭에 자동 저장 · 새로고침해도 이어서 작성")}</p>
        <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-slate-500 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-400" onClick={() => setResetOpen(!resetOpen)}><RotateCcw size={12} aria-hidden />{isEnglish ? "Reset saved work" : "저장 내용 초기화"}</button>
      </div>
      {resetOpen && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <p>{isEnglish ? "Clear this album’s drafts and checklist from this tab? Download any text you want to keep first." : "이 탭에 저장된 이 음반의 초안과 체크를 지울까요? 필요한 신청글은 먼저 TXT로 저장해주세요."}</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={radioButtonClass} onClick={() => { workspace.resetWorkspace(); setResetOpen(false); }}>{isEnglish ? "Clear this album’s saved work" : "이 음반의 저장 내용 지우기"}</button><button type="button" className={radioButtonClass} onClick={() => setResetOpen(false)}>{isEnglish ? "Keep writing" : "계속 작성"}</button></div>
      </div>}
      <div data-testid={`radio-step-${step}`} className="min-w-0 space-y-5">
        <div>
          <p className="mb-1.5 text-xs font-bold tracking-wide text-blue-700 dark:text-blue-300">{isEnglish ? `STEP ${step} / 4` : `${step} / 4 단계`}</p>
          <h3 ref={headingRef} tabIndex={-1} className="scroll-mt-4 text-lg font-bold leading-snug text-slate-950 focus:outline-none sm:text-xl dark:text-white">{titles[step - 1]}</h3>
          <p className={`mt-2 ${radioNoteClass}`}>{descriptions[step - 1]}</p>
        </div>
        {step === 1 && <div className={`${radioCardClass} space-y-5`}>
          {needsTrackConfirmation && <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">{isEnglish ? "Your previously selected song is no longer in this broadcaster’s approved list. Confirm an available song to continue." : "이전에 선택한 곡이 현재 적격 목록에서 빠졌어요. 신청할 곡을 다시 확인한 뒤 진행해주세요."}</p>}
          {candidates.length > 1 && <div><label htmlFor={`${id}-station`} className="mb-2 block text-sm font-bold">{isEnglish ? "Approved broadcaster" : "적격 방송국"}</label>
            <select id={`${id}-station`} value={selected.review.id} className={radioControlClass} onChange={event => { workspace.setStationId(event.target.value); setQuery(""); }}>
              {candidates.map(item => <option key={item.review.id} value={item.review.id}>{item.review.station?.name || item.review.station?.code || (isEnglish ? "Broadcaster" : "방송국")}</option>)}
            </select>
          </div>}
          {selected.manual ? <>
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">{isEnglish ? "The broadcaster’s approval is recorded, but individual song details are missing. Enter a song from this album and check its actual approval before posting. Your review record will not change." : "방송국의 적격 기록은 있지만 개별 곡 정보가 없습니다. 이 음반의 곡을 입력하고 신청 전 실제 적격 여부를 확인해주세요. 심의 기록은 변경되지 않습니다."}</p>
            <div><label htmlFor={`${id}-manual-title`} className="mb-2 block text-sm font-bold">{isEnglish ? "Song title (required)" : "신청할 곡명 (필수)"}</label><input id={`${id}-manual-title`} className={radioControlClass} value={manual.title} maxLength={200} onChange={event => { const title = event.target.value; workspace.setManualNames(previous => ({ ...previous, [selected.review.id]: { ...manual, title } })); }} /></div>
          </> : <div>
            <label htmlFor={`${id}-track`} className="mb-2 block text-sm font-bold">{isEnglish ? "Approved track" : "신청할 적격 곡"}</label>
            <select id={`${id}-track`} className={radioControlClass} value={selectedTrack.key} onChange={event => updateSelection({ track: event.target.value })}>{selected.tracks.map(item => <option key={item.key} value={item.key}>{broadcastTrackTitle(item.track)}</option>)}</select>
            <p className={`mt-2 ${radioNoteClass}`}>{isEnglish ? `${selected.tracks.length} approved song(s) at ${stationName}.` : `${stationName}에서 적격을 받은 ${selected.tracks.length}곡 중 선택할 수 있어요.`}</p>
          </div>}
          {(selected.manual || needsArtist) && <div><label htmlFor={`${id}-artist`} className="mb-2 block text-sm font-bold">{isEnglish ? "Artist name (required)" : "아티스트명 (필수)"}</label><input id={`${id}-artist`} className={radioControlClass} value={manual.artist} maxLength={200} onChange={event => { const artist = event.target.value; workspace.setManualNames(previous => ({ ...previous, [selected.review.id]: { ...manual, artist } })); }} /></div>}
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5"><Headphones size={14} aria-hidden />{submission.genre || (isEnglish ? "Your registered music" : "내가 등록한 음악")}</span>
            {submission.release_date && <span>· {isEnglish ? "Released" : "발매"} {submission.release_date}</span>}
          </div>
        </div>}
        {step === 2 && <>
          {Boolean(guide?.programs.length) && <>
            <div><label htmlFor={`${id}-search`} className="mb-2 flex items-center gap-2 text-sm font-bold"><Search size={16} aria-hidden />{isEnglish ? "Find a program" : "프로그램 검색"}</label><input id={`${id}-search`} type="search" className={radioControlClass} value={query} onChange={event => setQuery(event.target.value)} placeholder={isEnglish ? "Program name or introduction" : "프로그램명 또는 소개로 검색"} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {filteredPrograms.map(item => <article key={item.name} className={`flex min-w-0 flex-col rounded-2xl border-2 p-4 ${program === item.name ? "border-blue-600 bg-blue-50/50 dark:border-blue-400 dark:bg-blue-950/30" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"}`}>
                <div className="mb-2 flex flex-wrap gap-1.5 text-[10px] font-semibold"><span className="rounded bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{stationName}</span><span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{isEnglish ? "Official request board" : "공식 신청 게시판"}</span></div>
                <h4 className="text-base font-bold">{item.name}</h4>
                <p className={`mt-2 flex-1 ${radioNoteClass}`}>{item.description[locale]}</p>
                <div className="mt-3 flex flex-wrap gap-2"><a href={item.url} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} px-2 text-xs`}>{isEnglish ? "Program info" : "프로그램 소개"}<ArrowUpRight size={13} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a><a href={item.playlistUrl} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} px-2 text-xs`}>{isEnglish ? "Recent playlist" : "최근 선곡표"}<ArrowUpRight size={13} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a></div>
                <button type="button" aria-pressed={program === item.name} onClick={() => updateSelection({ program: item.name })} className={`${program === item.name ? radioPrimaryClass : radioButtonClass} mt-3 w-full`}>{program === item.name && <Check size={15} aria-hidden />}{isEnglish ? `Choose ${item.name}` : `${item.name} 선택`}</button>
              </article>)}
            </div>
            {!filteredPrograms.length && <p className="rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-900">{isEnglish ? "No matching program. Try another word or enter a program below." : "검색 결과가 없습니다. 검색어를 바꾸거나 아래에서 프로그램을 직접 입력해주세요."}</p>}
          </>}
          <div className={`${radioCardClass} space-y-3`}>
            <h4 className="flex items-center gap-2 text-sm font-bold"><Radio size={16} aria-hidden />{isEnglish ? "Choose another program" : "다른 프로그램에 신청하고 싶다면"}</h4>
            {guide ? <a href={guide.directoryUrl} target="_blank" rel="noopener noreferrer" className={radioButtonClass}>{isEnglish ? `All programs at ${guide.name}` : `${guide.name} · 전체 프로그램`}<ArrowUpRight size={15} aria-hidden /></a> : <p className={radioNoteClass}>{isEnglish ? "A public request board has not been verified for this broadcaster. Confirm the participation route with the broadcaster first." : "이 방송국의 공개 신청곡 게시판은 확인되지 않았습니다. 방송국에 참여 경로를 먼저 확인해주세요."}</p>}
            <div><label htmlFor={`${id}-program`} className="mb-2 block text-sm font-semibold">{guide?.programs.length ? (isEnglish ? "Selected program or another program name" : "선택한 프로그램 또는 다른 프로그램명") : (isEnglish ? "Program name you checked (required)" : "직접 확인한 프로그램명 (필수)")}</label><input id={`${id}-program`} className={radioControlClass} value={selection.program ?? ""} maxLength={120} onChange={event => updateSelection({ program: event.target.value })} placeholder={isEnglish ? "Enter the exact program name" : "프로그램 이름을 정확히 입력해주세요"} /></div>
          </div>
          {program && <p className="flex items-start gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200"><CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden /><span>{isEnglish ? "Selected: " : "선택한 프로그램: "}{program}<span className={`mt-1 block font-normal ${radioNoteClass}`}>{selectedProgram ? (isEnglish ? "We will link you directly to its official board." : "신청 단계에서 공식 게시판으로 바로 연결합니다.") : (isEnglish ? "Use the official directory to find this program’s board." : "직접 입력한 프로그램은 공식 목록에서 게시판을 찾아주세요.")}</span></span></p>}
        </>}
        {step === 3 && <>
          <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200">{stationName} <span className="mx-1 text-blue-400">/</span> {program}</p>
          <div className="min-w-0 space-y-4">
            <details className={`${radioCardClass} group bg-slate-50/70 dark:bg-slate-900/50`} data-testid="radio-writing-help">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-bold text-blue-700 dark:text-blue-300">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">{isEnglish ? "Add my story or listening link" : "내 이야기·음원 링크 더하기"}<span className={`font-normal ${radioNoteClass}`}>{isEnglish ? "Optional" : "선택사항"}</span></span>
                <ChevronDown size={18} className="shrink-0 transition group-open:rotate-180" aria-hidden />
              </summary>
              <div className="mt-4 grid min-w-0 gap-5 border-t border-slate-200 pt-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] dark:border-slate-700">
              <div className="min-w-0">
                <label htmlFor={`${id}-story`} className="block text-sm font-semibold">{isEnglish ? "Add your song’s story (optional)" : "내 곡만의 이야기를 더해보세요 (선택)"}</label>
                <p className={`mt-1 ${radioNoteClass}`}>{isEnglish ? `Why should ${program} listeners hear “${trackName}”? Two or three sentences are enough.` : `${program} 청취자들과 ‘${trackName}’을 함께 듣고 싶은 이유를 2~3문장으로 적어주세요.`}</p>
                <div className="my-3 flex flex-wrap gap-1.5">{storyPrompts.map((prompt, index) => <button key={prompt} type="button" aria-pressed={draft.prompt === index} onClick={() => updateDraft(current => ({ ...current, prompt: index }))} className={`${radioButtonClass} px-2 text-xs ${draft.prompt === index ? "border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200" : ""}`}>{isEnglish ? ["Inspiration", "Listening moment", "Song mood"][index] : ["만든 이야기", "듣기 좋은 순간", "곡의 분위기"][index]}</button>)}</div>
                <textarea id={`${id}-story`} value={draft.story} rows={4} maxLength={1000} placeholder={storyPrompts[draft.prompt]} className={`${radioControlClass} resize-y`} onChange={event => { const story = event.target.value; updateDraft(current => ({ ...current, story })); }} />
                {draft.story.trim() && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">{isEnglish ? "Not yet added to your final request." : "아직 최종 신청글에 반영되지 않았어요."}</p>}
                <button type="button" disabled={!draft.story.trim() || draft.body.length + draft.story.trim().length + 2 > 5000} className={`${radioButtonClass} mt-2 w-full`} onClick={() => updateDraft(current => ({ ...current, body: `${current.body.trimEnd()}\n\n${current.story.trim()}`, story: "", bodyCopied: false }))}>{isEnglish ? "Add my story to the request" : "신청 문구에 이야기 추가"}<ArrowRight size={15} aria-hidden /></button>
              </div>
              <div className="min-w-0 space-y-5 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 dark:border-slate-700">
                <div><label htmlFor={`${id}-language`} className="mb-2 block text-sm font-semibold">{isEnglish ? "Draft language" : "신청 문구 언어"}</label><select id={`${id}-language`} className={radioControlClass} value={language} onChange={event => updateSelection({ language: event.target.value as "ko" | "en" })}><option value="ko">한국어</option><option value="en">English</option></select></div>
                <div>
                <label htmlFor={`${id}-listening`} className="mb-2 block text-sm font-semibold">{isEnglish ? "Public listening link (optional)" : "공개 음원 링크 (선택)"}</label>
                <input id={`${id}-listening`} type="url" inputMode="url" className={radioControlClass} value={draft.listeningUrl ?? ""} maxLength={2000} placeholder="https://" aria-invalid={Boolean(draft.listeningUrl && !listeningUrl)} onChange={event => { const listeningUrl = event.target.value; updateDraft(current => ({ ...current, listeningUrl })); }} />
                <p className={`mt-1 ${radioNoteClass}`}>{draft.listeningUrl && !listeningUrl ? (isEnglish ? "Enter a valid https:// link." : "https://로 시작하는 올바른 링크를 입력해주세요.") : (isEnglish ? "Use a public streaming link and follow the board’s link policy." : "공개 스트리밍 링크를 사용하고 게시판의 링크 첨부 규칙을 확인해주세요.")}</p>
                <button type="button" className={`${radioButtonClass} mt-2 w-full`} disabled={!listeningUrl || draft.body.includes(listeningUrl) || draft.body.length + listeningUrl.length + 20 > 5000} onClick={() => updateDraft(current => ({ ...current, body: `${current.body.trimEnd()}\n\n${language === "en" ? "Listen" : "음원 듣기"}: ${listeningUrl}`, bodyCopied: false }))}>{isEnglish ? "Add link to request" : "신청글에 링크 추가"}</button>
                </div>
              </div>
              </div>
            </details>
            <RadioDraftEditor key={draftKey} draft={draft} updateDraft={updateDraft} isEnglish={isEnglish} onDownload={downloadRequest} />
          </div>
        </>}
        {step === 4 && <>
          <div className="min-w-0 space-y-4">
            <div className={`${radioCardClass} grid gap-5 lg:grid-cols-2`} data-testid="radio-official-handoff">
              <div className="min-w-0 space-y-4">
                <div><p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">{stationName}</p><h4 className="mt-1 text-lg font-bold">{program}</h4><p className={`mt-1 ${radioNoteClass}`}>{artistName} · {trackName}</p></div>
                {guide ? <>
                  <a href={selectedProgram?.messageUrl ?? guide.directoryUrl} target="_blank" rel="noopener noreferrer" className={`${radioPrimaryClass} w-full`}>{selectedProgram ? (isEnglish ? `Open ${program} request board` : `${program} 신청 게시판 열기`) : (isEnglish ? `Find ${program} on the official site` : `공식 사이트에서 ${program} 찾기`)}<ExternalLink size={16} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>
                  {!selectedProgram && <p className={radioNoteClass}>{isEnglish ? "Find your program’s board in the official directory." : "공식 프로그램 목록에서 입력한 프로그램의 게시판을 찾아주세요."}</p>}
                </> : <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">{isEnglish ? "No official board link has been verified. Use the route you confirmed with this broadcaster." : "확인된 공식 게시판 링크가 없습니다. 방송국에 직접 확인한 경로를 이용해주세요."}</p>}
              </div>
              <ol className="space-y-3 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 dark:border-slate-700">
                {(isEnglish ? ["Open the official site and sign in.", selectedProgram ? "Read the board notice and start a new post." : "Find this program’s listener / song-request board.", "Paste your title and body, check the details, then submit."] : ["공식 사이트를 열고 방송국 계정으로 로그인", selectedProgram ? "게시판 공지를 확인하고 글쓰기 선택" : "프로그램의 ‘사연과 신청곡’ 또는 참여 게시판 찾기", "제목·본문 붙여넣기 → 내용 확인 → 직접 등록"]).map((text, index) => <li key={text} className="flex gap-2.5 text-sm leading-6"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-200">{index + 1}</span><span>{text}</span></li>)}
              </ol>
            </div>
            <details className={`${radioCardClass} group`} data-testid="radio-prepared-request">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold"><span className="flex items-center gap-2"><FileText size={16} className="shrink-0 text-blue-700 dark:text-blue-300" aria-hidden />{isEnglish ? "Copy my prepared title and request" : "준비한 제목·본문 다시 복사하기"}</span><ChevronDown size={16} className="shrink-0 transition group-open:rotate-180" aria-hidden /></summary>
              <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700"><RadioDraftEditor key={draftKey} draft={draft} updateDraft={updateDraft} isEnglish={isEnglish} onDownload={downloadRequest} readOnly /></div>
            </details>
            <div className={`${radioCardClass} space-y-4 ${currentProgress.posted ? "border-emerald-300 dark:border-emerald-800" : ""}`} data-testid="radio-posting-record">
              <div className="flex items-start gap-2.5"><CheckCircle2 size={22} className={currentProgress.posted ? "shrink-0 text-emerald-600" : "shrink-0 text-slate-400"} aria-hidden /><div><h4 className="text-base font-bold">{currentProgress.posted ? (isEnglish ? "Marked as posted" : "신청 완료로 표시했어요") : (isEnglish ? "My posting checklist" : "나의 신청 체크리스트")}</h4><p className={`mt-1 ${radioNoteClass}`}>{isEnglish ? "Your own record, separate from broadcaster confirmation." : "방송국 접수 확인과 별도로, 내가 직접 남기는 기록이에요."}</p>{currentProgress.posted && postedAt && <p className={`mt-1 ${radioNoteClass}`}>{isEnglish ? "Marked on " : "직접 표시한 시각: "}{postedAt}</p>}</div></div>
              <div className="grid min-w-0 gap-5 lg:grid-cols-2">
              <fieldset className="min-w-0 space-y-1"><legend className="sr-only">{isEnglish ? "Posting checks" : "신청 확인 항목"}</legend>{([
                ["rules", isEnglish ? "I read the program’s posting rules" : "프로그램 게시판 공지를 확인했어요"],
                ["privacy", isEnglish ? "I checked my text and personal information" : "신청 문구와 개인정보를 확인했어요"],
                ["posted", isEnglish ? "I posted the request on the broadcaster’s site" : "방송국에서 직접 신청글을 등록했어요"],
                ["playlist", isEnglish ? "I checked my post and the program playlist" : "내 게시글과 프로그램 선곡표를 확인했어요"],
              ] as const).map(([key, label]) => <label key={key} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-sm leading-6 hover:bg-slate-50 dark:hover:bg-slate-900"><input type="checkbox" checked={Boolean(currentProgress[key])} onChange={event => updateProgress({ [key]: event.target.checked, ...(key === "posted" ? { postedAt: event.target.checked ? new Date().toISOString() : undefined } : {}) })} className="mt-1 size-4 shrink-0 accent-blue-700" /><span>{label}</span></label>)}</fieldset>
              <div className="min-w-0 space-y-4 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 dark:border-slate-700">
              <div><label htmlFor={`${id}-post-url`} className="mb-2 block text-sm font-semibold">{isEnglish ? "My posted message link (optional)" : "내 신청 게시글 주소 (선택)"}</label><input id={`${id}-post-url`} type="url" inputMode="url" className={radioControlClass} value={currentProgress.postUrl ?? ""} maxLength={2000} placeholder="https://" aria-invalid={Boolean(currentProgress.postUrl && !postUrl)} onChange={event => updateProgress({ postUrl: event.target.value })} />
                {currentProgress.postUrl && !postUrl && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{isEnglish ? "Enter a valid https:// link." : "https://로 시작하는 올바른 링크를 입력해주세요."}</p>}
                {postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} mt-2`}>{isEnglish ? "Open my post" : "내 게시글 열기"}<ArrowUpRight size={15} aria-hidden /></a>}
              </div>
              <div><label htmlFor={`${id}-memo`} className="mb-2 block text-sm font-semibold">{isEnglish ? "Follow-up note (optional)" : "다음 확인을 위한 메모 (선택)"}</label><textarea id={`${id}-memo`} className={`${radioControlClass} resize-y`} rows={2} maxLength={1000} value={currentProgress.memo ?? ""} placeholder={isEnglish ? "Date posted, reply, playlist to check…" : "신청 날짜, 답변, 확인할 선곡표 등"} onChange={event => updateProgress({ memo: event.target.value })} /></div>
              </div>
              </div>
              <div className="grid gap-2 border-t border-slate-200 pt-4 sm:flex sm:[&>*]:flex-1 dark:border-slate-700">
              {selectedProgram && <a href={selectedProgram.playlistUrl} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} w-full`}><ListMusic size={15} aria-hidden />{isEnglish ? `${program} playlist` : `${program} 선곡표 확인`}<ArrowUpRight size={15} aria-hidden /></a>}
              {!selectedProgram && guide?.participationLink && <a href={guide.participationLink.url} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} w-full`}>{isEnglish ? `Live participation: ${guide.participationLink.name}` : `${guide.participationLink.name} 실시간 참여 안내`}<ArrowUpRight size={15} aria-hidden /></a>}
              <button type="button" onClick={downloadRequest} className={`${radioButtonClass} w-full`}><FileText size={15} aria-hidden />{isEnglish ? "Save request & notes as TXT" : "신청글과 기록 TXT 저장"}</button>
              </div>
            </div>
          </div>
        </>}
      </div>
      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900" data-testid="radio-navigation-actions">
        {step > 1 && <button type="button" className={radioButtonClass} onClick={() => workspace.setStep(step - 1)}><ArrowLeft size={15} aria-hidden />{isEnglish ? "Previous" : "이전"}</button>}
        {step < 4 && <button type="button" className={`${radioPrimaryClass} flex-1`} disabled={!canContinue} onClick={continueToNextStep}>{isEnglish ? ["Choose a program", "Prepare request", "Posting guide"][step - 1] : ["이 곡으로 프로그램 고르기", "이 프로그램으로 초안 만들기", "신청 방법 보기"][step - 1]}<ArrowRight size={15} aria-hidden /></button>}
        {step === 4 && <button type="button" className={`${radioButtonClass} flex-1`} onClick={() => workspace.setStep(1)}>{isEnglish ? "Prepare another request" : "다른 신청 준비하기"}<ArrowRight size={15} aria-hidden /></button>}
      </div>
      <p className={radioNoteClass}>{isEnglish ? "This guide is free. The program decides what airs. Work is kept in this tab; download a TXT copy to keep it after closing the tab." : "무료 신청 가이드이며, 실제 방송 선곡은 프로그램이 결정합니다. 초안은 이 탭에 보관되니 탭을 닫기 전 TXT로 저장해두세요."}</p>
    </div>
  );
}

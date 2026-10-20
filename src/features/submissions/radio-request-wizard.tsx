"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, ListMusic, Music2 } from "lucide-react";
import { broadcastArtist, broadcastTrackTitle, buildRadioRequest, type BroadcastReview, type BroadcastSubmission, type BroadcastTrack } from "@/lib/broadcast-support";
import { getRadioStationGuide } from "@/lib/radio-station-guide";

export const radioControlClass = "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base leading-6 text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:ring-blue-400 sm:text-sm";
const actionClass = "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-center text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-slate-950 [&>svg]:shrink-0";
export const radioButtonClass = `${actionClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800`;
const primaryClass = `${actionClass} border-[#1556a4] bg-[#1556a4] text-white hover:bg-[#104581] dark:border-blue-500 dark:bg-blue-600 dark:text-white dark:hover:bg-blue-500`;
const noteClass = "text-xs leading-5 text-slate-500 dark:text-slate-400";

export type RadioRequestCandidate = { review: BroadcastReview; tracks: { key: string; track: BroadcastTrack }[]; manual: boolean };
type Draft = { title: string; body: string; story: string; prompt: number; titleCopied: boolean; bodyCopied: boolean };
type DraftUpdate = (draft: Draft) => Draft;
type Progress = { rules?: boolean; privacy?: boolean; posted?: boolean; playlist?: boolean };
type Selection = { track?: string; program?: string; language?: "ko" | "en" };

function CopyableDraft({ draft, updateDraft, isEnglish, editor = false }: { draft: Draft; updateDraft: (update: DraftUpdate) => void; isEnglish: boolean; editor?: boolean }) {
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState({ text: "", snapshot: "" });
  const snapshot = JSON.stringify([draft.title, draft.body]);
  async function copy(kind: "title" | "body") {
    const copied = draft[kind];
    try {
      await navigator.clipboard.writeText(copied);
      updateDraft(current => current[kind] === copied ? { ...current, [kind === "title" ? "titleCopied" : "bodyCopied"]: true } : current);
      setMessage({ text: isEnglish ? "Copied. Paste it on the broadcaster’s board." : "복사했습니다. 방송국 게시판에 붙여넣으세요.", snapshot });
    } catch {
      const field = kind === "title" ? titleRef.current : bodyRef.current;
      field?.focus(); field?.select();
      setMessage({ text: isEnglish ? "Copy the selected text manually." : "선택한 문구를 직접 복사해주세요.", snapshot });
    }
  }
  return <div className="space-y-4">
    <div>
      <label htmlFor={`${id}-title`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Post title" : "게시글 제목"}</label>
      <input ref={titleRef} id={`${id}-title`} className={radioControlClass} value={draft.title} readOnly={!editor} maxLength={300} onChange={event => { const title = event.target.value; updateDraft(current => ({ ...current, title, titleCopied: false })); }} />
      <button type="button" className={`${radioButtonClass} mt-2`} disabled={!draft.title.trim()} onClick={() => void copy("title")}>{draft.titleCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{isEnglish ? "Copy title" : "제목 복사"}<span className="sr-only">{draft.titleCopied ? (isEnglish ? " — copied" : " · 복사 완료") : ""}</span></button>
    </div>
    <div>
      <label htmlFor={`${id}-body`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Your story and song request" : "사연과 신청곡 문구"}</label>
      <textarea ref={bodyRef} id={`${id}-body`} className={`${radioControlClass} resize-y`} value={draft.body} readOnly={!editor} rows={editor ? 7 : 4} maxLength={5000} onChange={event => { const body = event.target.value; updateDraft(current => ({ ...current, body, bodyCopied: false })); }} />
      <button type="button" className={`${primaryClass} mt-2`} disabled={!draft.body.trim()} onClick={() => void copy("body")}>{draft.bodyCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{isEnglish ? "Copy request" : "본문 복사"}<span className="sr-only">{draft.bodyCopied ? (isEnglish ? " — copied" : " · 복사 완료") : ""}</span></button>
    </div>
    <p role="status" className={noteClass}>{(message.snapshot === snapshot && message.text) || (isEnglish ? "Copy and paste each field separately. Only the latest copied text stays on your clipboard." : "제목과 본문을 하나씩 복사해 붙여넣으세요. 마지막에 복사한 문구만 클립보드에 남습니다.")}</p>
  </div>;
}

export function RadioRequestWizard({ submission, candidates, isEnglish = false }: { submission: BroadcastSubmission; candidates: RadioRequestCandidate[]; isEnglish?: boolean }) {
  const id = useId();
  const [stationId, setStationId] = useState("");
  const [step, setStep] = useState(1);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [manualNames, setManualNames] = useState<Record<string, { title: string; artist: string }>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  const selected = candidates.find(item => item.review.id === stationId) ?? candidates[0];
  const selection = selections[selected.review.id] ?? {};
  const manual = manualNames[selected.review.id] ?? { title: "", artist: broadcastArtist(submission) };
  const selectedTrack = selected.tracks.find(item => item.key === selection.track) ?? selected.tracks.find(item => item.track.is_title) ?? selected.tracks[0];
  const needsArtist = !selected.manual && !(selectedTrack.track.performer || broadcastArtist(submission)).trim();
  const track: BroadcastTrack = selected.manual ? { track_title: manual.title.trim(), performer: manual.artist.trim() } : needsArtist ? { ...selectedTrack.track, performer: manual.artist.trim() } : selectedTrack.track;
  const trackName = selected.manual ? manual.title.trim() : broadcastTrackTitle(track);
  const artistName = track.performer || broadcastArtist(submission);
  const stationName = selected.review.station?.name || selected.review.station?.code || (isEnglish ? "Broadcaster" : "방송국");
  const guide = getRadioStationGuide({ stationCode: selected.review.station?.code, stationName: selected.review.station?.name });
  const locale = isEnglish ? "en" : "ko";
  const language = selection.language ?? (isEnglish || guide?.language === "en" ? "en" : "ko");
  const program = selection.program?.trim() ?? "";
  const selectedProgram = guide?.programs.find(item => item.name === program);
  // Every destination, song and language gets its own draft. Changing a program
  // never carries an edited greeting or a copied/posted flag into another one.
  const trackIdentity = selected.manual ? ["manual", manual.title.trim(), manual.artist.trim()] : [selectedTrack.key, needsArtist ? manual.artist.trim() : ""];
  const identity = JSON.stringify([submission.id, selected.review.id, trackIdentity, program]);
  const draftKey = JSON.stringify([identity, language]);
  const initial = (): Draft => ({ ...buildRadioRequest({ submission, track, program, isEnglish: language === "en" }), story: "", prompt: 0, titleCopied: false, bodyCopied: false });
  const draft = drafts[draftKey] ?? initial();
  const currentProgress = progress[identity] ?? {};
  const canContinue = step === 1 ? Boolean(trackName && artistName.trim()) : step === 2 ? Boolean(program) : Boolean(draft.title.trim() && draft.body.trim());
  const steps = isEnglish ? ["Your song", "Program", "Your story", "Submit yourself"] : ["내 곡 확인", "프로그램 선택", "사연 작성", "직접 신청"];
  const titles = isEnglish ? ["Confirm the song you want to share", "Choose a home for your song", "Tell the story of your song", "Post on the broadcaster’s official board"] : ["방송에서 듣고 싶은 내 곡을 확인하세요", "내 곡을 전할 프로그램을 골라보세요", "내 곡의 이야기를 담아 문구를 준비하세요", "방송국 공식 게시판에서 직접 신청하세요"];
  const storyPrompts = isEnglish ? ["What inspired this song?", "When would you like listeners to hear it?", "How would you describe the mood of this song?"] : ["이 곡을 만들게 된 이야기는?", "어떤 순간에 함께 듣고 싶나요?", "내 곡의 분위기를 어떻게 소개하고 싶나요?"];
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [step]);
  function updateSelection(update: Partial<Selection>) { setSelections(previous => ({ ...previous, [selected.review.id]: { ...previous[selected.review.id], ...update } })); }
  function updateDraft(update: DraftUpdate) { setDrafts(previous => ({ ...previous, [draftKey]: update(previous[draftKey] ?? initial()) })); }
  function updateProgress(key: keyof Progress, value: boolean) { setProgress(previous => ({ ...previous, [identity]: { ...previous[identity], [key]: value } })); }

  return <div className="min-w-0 space-y-5" data-testid="radio-request-wizard" data-no-translate>
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30" data-testid="radio-song-context">
      <p className="text-xs font-semibold text-[#1556a4] dark:text-blue-300">{isEnglish ? "A guide for your own music" : "나의 음악만을 위한 방송 신청 가이드"}</p>
      <p className="mt-1.5 text-sm font-semibold">{broadcastArtist(submission) || artistName || (isEnglish ? "My artist" : "나의 아티스트")}{submission.title ? ` · ${submission.title}` : ""}</p>
      <p className="mt-2 flex items-start gap-2 text-base font-semibold"><Music2 size={18} className="mt-0.5 shrink-0" aria-hidden /><span>{trackName || (isEnglish ? "Enter your song below" : "아래에서 곡명을 입력해주세요")}</span></p>
      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{stationName} · {selected.manual ? (isEnglish ? "Manually entered song · Track-level approval unverified" : "직접 입력한 곡 · 곡별 적격 여부 미확인") : (isEnglish ? "Approved track" : "적격 곡")}{program ? ` · ${program}` : ""}</p>
      {(submission.genre || submission.release_date) && <p className={`mt-1 ${noteClass}`}>{[submission.genre, submission.release_date && `${isEnglish ? "Released" : "발매"} ${submission.release_date}`].filter(Boolean).join(" · ")}</p>}
    </div>
    <ol className="grid grid-cols-4 gap-1.5" aria-label={isEnglish ? "Request steps" : "방송 신청 단계"}>
      {steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={`min-w-0 border-t-2 pt-2 text-[11px] leading-4 sm:text-xs ${step === index + 1 ? "border-[#1556a4] font-semibold text-[#1556a4] dark:border-blue-400 dark:text-blue-300" : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400"}`}><span className="mr-1 tabular-nums">{index + 1}.</span>{label}</li>)}
    </ol>
    <div data-testid={`radio-step-${step}`} className="min-w-0 space-y-5">
      <div><p className="mb-1 text-xs font-semibold text-[#1556a4] dark:text-blue-300">{isEnglish ? `Step ${step} of 4` : `${step} / 4 단계`}</p><h3 ref={headingRef} tabIndex={-1} className="scroll-mt-3 text-lg font-semibold leading-snug focus:outline-none">{titles[step - 1]}</h3></div>
      {step === 1 && <>
        {candidates.length > 1 && <div><label htmlFor={`${id}-station`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Approved broadcaster" : "적격 방송국"}</label><select id={`${id}-station`} value={selected.review.id} className={radioControlClass} onChange={event => setStationId(event.target.value)}>{candidates.map(item => <option key={item.review.id} value={item.review.id}>{item.review.station?.name || item.review.station?.code || (isEnglish ? "Broadcaster" : "방송국")}</option>)}</select></div>}
        {selected.manual ? <>
          <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">{isEnglish ? "This broadcaster’s approval is recorded, but individual track details are missing. Enter a song from this album and check its actual approval before posting. These entries prepare your draft only; they do not change your review record." : "이 방송국의 적격 기록은 있지만 개별 곡 정보가 없습니다. 이 음반의 곡을 입력하고 신청 전 해당 곡의 실제 적격 여부를 확인해주세요. 입력한 정보는 초안에만 사용하며 심의 기록을 변경하지 않습니다."}</p>
          <div><label htmlFor={`${id}-manual-title`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Song title (required)" : "신청할 곡명 (필수)"}</label><input id={`${id}-manual-title`} className={radioControlClass} value={manual.title} maxLength={200} onChange={event => { const title = event.target.value; setManualNames(previous => ({ ...previous, [selected.review.id]: { ...manual, title } })); }} /></div>
          <div><label htmlFor={`${id}-manual-artist`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Artist name (required)" : "아티스트명 (필수)"}</label><input id={`${id}-manual-artist`} className={radioControlClass} value={manual.artist} maxLength={200} onChange={event => { const artist = event.target.value; setManualNames(previous => ({ ...previous, [selected.review.id]: { ...manual, artist } })); }} /></div>
        </> : <div><label htmlFor={`${id}-track`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Approved track" : "신청할 적격 곡"}</label><select id={`${id}-track`} className={radioControlClass} value={selectedTrack.key} onChange={event => updateSelection({ track: event.target.value })}>{selected.tracks.map(item => <option key={item.key} value={item.key}>{broadcastTrackTitle(item.track)}</option>)}</select><p className={`mt-2 ${noteClass}`}>{isEnglish ? `Only your tracks approved by ${stationName} appear here. Artist: ${artistName}.` : `${stationName}에서 적격을 받은 내 곡만 보여드려요. 아티스트: ${artistName}.`}</p></div>}
        {needsArtist && <div><label htmlFor={`${id}-artist`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Artist name (required)" : "아티스트명 (필수)"}</label><input id={`${id}-artist`} className={radioControlClass} value={manual.artist} maxLength={200} onChange={event => { const artist = event.target.value; setManualNames(previous => ({ ...previous, [selected.review.id]: { ...manual, artist } })); }} /><p className={`mt-2 ${noteClass}`}>{isEnglish ? "The song is approved, but its artist name is missing. Enter the official name for this draft. This does not change your review record." : "곡의 적격 결과는 있지만 아티스트 정보가 없습니다. 초안에 사용할 정확한 활동명을 입력해주세요. 심의 기록은 변경하지 않습니다."}</p></div>}
        <p className={noteClass}>{isEnglish ? "We will prepare a request for this song, help you choose a program, and show you where to post. The program makes the final music selection." : "이 곡에 맞춰 신청 문구를 만들고, 프로그램 선택부터 게시판 등록까지 안내할게요. 실제 방송 선곡은 프로그램에서 결정합니다."}</p>
      </>}
      {step === 2 && <>
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{isEnglish ? `Think about the mood of “${trackName}”${submission.genre ? ` (${submission.genre})` : ""}. Check the program introduction and recent playlists before choosing.` : `‘${trackName}’${submission.genre ? ` (${submission.genre})` : ""}의 분위기를 떠올려보세요. 프로그램 소개와 최근 선곡을 살펴보고 함께 듣기 좋은 곳을 골라주세요.`}</p>
        {guide?.programs.length ? <div className="grid gap-3 sm:grid-cols-2">{guide.programs.map(item => <article key={item.name} className={`flex min-w-0 flex-col rounded-xl border p-4 ${program === item.name ? "border-blue-500 bg-blue-50/60 dark:border-blue-400 dark:bg-blue-950/30" : "border-slate-200 dark:border-slate-700"}`}>
          <h4 className="font-semibold">{item.name}</h4><p className={`mt-2 flex-1 ${noteClass}`}>{item.description[locale]}</p>
          <div className="mt-2 flex flex-wrap gap-2"><a href={item.url} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} px-2 text-xs`}>{isEnglish ? "Program info" : "프로그램 소개"}<ArrowUpRight size={13} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a><a href={item.playlistUrl} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} px-2 text-xs`}>{isEnglish ? "Recent playlist" : "최근 선곡표"}<ArrowUpRight size={13} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a></div>
          <button type="button" onClick={() => updateSelection({ program: item.name })} aria-pressed={program === item.name} className={`${program === item.name ? primaryClass : radioButtonClass} mt-3 w-full`}>{program === item.name && <Check size={15} aria-hidden />}{isEnglish ? `Choose ${item.name}` : `${item.name} 선택`}</button>
        </article>)}</div> : null}
        {guide ? <a href={guide.directoryUrl} target="_blank" rel="noopener noreferrer" className={`${radioButtonClass} w-full`}>{isEnglish ? `All programs at ${guide.name}` : `${guide.name} · 전체 프로그램`}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a> : <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">{isEnglish ? "A public request board has not been verified for this broadcaster. Ask the broadcaster which program accepts requests before continuing. We do not link to another broadcaster." : "이 방송국의 공개 신청곡 게시판은 확인되지 않았습니다. 방송국에 신청 가능한 프로그램과 참여 경로를 문의한 뒤 진행해주세요."}</p>}
        <div><label htmlFor={`${id}-program`} className="mb-1.5 block text-sm font-semibold">{guide?.programs.length ? (isEnglish ? "Selected program or another program name" : "선택한 프로그램 또는 다른 프로그램명") : (isEnglish ? "Program name you checked (required)" : "직접 확인한 프로그램명 (필수)")}</label><input id={`${id}-program`} value={selection.program ?? ""} maxLength={120} className={radioControlClass} onChange={event => updateSelection({ program: event.target.value })} placeholder={isEnglish ? "Enter the exact program name" : "프로그램 이름을 정확히 입력해주세요"} /><p className={`mt-2 ${noteClass}`}>{isEnglish ? "Drafts are kept separately for every song and program while this page is open. Return to the same selection to restore your edits." : "이 화면에서 곡·프로그램별로 초안을 따로 보관해요. 이전에 선택한 곡과 프로그램으로 돌아가면 작성하던 문구가 다시 나타납니다."}</p></div>
      </>}
      {step === 3 && <>
        <div><label htmlFor={`${id}-language`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Draft language" : "신청 문구 언어"}</label><select id={`${id}-language`} className={radioControlClass} value={language} onChange={event => updateSelection({ language: event.target.value as "ko" | "en" })}><option value="ko">한국어</option><option value="en">English</option></select>{guide?.language === "en" && <p className={`mt-2 ${noteClass}`}>{isEnglish ? "An English draft is provided for Arirang, using your registered English artist and song names when available." : "영어로 소통하는 Arirang에는 영문 초안을 준비했어요. 등록된 공식 영문 곡명·아티스트명이 있으면 사용합니다."}</p>}</div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
          <label htmlFor={`${id}-story`} className="block text-sm font-semibold">{isEnglish ? "Add your song’s story (optional)" : "내 곡만의 이야기를 더해보세요 (선택)"}</label>
          <p className={`mt-1 ${noteClass}`}>{isEnglish ? `Why would you like ${program} listeners to hear “${trackName}”? Two or three personal sentences are enough.` : `${program} 청취자들과 ‘${trackName}’을 함께 듣고 싶은 이유를 2~3문장으로 적어주세요.`}</p>
          <div className="my-3 flex flex-wrap gap-1.5">{storyPrompts.map((prompt, index) => <button key={prompt} type="button" aria-pressed={draft.prompt === index} onClick={() => updateDraft(current => ({ ...current, prompt: index }))} className={`${radioButtonClass} px-2 text-xs ${draft.prompt === index ? "border-blue-400 dark:border-blue-400" : ""}`}>{isEnglish ? ["Inspiration", "Listening moment", "Song mood"][index] : ["만든 이야기", "듣기 좋은 순간", "곡의 분위기"][index]}</button>)}</div>
          <textarea id={`${id}-story`} className={`${radioControlClass} resize-y`} value={draft.story} rows={2} maxLength={1000} placeholder={storyPrompts[draft.prompt]} onChange={event => { const story = event.target.value; updateDraft(current => ({ ...current, story })); }} />
          <button type="button" className={`${radioButtonClass} mt-2 w-full`} disabled={!draft.story.trim() || draft.body.length + draft.story.trim().length + 2 > 5000} onClick={() => updateDraft(current => ({ ...current, body: `${current.body.trimEnd()}\n\n${current.story.trim()}`, story: "", bodyCopied: false }))}>{isEnglish ? "Add my story to the request" : "신청 문구에 이야기 추가"}</button>
        </div>
        <CopyableDraft key={draftKey} draft={draft} updateDraft={updateDraft} isEnglish={isEnglish} editor />
      </>}
      {step === 4 && <>
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{isEnglish ? `Your request for “${trackName}” is ready for ${program}. Onside prepares the text; you sign in and submit it on the broadcaster’s site.` : `‘${trackName}’을 ${program}에 신청할 준비가 됐어요. 온사이드는 문구를 준비하고, 실제 등록은 방송국 사이트에서 직접 진행합니다.`}</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6"><li>{isEnglish ? "Open the official route below and sign in with your broadcaster account." : "아래 공식 경로를 열고 방송국 계정으로 로그인하세요."}</li><li>{selectedProgram ? (isEnglish ? "Read the board notice, then start a new post." : "게시판 공지를 읽고 글쓰기를 눌러주세요.") : (isEnglish ? `Find ${program}, then open its song-request or listener participation menu.` : `${program} 홈에서 ‘사연과 신청곡’ 또는 청취자 참여 메뉴를 찾아주세요.`)}</li><li>{isEnglish ? "Paste the title and body separately. Check personal information and any required fields, then submit yourself." : "제목과 본문을 각각 붙여넣고, 개인정보와 필수 입력 항목을 확인한 뒤 등록하세요."}</li></ol>
        {guide ? <div className="grid gap-2"><a href={selectedProgram?.messageUrl ?? guide.directoryUrl} target="_blank" rel="noopener noreferrer" className={primaryClass}>{selectedProgram ? (isEnglish ? `Open ${program} request board` : `${program} 신청 게시판 열기`) : (isEnglish ? `Find ${program} on the official site` : `공식 사이트에서 ${program} 찾기`)}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>{!selectedProgram && <p className={noteClass}>{isEnglish ? "This opens the broadcaster’s program directory. A direct board link for the entered program has not been verified." : "방송국의 프로그램 목록이 열립니다. 직접 입력한 프로그램의 게시판 주소는 별도로 확인해주세요."}</p>}{selectedProgram && <a href={selectedProgram.playlistUrl} target="_blank" rel="noopener noreferrer" className={radioButtonClass}><ListMusic size={15} aria-hidden />{isEnglish ? `${program} playlist` : `${program} 선곡표 확인`}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>}{!selectedProgram && guide.participationLink && <a href={guide.participationLink.url} target="_blank" rel="noopener noreferrer" className={radioButtonClass}>{isEnglish ? `Live participation: ${guide.participationLink.name}` : `${guide.participationLink.name} 실시간 참여 안내`}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>}</div> : <p className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950 dark:bg-amber-950/40 dark:text-amber-200">{isEnglish ? "No official board link has been verified. Use the route you confirmed with this broadcaster; this guide does not confirm that it accepts public requests." : "확인된 공식 게시판 링크가 없습니다. 방송국에 직접 확인한 경로를 이용해주세요. 이 가이드가 해당 방송국의 공개 신청 접수를 보장하지는 않습니다."}</p>}
        <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><summary className="min-h-11 cursor-pointer py-2.5 text-sm font-semibold">{isEnglish ? "Copy my prepared title and request" : "준비한 제목·본문 다시 복사하기"}</summary><div className="pt-3"><CopyableDraft key={draftKey} draft={draft} updateDraft={updateDraft} isEnglish={isEnglish} /></div></details>
        <fieldset className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900"><legend className="px-1 text-sm font-semibold">{isEnglish ? "My posting checklist" : "나의 신청 체크리스트"}</legend>{([
          ["rules", isEnglish ? "I read the program’s posting rules" : "프로그램 게시판 공지를 확인했어요"],
          ["privacy", isEnglish ? "I checked my text and personal information" : "신청 문구와 개인정보를 확인했어요"],
          ["posted", isEnglish ? "I posted the request on the broadcaster’s site" : "방송국에서 직접 신청글을 등록했어요"],
          ["playlist", isEnglish ? "I checked my post and the program playlist" : "내 게시글과 프로그램 선곡표를 확인했어요"],
        ] as [keyof Progress, string][]).map(([key, label]) => <label key={key} className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-sm leading-6"><input type="checkbox" checked={Boolean(currentProgress[key])} onChange={event => updateProgress(key, event.target.checked)} className="mt-1 size-4 shrink-0 accent-[#1556a4]" /><span>{label}</span></label>)}<p className={`mt-2 ${noteClass}`}>{isEnglish ? "Your checklist is kept per song and program while this page is open. It does not automatically confirm submission or airplay. Check your post and the program’s playlist afterward." : "이 화면이 열려 있는 동안 곡·프로그램별로 체크를 보관합니다. 실제 접수·방송을 자동 확인하지는 않아요. 등록 후 내 게시글과 프로그램 선곡표를 확인해주세요."}</p></fieldset>
      </>}
    </div>
    <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
      {step > 1 && <button type="button" className={radioButtonClass} onClick={() => setStep(step - 1)}><ArrowLeft size={15} aria-hidden />{isEnglish ? "Previous" : "이전"}</button>}
      {step < 4 && <button type="button" className={`${primaryClass} flex-1`} disabled={!canContinue} onClick={() => setStep(step + 1)}>{isEnglish ? ["Choose a program for this song", "Prepare my request", "View posting instructions"][step - 1] : ["이 곡으로 프로그램 고르기", "이 프로그램으로 초안 만들기", "신청 방법 보기"][step - 1]}<ArrowRight size={15} aria-hidden /></button>}
      {step === 4 && <button type="button" className={`${radioButtonClass} flex-1`} onClick={() => setStep(1)}>{isEnglish ? "Prepare another request" : "다른 신청 준비하기"}</button>}
    </div>
    <p className={noteClass}>{isEnglish ? "This guide is free. Review approval and requests do not guarantee airplay. Save important text before leaving this page." : "신청 가이드는 무료입니다. 심의 적격·신청 등록이 방송을 보장하지는 않습니다. 중요한 초안은 화면을 떠나기 전에 따로 보관해주세요."}</p>
  </div>;
}

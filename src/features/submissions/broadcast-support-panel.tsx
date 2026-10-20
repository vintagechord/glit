"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Download, ListMusic, Radio } from "lucide-react";
import {
  broadcastTrackTitle,
  broadcastArtist,
  buildBroadcastCredits,
  buildBroadcastResultCsv,
  buildRadioRequest,
  getBroadcastTracks,
  radioRequestGuide,
  radioRequestGuideEnglish,
  type BroadcastReview,
  type BroadcastSubmission,
  type BroadcastTrack,
} from "@/lib/broadcast-support";
import { getRadioStationGuide } from "@/lib/radio-station-guide";
import { RadioStationGuideContent } from "./radio-station-guide";
import { normalizeStationReviewStatus } from "@/constants/review-status";

const controlClass = "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-base leading-6 text-slate-900 transition placeholder:text-slate-400 focus-visible:border-[#1556a4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-blue-400 dark:focus-visible:ring-blue-400/20 sm:text-sm";
const buttonClass = "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-center text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950 [&>svg]:shrink-0";
const primaryButtonClass = "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-xl border border-[#1556a4] bg-[#1556a4] px-3.5 py-2 text-center text-sm font-semibold text-white transition hover:border-[#104581] hover:bg-[#104581] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-slate-950 [&>svg]:shrink-0";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

type RequestDraftState = {
  program: string;
  title: string;
  body: string;
  titleCopied?: boolean;
  bodyCopied?: boolean;
};
type RequestProgress = { rules?: boolean; privacy?: boolean; posted?: boolean; playlist?: boolean };
type RequestDraftUpdate = RequestDraftState | ((current: RequestDraftState) => RequestDraftState);

function RequestDraft({ submission, track, isEnglish, draftEnglish, savedDraft, onDraftChange }: {
  submission: BroadcastSubmission;
  track: BroadcastTrack;
  isEnglish: boolean;
  draftEnglish: boolean;
  savedDraft?: RequestDraftState;
  onDraftChange: (draft: RequestDraftUpdate) => void;
}) {
  const id = useId();
  const initial = buildRadioRequest({ submission, track, isEnglish: draftEnglish });
  const draft = savedDraft ?? { program: "", ...initial };
  const { program, title, body } = draft;
  const [message, setMessage] = useState("");
  const [story, setStory] = useState("");
  const [storyPrompt, setStoryPrompt] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function copy(kind: "title" | "body") {
    try {
      await navigator.clipboard.writeText(kind === "title" ? title : body);
      onDraftChange(current => current[kind] === draft[kind] ? { ...current, [kind === "title" ? "titleCopied" : "bodyCopied"]: true } : current);
      setMessage(isEnglish ? "Copied." : "복사했습니다.");
    } catch {
      const field = kind === "title" ? titleRef.current : bodyRef.current;
      field?.focus();
      field?.select();
      setMessage(isEnglish ? "Select and copy the highlighted text." : "자동 복사가 제한되어 문구를 선택했습니다. 직접 복사해주세요.");
    }
  }

  const storyPrompts = isEnglish
    ? ["What inspired this song?", "When would you like listeners to hear it?", "What feeling would you like to share?"]
    : ["이 곡을 만들게 된 이야기는?", "어떤 순간에 함께 듣고 싶나요?", "청취자에게 전하고 싶은 마음은?"];

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={`${id}-program`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Program (optional)" : "신청할 프로그램 (선택)"}</label>
        <input id={`${id}-program`} value={program} onChange={event => {
          const nextProgram = event.target.value;
          const wasGenerated = body === buildRadioRequest({ submission, track, program, isEnglish: draftEnglish }).body;
          onDraftChange({ ...draft, program: nextProgram, bodyCopied: false, body: wasGenerated ? buildRadioRequest({ submission, track, program: nextProgram, isEnglish: draftEnglish }).body : body });
        }} placeholder={isEnglish ? "Program name" : "예: 즐겨 듣는 라디오 프로그램"} className={controlClass} maxLength={120} />
      </div>
      <div>
        <label htmlFor={`${id}-title`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Post title" : "게시글 제목"}</label>
        <input ref={titleRef} id={`${id}-title`} value={title} onChange={event => onDraftChange({ ...draft, title: event.target.value, titleCopied: false })} className={controlClass} maxLength={300} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-950">
        <label htmlFor={`${id}-story`} className="block text-sm font-semibold">{isEnglish ? "Add the story behind your song" : "내 곡만의 이야기를 더해보세요"}</label>
        <div className="my-2 flex flex-wrap gap-1.5">
          {storyPrompts.map((prompt, index) => <button key={prompt} type="button" aria-pressed={storyPrompt === index} onClick={() => setStoryPrompt(index)} className={`min-h-10 rounded-lg border px-2.5 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] ${storyPrompt === index ? "border-blue-200 bg-blue-50 text-[#1556a4] dark:border-blue-700 dark:bg-blue-950 dark:text-blue-200" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}>{isEnglish ? ["Inspiration", "Listening moment", "Your message"][index] : ["만든 이야기", "듣기 좋은 순간", "전하고 싶은 마음"][index]}</button>)}
        </div>
        <textarea id={`${id}-story`} value={story} onChange={event => setStory(event.target.value)} rows={2} maxLength={1000} placeholder={storyPrompts[storyPrompt]} className={`${controlClass} resize-y`} />
        <button type="button" className={`${buttonClass} mt-2 w-full`} disabled={!story.trim() || body.length + story.trim().length + 2 > 5000} onClick={() => {
          onDraftChange({ ...draft, body: `${body.trimEnd()}\n\n${story.trim()}`, bodyCopied: false });
          setStory("");
          setMessage(isEnglish ? "Your story was added. Review the request below." : "나의 이야기를 더했습니다. 아래 문구를 확인해주세요.");
        }}>{isEnglish ? "Add to my request" : "신청 문구에 이야기 추가"}</button>
      </div>
      <div>
        <label htmlFor={`${id}-body`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Your story and song request" : "사연과 신청곡 문구"}</label>
        <textarea ref={bodyRef} id={`${id}-body`} value={body} onChange={event => onDraftChange({ ...draft, body: event.target.value, bodyCopied: false })} rows={7} maxLength={5000} className={`${controlClass} resize-y`} aria-describedby={`${id}-tip`} />
        <p id={`${id}-tip`} className="mt-2 text-xs leading-5 text-muted-foreground">{isEnglish ? "Add two or three sentences: when you want to hear this song, a story connected to it, and the feeling you want to share." : "언제 듣고 싶은지, 곡과 연결되는 나의 이야기, 함께 나누고 싶은 기분을 2~3문장으로 덧붙여보세요."}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" className={buttonClass} disabled={!title.trim()} onClick={() => void copy("title")}>{draft.titleCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{isEnglish ? "Copy title" : "제목 복사"}</button>
        <button type="button" className={primaryButtonClass} disabled={!body.trim()} onClick={() => void copy("body")}>{draft.bodyCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{isEnglish ? "Copy request" : "본문 복사"}</button>
        <button type="button" className={`${buttonClass} col-span-2`} onClick={() => saveBlob(new Blob([`${program ? `${program}\n\n` : ""}${title}\n\n${body}`], { type: "text/plain;charset=utf-8" }), "onside-radio-request.txt")}><Download size={15} aria-hidden />{isEnglish ? "Save draft" : "초안 저장"}</button>
      </div>
      <p role="status" className="min-h-5 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export function BroadcastSupportPanel({ submission, stationReviews, isEnglish = false, embedded = false }: {
  submission: BroadcastSubmission;
  stationReviews: BroadcastReview[];
  isEnglish?: boolean;
  embedded?: boolean;
}) {
  const id = useId();
  const eligible = useMemo(() => stationReviews.map(review => ({ review, tracks: getBroadcastTracks(submission, review).filter(item => item.status === "APPROVED") })).filter(item => item.tracks.length > 0), [submission, stationReviews]);
  const [stationId, setStationId] = useState("");
  const [trackKey, setTrackKey] = useState("");
  const [draftLanguage, setDraftLanguage] = useState<"ko" | "en" | "">("");
  const [drafts, setDrafts] = useState<Record<string, RequestDraftState>>({});
  const [progress, setProgress] = useState<Record<string, RequestProgress>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectionRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const handoffRef = useRef<HTMLDivElement>(null);
  const selected = eligible.find(item => item.review.id === stationId) || eligible[0];
  const selectedTrack = selected?.tracks.find(item => item.key === trackKey) || selected?.tracks[0];
  const guideOnlyReview = !submission.album_tracks?.length && stationReviews.length === 1 && normalizeStationReviewStatus(stationReviews[0].status) === "APPROVED" ? stationReviews[0] : null;
  const stationGuide = getRadioStationGuide({ stationCode: selected?.review.station?.code, stationName: selected?.review.station?.name });
  const draftEnglish = draftLanguage ? draftLanguage === "en" : isEnglish || stationGuide?.language === "en";
  const draftKey = `${submission.id}:${selected?.review.id}:${selectedTrack?.key}:${draftEnglish}`;
  const currentDraft = drafts[draftKey];
  const selectedProgram = stationGuide?.programs.find(program => program.name === currentDraft?.program.trim());
  const progressKey = `${submission.id}:${selected?.review.id}:${selectedTrack?.key}:${currentDraft?.program.trim() ?? ""}`;
  const currentProgress = progress[progressKey] ?? {};
  const approvedTrackCount = new Set(eligible.flatMap(item => item.tracks.map(track => track.key))).size;
  const guide = isEnglish ? radioRequestGuideEnglish : radioRequestGuide;
  const checks: { key: "rules" | "privacy"; label: string }[] = [
    { key: "rules", label: isEnglish ? "Read the program board rules" : "프로그램 게시판 공지 확인" },
    { key: "privacy", label: isEnglish ? "Added my story and checked personal information" : "사연 추가 및 개인정보 확인" },
  ];

  function updateProgress(key: keyof RequestProgress, value: boolean) {
    setProgress(previous => ({ ...previous, [progressKey]: { ...previous[progressKey], [key]: value } }));
  }

  function goToStep(target: HTMLDivElement | null) {
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }

  function selectProgram(program: string) {
    if (!selectedTrack) return;
    setDrafts(previous => {
      const current = previous[draftKey] ?? { program: "", ...buildRadioRequest({ submission, track: selectedTrack.track, isEnglish: draftEnglish }) };
      const generated = buildRadioRequest({ submission, track: selectedTrack.track, program: current.program, isEnglish: draftEnglish });
      const next = buildRadioRequest({ submission, track: selectedTrack.track, program, isEnglish: draftEnglish });
      return { ...previous, [draftKey]: { ...current, program, bodyCopied: current.program === program && current.bodyCopied, body: current.body === generated.body ? next.body : current.body } };
    });
    goToStep(draftRef.current);
  }

  async function downloadPack() {
    setBusy(true);
    setError("");
    try {
      const { default: PizZip } = await import("pizzip");
      const zip = new PizZip();
      zip.file("01-credits.txt", buildBroadcastCredits(submission));
      zip.file("02-station-results.csv", buildBroadcastResultCsv(submission, stationReviews));
      zip.file("03-radio-guide.txt", [...guide.map((step, index) => `${index + 1}. ${step}`), "", isEnglish ? "Approval and song requests do not guarantee airplay. This pack contains text information only; original audio/video files and certificates are not included." : "심의 적격과 신청곡 등록은 방송 편성을 보장하지 않습니다. 이 묶음은 텍스트 자료이며 원본 음원·영상·증명서는 포함하지 않습니다."].join("\n"));
      saveBlob(zip.generate({ type: "blob", compression: "DEFLATE" }), "onside-broadcast-kit.zip");
    } catch {
      setError(isEnglish ? "Download failed. Please try again." : "자료를 내려받지 못했습니다. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id={embedded ? undefined : "broadcast-support"} aria-labelledby={`${id}-heading`} className={embedded ? "min-w-0 [overflow-wrap:anywhere]" : "min-w-0 rounded-[1rem] border border-slate-200 bg-white p-4 [overflow-wrap:anywhere] sm:p-6 dark:border-slate-800 dark:bg-slate-950"} data-testid="broadcast-support">
      <div className={embedded ? "sr-only" : "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 sm:gap-3"}>
        <Radio size={21} className="mt-0.5 text-slate-500 dark:text-slate-400" aria-hidden />
        <h2 id={`${id}-heading`} className="text-base font-semibold leading-snug tracking-tight sm:text-lg">{isEnglish ? "Get your music on the radio" : "내 음악, 라디오에 신청하기"}</h2>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{isEnglish ? "Free" : "무료"}</span>
      </div>
      {!embedded && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{isEnglish ? "Your review results are the starting point for getting your own music heard. Prepare a request, reach the official program board and check the playlist." : "내 음악이 방송에서 들리는 순간까지. 나의 심의 결과를 바탕으로 신청 문구 준비부터 공식 게시판 참여, 선곡표 확인까지 이어갑니다."}</p>}
      <div className={embedded ? "" : "mt-5"}>
          {selected && selectedTrack ? <>
            <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/30">
              <p className="text-xs font-semibold text-[#1556a4] dark:text-blue-300">{isEnglish ? "A guide for your music" : "나의 음악만을 위한 방송 제안"}</p>
              <p className="mt-1.5 text-base font-semibold">{broadcastArtist(submission)}{submission.title ? ` · ${submission.title}` : ""}</p>
              <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{isEnglish ? `Based on this album’s review records: ${approvedTrackCount} approved track(s) across ${eligible.length} broadcaster(s). Only tracks approved by the selected broadcaster appear below.` : `이 음반의 심의 기록에서 ${eligible.length}개 방송국, ${approvedTrackCount}곡의 적격 결과를 확인했어요. 선택한 방송국에서 신청 가능한 내 곡만 보여드립니다.`}</p>
              {(submission.genre || submission.release_date) && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{[submission.genre, submission.release_date && `${isEnglish ? "Released" : "발매"} ${submission.release_date}`].filter(Boolean).join(" · ")}</p>}
            </div>
            <div ref={selectionRef} tabIndex={-1} className="grid scroll-mt-4 gap-3 focus:outline-none sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor={`${id}-station`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Approved broadcaster" : "적격 방송국"}</label>
                <select id={`${id}-station`} className={controlClass} value={selected.review.id} onChange={event => { setStationId(event.target.value); setTrackKey(""); setDraftLanguage(""); }}>
                  {eligible.map(item => <option key={item.review.id} value={item.review.id}>{item.review.station?.name || item.review.station?.code || "방송국"}</option>)}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor={`${id}-track`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Approved track" : "신청할 적격 곡"}</label>
                <select id={`${id}-track`} className={controlClass} value={selectedTrack.key} onChange={event => setTrackKey(event.target.value)}>
                  {selected.tracks.map(item => <option key={item.key} value={item.key}>{broadcastTrackTitle(item.track)}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3 flex min-w-0 items-start gap-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
              <Check size={14} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
              <p className="min-w-0">{selectedTrack.track.performer || broadcastArtist(submission)} · {selected.review.station?.name || selected.review.station?.code} {isEnglish ? "approved" : "적격"}</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{isEnglish ? "Free request preparation. Approval does not guarantee airplay; each program selects its music." : "신청 준비는 무료입니다. 심의 적격과 별개로 실제 선곡은 각 프로그램에서 결정합니다."}</p>
            <ol className="mt-4 grid grid-cols-3 gap-2 text-xs" aria-label={isEnglish ? "Request progress" : "신청 준비 진행 상태"}>
              {[
                { label: isEnglish ? "Track approved" : "적격 곡 확인", done: true, target: selectionRef },
                { label: isEnglish ? "Request copied" : "신청 문구 복사", done: Boolean(currentDraft?.titleCopied && currentDraft?.bodyCopied), target: draftRef },
                { label: isEnglish ? "Posted by you" : "직접 등록 확인", done: Boolean(currentProgress.posted), target: handoffRef },
              ].map((step, index) => <li key={step.label} className="min-w-0"><button type="button" onClick={() => goToStep(step.target.current)} className={`flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1556a4] ${step.done ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>{step.done ? <Check size={14} className="shrink-0" aria-hidden /> : <span className="shrink-0">{index + 1}</span>}<span>{step.label}<span className="sr-only">{step.done ? (isEnglish ? " complete" : " 완료") : (isEnglish ? " pending" : " 대기")}{isEnglish ? " — go to step" : " · 해당 단계로 이동"}</span></span></button></li>)}
            </ol>
            <div className="mt-7 grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <RadioStationGuideContent stationCode={selected.review.station?.code} stationName={selected.review.station?.name} isEnglish={isEnglish} selectedProgram={drafts[draftKey]?.program} onSelectProgram={selectProgram} />
              <div ref={draftRef} tabIndex={-1} className="min-w-0 scroll-mt-4 rounded-[1rem] border border-slate-200 bg-slate-50/70 p-4 focus:outline-none sm:p-5 dark:border-slate-800 dark:bg-slate-900/40">
                <div className="mb-4 flex items-center gap-2.5"><span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">2</span><h3 className="text-base font-semibold tracking-tight">{isEnglish ? "Prepare your request" : "신청 문구 준비하기"}</h3></div>
                <div className="mb-5 text-sm leading-6">
                  <p className="font-medium text-slate-700 dark:text-slate-200">{isEnglish ? "Artist + song title + your story" : "아티스트명 + 곡명 + 함께 듣고 싶은 이유"}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{isEnglish ? "Add release details or review documents only if the program asks for them. This is a listener request, not a music-delivery or artist booking form." : "발매 정보나 심의 서류는 프로그램에서 요청할 때만 추가하세요. 청취자 신청곡 참여이며, 음원 납품·출연 섭외 접수와는 다릅니다."}</p>
                </div>
                <div className="mb-4"><label htmlFor={`${id}-language`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Draft language" : "신청 문구 언어"}</label><select id={`${id}-language`} value={draftEnglish ? "en" : "ko"} onChange={event => setDraftLanguage(event.target.value as "en" | "ko")} className={controlClass}><option value="ko">한국어</option><option value="en">English</option></select>{stationGuide?.language === "en" && <p className="mt-2 text-xs leading-5 text-muted-foreground">{isEnglish ? "An English template is provided for Arirang. Use your official English artist and track names where available." : "Arirang 참여를 돕기 위해 영문 초안을 제공합니다. 곡명·아티스트명은 등록된 공식 영문명이 있으면 사용합니다."}</p>}</div>
                <RequestDraft key={draftKey} submission={submission} track={selectedTrack.track} isEnglish={isEnglish} draftEnglish={draftEnglish} savedDraft={drafts[draftKey]} onDraftChange={update => setDrafts(previous => {
                  const current = previous[draftKey] ?? { program: "", ...buildRadioRequest({ submission, track: selectedTrack.track, isEnglish: draftEnglish }) };
                  return { ...previous, [draftKey]: typeof update === "function" ? update(current) : update };
                })} />
                <div ref={handoffRef} tabIndex={-1} className="mt-2 scroll-mt-4 space-y-3 border-t border-slate-200 pt-4 text-sm leading-6 focus:outline-none dark:border-slate-800">
                  <p className="font-semibold">{isEnglish ? "3. Post on the program’s board" : "3. 프로그램 게시판에서 직접 등록"}</p>
                  <p className="text-xs leading-5 text-muted-foreground">{isEnglish ? "Copy both fields, open the official site below, then sign in and paste your request. You submit it yourself on the broadcaster’s site." : "제목과 본문을 각각 복사하고 아래 공식 사이트로 이동하세요. 방송국 계정으로 로그인해 붙여넣은 뒤 직접 등록하면 됩니다."}</p>
                  {stationGuide && <div className="grid gap-2">
                    <a href={selectedProgram?.messageUrl ?? stationGuide.directoryUrl} target="_blank" rel="noopener noreferrer" className={primaryButtonClass}>{selectedProgram ? (isEnglish ? `Open ${selectedProgram.name} request board` : `${selectedProgram.name} 신청 게시판 열기`) : (isEnglish ? `Choose a program at ${stationGuide.name}` : `${stationGuide.name}에서 신청할 프로그램 찾기`)}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>
                    {!selectedProgram && stationGuide.participationLink && <a href={stationGuide.participationLink.url} target="_blank" rel="noopener noreferrer" className={buttonClass}>{isEnglish ? `Join live with ${stationGuide.participationLink.name}` : `${stationGuide.participationLink.name} 실시간 참여 안내`}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>}
                    {selectedProgram && <a href={selectedProgram.playlistUrl} target="_blank" rel="noopener noreferrer" className={buttonClass}><ListMusic size={15} aria-hidden />{isEnglish ? `${selectedProgram.name} playlist` : `${selectedProgram.name} 선곡표 확인`}<ArrowUpRight size={15} aria-hidden /><span className="sr-only">{isEnglish ? " (new tab)" : " (새 창)"}</span></a>}
                  </div>}
                  {!stationGuide && <p className="text-xs text-muted-foreground">{isEnglish ? "Check this broadcaster’s official participation route before posting." : "이 방송국의 공식 참여 경로를 먼저 확인한 뒤 등록해주세요."}</p>}
                  <fieldset className="space-y-1 rounded-lg bg-white p-3 dark:bg-slate-950">
                    <legend className="px-1 text-xs font-semibold">{isEnglish ? "My follow-up" : "나의 신청 후 확인"}</legend>
                    <label className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-xs"><input type="checkbox" checked={Boolean(currentProgress.posted)} onChange={event => updateProgress("posted", event.target.checked)} className="mt-1 size-4 shrink-0 accent-[#1f7a5a]" /><span>{isEnglish ? "I posted the request on the broadcaster’s site" : "방송국에서 직접 신청글을 등록했어요"}</span></label>
                    <label className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-xs"><input type="checkbox" checked={Boolean(currentProgress.playlist)} onChange={event => updateProgress("playlist", event.target.checked)} className="mt-1 size-4 shrink-0 accent-[#1f7a5a]" /><span>{isEnglish ? "I checked my post and the program playlist" : "내 게시글과 프로그램 선곡표를 확인했어요"}</span></label>
                    <p className="text-[11px] leading-5 text-muted-foreground">{isEnglish ? "Your own checklist, kept separately for each track, broadcaster and program while this page is open. It does not confirm submission or airplay automatically." : "이 화면이 열려 있는 동안 곡·방송국·프로그램별로 체크할 수 있어요. 실제 접수나 방송 여부를 자동 확인하는 기능은 아닙니다."}</p>
                  </fieldset>
                </div>
              </div>
            </div>
          </> : guideOnlyReview ? (
            <div className="space-y-7">
              <RadioStationGuideContent stationCode={guideOnlyReview.station?.code} stationName={guideOnlyReview.station?.name} isEnglish={isEnglish} />
              <div className="border-t border-slate-200 pt-5 text-sm leading-6 dark:border-slate-800">
                <h3 className="font-semibold">{isEnglish ? "What to write" : "신청글에는 이렇게 적어주세요"}</h3>
                <p className="mt-2 text-muted-foreground">{isEnglish ? "Include the exact artist and song names, then add two or three sentences about when you want to hear the song or a personal story connected to it. Add release details or review documents only if the program asks for them." : "정확한 아티스트명과 곡명을 적고, 언제 듣고 싶은지 또는 곡과 연결되는 나의 이야기를 2~3문장 덧붙여보세요. 발매 정보·심의 서류는 프로그램에서 요청할 때만 추가하면 됩니다."}</p>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{isEnglish ? "This broadcaster’s approval is recorded, but individual track information is missing, so we cannot fill in a draft. Use the program guides above and enter the exact song and artist names yourself." : "방송국 적격 결과는 확인됐지만 개별 곡 정보가 없어 자동 초안을 만들 수 없습니다. 위 참여 경로를 이용하고 신청할 곡명과 아티스트명을 직접 적어주세요."}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{isEnglish ? "Approval and a listener request do not guarantee airplay. Each program selects its music." : "심의 적격과 신청곡 등록이 방송을 보장하지는 않습니다. 실제 선곡은 프로그램에서 결정합니다."}</p>
              </div>
            </div>
          ) : <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{isEnglish ? "No approved track is available for a song request yet. Check the review results and any requested corrections above." : "현재 신청곡으로 안내할 적격 곡이 없습니다. 위 심의 결과와 보완 사유를 먼저 확인해주세요."}</p>}
      </div>
      <details className="mt-7 border-t border-slate-200 pt-3 dark:border-slate-800">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-slate-600 marker:text-slate-400 dark:text-slate-300">{isEnglish ? "Preparation checklist & reference pack" : "준비 체크리스트 · 방송 참고자료"}</summary>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <fieldset className="min-w-0 space-y-1">
            <legend className="mb-3 text-xs text-muted-foreground">{isEnglish ? "Check for the selected track and program while this page is open" : "현재 선택한 곡·프로그램의 준비 상태를 체크하세요"}</legend>
            {checks.map(({ key, label }) => <label key={key} className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-sm"><input type="checkbox" checked={Boolean(currentProgress[key])} onChange={event => updateProgress(key, event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#1f7a5a]" /><span className="min-w-0">{label}</span></label>)}
          </fieldset>
          <div className="min-w-0">
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{isEnglish ? "Download credits, a station-by-station result table, and the request guide. Audio/video files and certificates are not included." : "곡 정보·크레딧, 방송국별 결과표, 신청 가이드를 묶어 내려받습니다. 원본 음원·영상·증명서는 포함되지 않습니다."}</p>
            <button type="button" onClick={() => void downloadPack()} disabled={busy} className={`${buttonClass} w-full sm:w-auto`}><Download size={16} aria-hidden />{busy ? (isEnglish ? "Preparing…" : "자료 준비 중…") : (isEnglish ? "Download reference ZIP" : "참고자료 ZIP 다운로드")}</button>
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Check size={13} aria-hidden />{isEnglish ? "No additional payment" : "추가 결제 없이 사용"}</p>
            {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </div>
      </details>
    </section>
  );
}

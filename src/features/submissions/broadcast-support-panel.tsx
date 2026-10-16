"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Radio } from "lucide-react";
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

const controlClass = "min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:text-sm";
const buttonClass = "inline-flex min-h-11 min-w-0 max-w-full items-center justify-center gap-2 rounded-lg border-2 border-foreground bg-background px-3 py-2 text-center text-sm font-bold transition hover:bg-muted disabled:opacity-50 [&>svg]:shrink-0";

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

type RequestDraftState = { program: string; title: string; body: string };

function RequestDraft({ submission, track, isEnglish, draftEnglish, savedDraft, onDraftChange }: {
  submission: BroadcastSubmission;
  track: BroadcastTrack;
  isEnglish: boolean;
  draftEnglish: boolean;
  savedDraft?: RequestDraftState;
  onDraftChange: (draft: RequestDraftState) => void;
}) {
  const id = useId();
  const initial = buildRadioRequest({ submission, track, isEnglish: draftEnglish });
  const draft = savedDraft ?? { program: "", ...initial };
  const { program, title, body } = draft;
  const [message, setMessage] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function copy(kind: "title" | "body") {
    try {
      await navigator.clipboard.writeText(kind === "title" ? title : body);
      setMessage(isEnglish ? "Copied." : "복사했습니다.");
    } catch {
      const field = kind === "title" ? titleRef.current : bodyRef.current;
      field?.focus();
      field?.select();
      setMessage(isEnglish ? "Select and copy the highlighted text." : "자동 복사가 제한되어 문구를 선택했습니다. 직접 복사해주세요.");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${id}-program`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Program (optional)" : "신청할 프로그램 (선택)"}</label>
        <input id={`${id}-program`} value={program} onChange={event => {
          const nextProgram = event.target.value;
          const wasGenerated = body === buildRadioRequest({ submission, track, program, isEnglish: draftEnglish }).body;
          onDraftChange({ ...draft, program: nextProgram, body: wasGenerated ? buildRadioRequest({ submission, track, program: nextProgram, isEnglish: draftEnglish }).body : body });
        }} placeholder={isEnglish ? "Program name" : "예: 즐겨 듣는 라디오 프로그램"} className={controlClass} maxLength={120} />
      </div>
      <div>
        <label htmlFor={`${id}-title`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Post title" : "게시글 제목"}</label>
        <input ref={titleRef} id={`${id}-title`} value={title} onChange={event => onDraftChange({ ...draft, title: event.target.value })} className={controlClass} maxLength={300} />
      </div>
      <div>
        <label htmlFor={`${id}-body`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Your story and song request" : "사연과 신청곡 문구"}</label>
        <textarea ref={bodyRef} id={`${id}-body`} value={body} onChange={event => onDraftChange({ ...draft, body: event.target.value })} rows={7} maxLength={5000} className={`${controlClass} resize-y`} aria-describedby={`${id}-tip`} />
        <p id={`${id}-tip`} className="mt-2 text-xs leading-5 text-muted-foreground">{isEnglish ? "Add two or three sentences: when you want to hear this song, a story connected to it, and the feeling you want to share." : "언제 듣고 싶은지, 곡과 연결되는 나의 이야기, 함께 나누고 싶은 기분을 2~3문장으로 덧붙여보세요."}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" className={buttonClass} disabled={!title.trim()} onClick={() => void copy("title")}><Copy size={15} aria-hidden />{isEnglish ? "Copy title" : "제목 복사"}</button>
        <button type="button" className={buttonClass} disabled={!body.trim()} onClick={() => void copy("body")}><Copy size={15} aria-hidden />{isEnglish ? "Copy request" : "본문 복사"}</button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draftRef = useRef<HTMLDivElement>(null);
  const selected = eligible.find(item => item.review.id === stationId) || eligible[0];
  const selectedTrack = selected?.tracks.find(item => item.key === trackKey) || selected?.tracks[0];
  const guideOnlyReview = !submission.album_tracks?.length && stationReviews.length === 1 && normalizeStationReviewStatus(stationReviews[0].status) === "APPROVED" ? stationReviews[0] : null;
  const stationGuide = getRadioStationGuide({ stationCode: selected?.review.station?.code, stationName: selected?.review.station?.name });
  const draftEnglish = draftLanguage ? draftLanguage === "en" : isEnglish || stationGuide?.language === "en";
  const draftKey = `${submission.id}:${selected?.review.id}:${selectedTrack?.key}:${draftEnglish}`;
  const guide = isEnglish ? radioRequestGuideEnglish : radioRequestGuide;
  const checks = isEnglish
    ? ["Checked approval for this track and broadcaster", "Read the program board rules", "Added my story and checked personal information", "Posted on the broadcaster's site myself"]
    : ["해당 방송국의 곡별 적격 결과 확인", "프로그램 게시판 공지 확인", "사연 추가 및 개인정보 확인", "방송국 게시판에서 직접 등록 완료"];

  function selectProgram(program: string) {
    if (!selectedTrack) return;
    setDrafts(previous => {
      const current = previous[draftKey] ?? { program: "", ...buildRadioRequest({ submission, track: selectedTrack.track, isEnglish: draftEnglish }) };
      const generated = buildRadioRequest({ submission, track: selectedTrack.track, program: current.program, isEnglish: draftEnglish });
      const next = buildRadioRequest({ submission, track: selectedTrack.track, program, isEnglish: draftEnglish });
      return { ...previous, [draftKey]: { ...current, program, body: current.body === generated.body ? next.body : current.body } };
    });
    draftRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
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
    <section id={embedded ? undefined : "broadcast-support"} aria-labelledby={`${id}-heading`} className={embedded ? "min-w-0 [overflow-wrap:anywhere]" : "min-w-0 rounded-xl border-2 border-[#111111] bg-card p-4 shadow-[6px_6px_0_#111111] [overflow-wrap:anywhere] sm:p-6 dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]"} data-testid="broadcast-support">
      <div className={embedded ? "sr-only" : "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 sm:gap-3"}>
        <Radio size={24} className="mt-0.5" aria-hidden />
        <h2 id={`${id}-heading`} className="text-base font-black leading-snug sm:text-lg">{isEnglish ? "Get your music on the radio" : "내 음악, 라디오에 신청하기"}</h2>
        <span className="shrink-0 rounded-full bg-[#f2cf27] px-2.5 py-1 text-xs font-bold text-[#111111]">{isEnglish ? "Free" : "무료"}</span>
      </div>
      {!embedded && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{isEnglish ? "Prepare a request for an approved track and post it on a broadcaster's listener board. Airplay is decided by each program." : "적격 곡의 신청 문구를 준비해 방송국 게시판에 직접 올려보세요. 실제 선곡은 각 프로그램에서 결정합니다."}</p>}
      <div className={embedded ? "" : "mt-5"}>
          {selected && selectedTrack ? <>
            <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="mt-4 flex min-w-0 items-start gap-2 rounded-xl border border-emerald-600/20 bg-emerald-600/5 p-3 text-sm">
              <Check size={18} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
              <div className="min-w-0"><p className="font-bold">{broadcastTrackTitle(selectedTrack.track)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedTrack.track.performer || broadcastArtist(submission)} · {selected.review.station?.name || selected.review.station?.code} {isEnglish ? "approved" : "적격"}</p></div>
            </div>
            {embedded && <p className="mt-2 text-xs leading-5 text-muted-foreground">{isEnglish ? "Free request preparation. Approval does not guarantee airplay; each program selects its music." : "신청 준비는 무료입니다. 심의 적격과 별개로 실제 선곡은 각 프로그램에서 결정합니다."}</p>}
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <RadioStationGuideContent stationCode={selected.review.station?.code} stationName={selected.review.station?.name} isEnglish={isEnglish} selectedProgram={drafts[draftKey]?.program} onSelectProgram={selectProgram} />
              <div ref={draftRef} className="min-w-0 scroll-mt-4 rounded-xl border border-border bg-background p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#f2cf27] text-xs font-black text-[#111111]">2</span><h3 className="font-black">{isEnglish ? "Prepare your request" : "신청 문구 준비하기"}</h3></div>
                <div className="mb-5 rounded-lg bg-muted/60 p-3 text-sm leading-6">
                  <p className="font-bold">{isEnglish ? "Artist + song title + your story" : "아티스트명 + 곡명 + 함께 듣고 싶은 이유"}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{isEnglish ? "Add release details or review documents only if the program asks for them. This is a listener request, not a music-delivery or artist booking form." : "발매 정보나 심의 서류는 프로그램에서 요청할 때만 추가하세요. 청취자 신청곡 참여이며, 음원 납품·출연 섭외 접수와는 다릅니다."}</p>
                </div>
                <div className="mb-4"><label htmlFor={`${id}-language`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Draft language" : "신청 문구 언어"}</label><select id={`${id}-language`} value={draftEnglish ? "en" : "ko"} onChange={event => setDraftLanguage(event.target.value as "en" | "ko")} className={controlClass}><option value="ko">한국어</option><option value="en">English</option></select>{stationGuide?.language === "en" && <p className="mt-2 text-xs leading-5 text-muted-foreground">{isEnglish ? "An English template is provided for Arirang. Use your official English artist and track names where available." : "Arirang 참여를 돕기 위해 영문 초안을 제공합니다. 곡명·아티스트명은 등록된 공식 영문명이 있으면 사용합니다."}</p>}</div>
                <RequestDraft key={draftKey} submission={submission} track={selectedTrack.track} isEnglish={isEnglish} draftEnglish={draftEnglish} savedDraft={drafts[draftKey]} onDraftChange={draft => setDrafts(previous => ({ ...previous, [draftKey]: draft }))} />
                <div className="mt-2 border-t border-border pt-4 text-sm leading-6"><p className="font-bold">{isEnglish ? "3. Post on the program’s board" : "3. 프로그램 게시판에서 직접 등록"}</p><p className="mt-1 text-muted-foreground">{isEnglish ? "Paste your title and request, check the board rules and personal information, then submit. Check your post and the playlist afterward." : "제목과 본문을 붙여넣고 공지·개인정보를 확인한 뒤 등록하세요. 이후 자신의 게시글과 선곡표를 확인하면 됩니다."}</p></div>
              </div>
            </div>
          </> : guideOnlyReview ? (
            <div className="space-y-5">
              <p className="rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6">{isEnglish ? "This broadcaster’s approval is recorded, but individual track information is missing, so we cannot fill in a draft. Use the program guides below and enter the exact song and artist names yourself." : "방송국 적격 결과는 확인됐지만 개별 곡 정보가 없어 자동 초안을 만들 수 없습니다. 아래 참여 경로를 이용하고 신청할 곡명과 아티스트명을 직접 적어주세요."}</p>
              <RadioStationGuideContent stationCode={guideOnlyReview.station?.code} stationName={guideOnlyReview.station?.name} isEnglish={isEnglish} />
              <div className="rounded-xl border border-border bg-background p-4 text-sm leading-6"><h3 className="font-black">{isEnglish ? "What to write" : "신청글에는 이렇게 적어주세요"}</h3><p className="mt-2 text-muted-foreground">{isEnglish ? "Include the exact artist and song names, then add two or three sentences about when you want to hear the song or a personal story connected to it. Add release details or review documents only if the program asks for them." : "정확한 아티스트명과 곡명을 적고, 언제 듣고 싶은지 또는 곡과 연결되는 나의 이야기를 2~3문장 덧붙여보세요. 발매 정보·심의 서류는 프로그램에서 요청할 때만 추가하면 됩니다."}</p><p className="mt-3 text-xs text-muted-foreground">{isEnglish ? "Approval and a listener request do not guarantee airplay. Each program selects its music." : "심의 적격과 신청곡 등록이 방송을 보장하지는 않습니다. 실제 선곡은 프로그램에서 결정합니다."}</p></div>
            </div>
          ) : <p className="rounded-lg bg-muted p-4 text-sm leading-relaxed">{isEnglish ? "No approved track is available for a song request yet. Check the review results and any requested corrections above." : "현재 신청곡으로 안내할 적격 곡이 없습니다. 위 심의 결과와 보완 사유를 먼저 확인해주세요."}</p>}
      </div>
      <details className="mt-6 border-t border-border pt-4">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">{isEnglish ? "Preparation checklist & reference pack" : "준비 체크리스트 · 방송 참고자료"}</summary>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <fieldset className="min-w-0 space-y-1">
            <legend className="mb-3 text-xs text-muted-foreground">{isEnglish ? "Check while this page is open" : "현재 화면에서 준비 상태를 체크하세요"}</legend>
            {checks.map(label => <label key={label} className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#1f7a5a]" /><span className="min-w-0">{label}</span></label>)}
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

"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, ExternalLink, Radio } from "lucide-react";
import {
  broadcastTrackTitle,
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
import { resolveRadioBoardLinks } from "@/lib/radio-board-links";

const controlClass = "w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:text-sm";
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

function RequestDraft({ submission, track, review, isEnglish, savedDraft, onDraftChange }: {
  submission: BroadcastSubmission;
  track: BroadcastTrack;
  review: BroadcastReview;
  isEnglish: boolean;
  savedDraft?: RequestDraftState;
  onDraftChange: (draft: RequestDraftState) => void;
}) {
  const id = useId();
  const initial = buildRadioRequest({ submission, track, isEnglish });
  const draft = savedDraft ?? { program: "", ...initial };
  const { program, title, body } = draft;
  const [message, setMessage] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const links = resolveRadioBoardLinks({ stationCode: review.station?.code, stationName: review.station?.name });

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
        <input id={`${id}-program`} value={program} onChange={event => onDraftChange({ ...draft, program: event.target.value })} placeholder={isEnglish ? "Program name for your notes" : "예: 즐겨 듣는 라디오 프로그램"} className={controlClass} maxLength={120} />
      </div>
      <div>
        <label htmlFor={`${id}-title`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Post title" : "게시글 제목"}</label>
        <input ref={titleRef} id={`${id}-title`} value={title} onChange={event => onDraftChange({ ...draft, title: event.target.value })} className={controlClass} maxLength={300} />
      </div>
      <div>
        <label htmlFor={`${id}-body`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Your story and song request" : "사연과 신청곡 문구"}</label>
        <textarea ref={bodyRef} id={`${id}-body`} value={body} onChange={event => onDraftChange({ ...draft, body: event.target.value })} rows={7} maxLength={5000} className={`${controlClass} resize-y`} aria-describedby={`${id}-tip`} />
        <p id={`${id}-tip`} className="mt-2 text-xs leading-relaxed text-muted-foreground">{isEnglish ? "Add your own story or why you want to hear this song." : "이 곡을 함께 듣고 싶은 이유나 자신의 이야기를 덧붙여주세요."}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" className={buttonClass} disabled={!title.trim()} onClick={() => void copy("title")}><Copy size={15} aria-hidden />{isEnglish ? "Copy title" : "제목 복사"}</button>
        <button type="button" className={buttonClass} disabled={!body.trim()} onClick={() => void copy("body")}><Copy size={15} aria-hidden />{isEnglish ? "Copy request" : "본문 복사"}</button>
        <button type="button" className={`${buttonClass} col-span-2`} onClick={() => saveBlob(new Blob([`${program ? `${program}\n\n` : ""}${title}\n\n${body}`], { type: "text/plain;charset=utf-8" }), "onside-radio-request.txt")}><Download size={15} aria-hidden />{isEnglish ? "Save draft" : "초안 저장"}</button>
      </div>
      <p role="status" className="min-h-5 text-xs text-muted-foreground">{message}</p>
      {links.length > 0 ? links.map(link => (
        <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className={`${buttonClass} w-full bg-[#f2cf27] text-[#111111] hover:bg-[#ffe269]`}>
          <ExternalLink size={16} aria-hidden />{isEnglish ? `${review.station?.name || review.station?.code} · official radio site` : link.name}
          <span className="sr-only">{isEnglish ? "(new tab)" : "(새 창)"}</span>
        </a>
      )) : <p className="rounded-lg bg-muted p-3 text-sm">{isEnglish ? "A public request board has not been verified for this broadcaster. Contact the broadcaster for its submission route." : "이 방송국의 공개 신청곡 게시판은 확인되지 않았습니다. 방송국에 참여 경로를 문의해주세요."}</p>}
      {links.length > 0 && <p className="text-xs leading-relaxed text-muted-foreground">{isEnglish ? "Opens the program directory. Choose a current program and its listener board." : "공식 라디오 페이지가 열립니다. 현재 방송 중인 프로그램을 선택한 뒤 ‘사연과 신청곡’ 게시판으로 이동하세요."}</p>}
    </div>
  );
}

export function BroadcastSupportPanel({ submission, stationReviews, isEnglish = false }: {
  submission: BroadcastSubmission;
  stationReviews: BroadcastReview[];
  isEnglish?: boolean;
}) {
  const id = useId();
  const eligible = useMemo(() => stationReviews.map(review => ({ review, tracks: getBroadcastTracks(submission, review).filter(item => item.status === "APPROVED") })).filter(item => item.tracks.length > 0), [submission, stationReviews]);
  const [stationId, setStationId] = useState("");
  const [trackKey, setTrackKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RequestDraftState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = eligible.find(item => item.review.id === stationId) || eligible[0];
  const selectedTrack = selected?.tracks.find(item => item.key === trackKey) || selected?.tracks[0];
  const draftKey = `${submission.id}:${selected?.review.id}:${selectedTrack?.key}:${isEnglish}`;
  const guide = isEnglish ? radioRequestGuideEnglish : radioRequestGuide;
  const checks = isEnglish
    ? ["Checked approval for this track and broadcaster", "Read the program board rules", "Added my story and checked personal information", "Posted on the broadcaster's site myself"]
    : ["해당 방송국의 곡별 적격 결과 확인", "프로그램 게시판 공지 확인", "사연 추가 및 개인정보 확인", "방송국 게시판에서 직접 등록 완료"];

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
    <section id="broadcast-support" aria-labelledby={`${id}-heading`} className="min-w-0 rounded-[10px] border-2 border-[#111111] bg-card p-4 shadow-[6px_6px_0_#111111] [overflow-wrap:anywhere] sm:p-6 dark:border-[#f2cf27] dark:shadow-[6px_6px_0_#f2cf27]" data-testid="broadcast-support">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 sm:gap-3">
        <Radio size={24} className="mt-0.5" aria-hidden />
        <h2 id={`${id}-heading`} className="text-base font-black leading-snug sm:text-lg">{isEnglish ? "Get your music on the radio" : "내 음악, 라디오에 신청하기"}</h2>
        <span className="shrink-0 rounded-full bg-[#f2cf27] px-2.5 py-1 text-xs font-bold text-[#111111]">{isEnglish ? "Free" : "무료"}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{isEnglish ? "Prepare a request for an approved track and post it on a broadcaster's listener board. Airplay is decided by each program." : "적격 곡의 신청 문구를 준비해 방송국 게시판에 직접 올려보세요. 실제 선곡은 각 프로그램에서 결정합니다."}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {selected && selectedTrack ? <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor={`${id}-station`} className="mb-1.5 block text-sm font-semibold">{isEnglish ? "Approved broadcaster" : "적격 방송국"}</label>
                <select id={`${id}-station`} className={controlClass} value={selected.review.id} onChange={event => { setStationId(event.target.value); setTrackKey(""); }}>
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
            <RequestDraft key={draftKey} submission={submission} track={selectedTrack.track} review={selected.review} isEnglish={isEnglish} savedDraft={drafts[draftKey]} onDraftChange={draft => setDrafts(previous => ({ ...previous, [draftKey]: draft }))} />
          </> : <p className="rounded-lg bg-muted p-4 text-sm leading-relaxed">{isEnglish ? "No approved track is available for a song request yet. Check the review results and any requested corrections above." : "현재 신청곡으로 안내할 적격 곡이 없습니다. 위 심의 결과와 보완 사유를 먼저 확인해주세요."}</p>}
        </div>
        <aside className="min-w-0 rounded-lg bg-muted/50 p-4 sm:p-5">
          <h3 className="font-bold">{isEnglish ? "How to request a song" : "게시판 신청 가이드"}</h3>
          <ol className="mt-4 space-y-4">
            {guide.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-relaxed"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">{index + 1}</span><span>{step}</span></li>)}
          </ol>
          <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">{isEnglish ? "Use one relevant board per program. Your post stays on the broadcaster's site; onside does not submit it automatically." : "프로그램에 맞는 게시판을 선택하고 같은 글의 반복 등록은 피해주세요. 이 화면에서는 글이 자동 등록되지 않습니다."}</p>
        </aside>
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

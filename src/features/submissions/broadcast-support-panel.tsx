"use client";

import { useId, useMemo, useState } from "react";
import { Download, Radio } from "lucide-react";
import { buildBroadcastCredits, buildBroadcastResultCsv, getBroadcastTracks, radioRequestGuide, radioRequestGuideEnglish, type BroadcastReview, type BroadcastSubmission } from "@/lib/broadcast-support";
import { normalizeTrackResults } from "@/lib/track-results";
import { RadioRequestWizard, radioButtonClass, type RadioRequestCandidate } from "./radio-request-wizard";

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

export function BroadcastSupportPanel({ submission, stationReviews, isEnglish = false, embedded = false }: {
  submission: BroadcastSubmission;
  stationReviews: BroadcastReview[];
  isEnglish?: boolean;
  embedded?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const candidates = useMemo(() => stationReviews.flatMap<RadioRequestCandidate>(review => {
    const reviewed = getBroadcastTracks(submission, review);
    const tracks = reviewed.filter(item => item.status === "APPROVED");
    if (tracks.length) return [{ review, tracks, manual: false }];
    // An old station-level approval can help prepare text, but cannot establish
    // approval for a user-entered song. The wizard labels that distinction.
    if (!submission.album_tracks?.length && !normalizeTrackResults(review.track_results).length && review.status.trim().toUpperCase() === "APPROVED") return [{ review, tracks: [], manual: true }];
    return [];
  }), [submission, stationReviews]);

  async function downloadPack() {
    setBusy(true); setError("");
    try {
      const { default: PizZip } = await import("pizzip");
      const zip = new PizZip();
      const guide = isEnglish ? radioRequestGuideEnglish : radioRequestGuide;
      zip.file("01-credits.txt", buildBroadcastCredits(submission));
      zip.file("02-station-results.csv", buildBroadcastResultCsv(submission, stationReviews));
      zip.file("03-radio-guide.txt", [...guide.map((step, index) => `${index + 1}. ${step}`), "", isEnglish ? "Approval and song requests do not guarantee airplay. This pack contains text information only; original audio/video files and certificates are not included." : "심의 적격과 신청곡 등록은 방송 편성을 보장하지 않습니다. 이 묶음은 텍스트 자료이며 원본 음원·영상·증명서는 포함하지 않습니다."].join("\n"));
      saveBlob(zip.generate({ type: "blob", compression: "DEFLATE" }), "onside-broadcast-kit.zip");
    } catch { setError(isEnglish ? "Download failed. Please try again." : "자료를 내려받지 못했습니다. 다시 시도해주세요."); }
    finally { setBusy(false); }
  }

  return <section id={embedded ? undefined : "broadcast-support"} aria-labelledby={`${id}-heading`} className={embedded ? "min-w-0 [overflow-wrap:anywhere]" : "min-w-0 rounded-2xl border border-slate-200 bg-white p-4 [overflow-wrap:anywhere] sm:p-6 dark:border-slate-800 dark:bg-slate-950"} data-testid="broadcast-support" data-no-translate>
    <h2 id={`${id}-heading`} className={embedded ? "sr-only" : "mb-4 flex items-center gap-2 text-base font-semibold sm:text-lg"}><Radio size={20} className="shrink-0 text-[#1556a4] dark:text-blue-300" aria-hidden />{isEnglish ? "Get your music on the radio" : "내 음악, 라디오에 신청하기"}</h2>
    {candidates.length ? <RadioRequestWizard submission={submission} candidates={candidates} isEnglish={isEnglish} /> : <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600 dark:bg-slate-900 dark:text-slate-300">{isEnglish ? "No approved track is available for a song request yet. Check the review results and any requested corrections above." : "현재 신청곡으로 안내할 적격 곡이 없습니다. 위 심의 결과와 보완 사유를 먼저 확인해주세요."}</p>}
    <details className="mt-6 border-t border-slate-200 pt-2 dark:border-slate-800">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-slate-600 dark:text-slate-300">{isEnglish ? "Review records & reference pack" : "심의 기록 · 방송 참고자료"}</summary>
      <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{isEnglish ? "Download registered song credits, station review results and a request guide. Manually entered song names and request drafts are not included. Original audio/video and certificates are not included." : "등록된 곡 정보·크레딧, 방송국별 결과표, 신청 가이드를 내려받습니다. 직접 입력한 곡명과 신청 초안, 원본 음원·영상·증명서는 포함되지 않습니다."}</p>
      <button type="button" onClick={() => void downloadPack()} disabled={busy} className={`${radioButtonClass} mt-3 w-full sm:w-auto`}><Download size={16} aria-hidden />{busy ? (isEnglish ? "Preparing…" : "자료 준비 중…") : (isEnglish ? "Download reference ZIP" : "참고자료 ZIP 다운로드")}</button>
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </details>
  </section>;
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { ArchiveCommand, ArchiveRelease, ArchiveTask, ArchiveTrack } from "@/lib/music-archive/model";
import type { AgencyGuide } from "@/lib/music-archive/guides";
import { buildArchiveReviewEntryHref } from "@/lib/music-archive/review-entry-url";
import type { LibraryDetail } from "./types";
import { Badge, Button, External, Modal, panelClass } from "./ui";
import { OnsideResultPopup } from "./onside-result-popup";
import { MemberRecordEditor } from "./member-record-editor";

export type MemberMusicTab = "review" | "copyright" | "performer" | "karaoke";
const labels: Record<MemberMusicTab, string> = { review: "심의", copyright: "저작권 등록", performer: "실연자 등록", karaoke: "노래방" };
const institutions: Record<Exclude<MemberMusicTab, "review">, { id: string; label: string; fallback: string }[]> = {
  copyright: [{ id: "komca", label: "한국음악저작권협회", fallback: "https://www.komca.or.kr/" }, { id: "koscap", label: "함께하는음악저작인협회", fallback: "https://www.koscap.or.kr/" }],
  performer: [{ id: "fkmp", label: "한국음악실연자연합회", fallback: "https://www.fkmp.kr/" }],
  karaoke: [{ id: "tj", label: "TJ미디어", fallback: "https://www.tjmedia.com/song/accompaniment_apply" }, { id: "ky", label: "금영", fallback: "https://www.kyentertainment.kr/bbs/board.php?bo_table=qa_song" }],
};
const matchesTab = (task: ArchiveTask, tab: MemberMusicTab) => tab === "copyright" ? ["copyright_work", "copyright_legal"].includes(task.kind) : task.kind === tab;
function latestRecords(records: ArchiveTask[]) {
  const latest = new Map<string, ArchiveTask>();
  for (const task of records) latest.set(JSON.stringify([task.trackId, task.kind, task.agency, task.participant || "", task.role || ""]), task);
  return [...latest.values()];
}
function taskLabel(task: ArchiveTask, tab: MemberMusicTab) {
  if (tab === "review") {
    if (task.result === "eligible") return "적격";
    if (["ineligible", "rejected"].includes(task.result)) return "부적격";
    if (task.status === "completed") return "심의 완료";
    if (["submitted", "processing", "preparing", "needs_changes"].includes(task.status)) return "심의 진행 중";
    return task.status === "not_started" ? "심의 미진행" : "확인 필요";
  }
  if (tab === "karaoke") {
    if (task.result === "listed") return "수록됨";
    if (task.result === "not_listed") return "미수록";
  } else if (["approved", "information_found"].includes(task.result)) return "등록됨";
  if (["submitted", "processing", "preparing", "needs_changes"].includes(task.status)) return "신청 중";
  if (task.status === "rejected" || task.result === "rejected") return "반려";
  return task.status === "not_started" ? "미등록" : "확인 필요";
}

export function memberReviewStatus(detail: LibraryDetail, releaseId: string, trackId?: string): string {
  const tracks = detail.library.data.tracks.filter((item) => item.releaseId === releaseId && (!trackId || item.id === trackId) && item.managed && !item.excluded && !item.mergedInto);
  const trackIds = new Set(tracks.map((item) => item.id));
  const onside = (detail.onsideReviews ?? []).filter((item) => item.releaseId === releaseId && (!trackId || !item.trackIds.length || item.trackIds.includes(trackId)));
  const records = latestRecords(detail.library.data.tasks.filter((item) => item.kind === "review" && trackIds.has(item.trackId)));
  if (onside.length) {
    const completed = onside.filter((item) => ["COMPLETED", "APPROVED", "REJECTED"].includes(item.status));
    const covered = new Set(completed.flatMap((item) => item.trackIds.length ? item.trackIds : [...trackIds]));
    if (completed.length && (tracks.length ? tracks.every((item) => covered.has(item.id)) : completed.some((item) => !item.trackIds.length))) return "심의 완료";
    if (completed.length) return "일부 심의 완료";
    return onside.every((item) => ["SUBMITTED", "WAITING_PAYMENT", "DRAFT", "PRE_REVIEW"].includes(item.status)) ? "접수·결제 진행 중" : "심의 진행 중";
  }
  const completed = new Set(records.filter((item) => item.status === "completed" || ["eligible", "ineligible", "rejected"].includes(item.result)).map((item) => item.trackId));
  if (completed.size) return completed.size === tracks.length ? "심의 완료" : "일부 심의 완료";
  if (records.some((item) => ["submitted", "processing", "preparing", "needs_changes"].includes(item.status))) return "심의 진행 중";
  if (records.length && records.every((item) => item.status === "not_started")) return "심의 미진행";
  return "심의 정보 없음";
}

export function MemberMusicStatus({ detail, release, track, tab, guides, busy, reviewOpenRequest, onSave, onRefreshMetadata }: {
  detail: LibraryDetail; release: ArchiveRelease; track?: ArchiveTrack; tab: MemberMusicTab; guides: AgencyGuide[]; busy: boolean; reviewOpenRequest: number;
  onSave: (body: { action: "commands"; commands: ArchiveCommand[] }) => Promise<void>;
  onRefreshMetadata: () => Promise<void>;
}) {
  const data = detail.library.data;
  const tracks = (track ? [track] : data.tracks.filter((item) => item.releaseId === release.id)).filter((item) => item.managed && !item.excluded && !item.mergedInto);
  const trackIds = new Set(tracks.map((item) => item.id));
  const records = latestRecords(data.tasks.filter((item) => trackIds.has(item.trackId) && matchesTab(item, tab)));
  const onside = (detail.onsideReviews ?? []).filter((item) => item.releaseId === release.id && (!track || !item.trackIds.length || item.trackIds.includes(track.id)));
  const submissionIds = [...new Set(onside.map((item) => item.submissionId))];
  const [editing, setEditing] = useState<{ initial?: ArchiveTask } | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const idsKey = submissionIds.join(",");
  useEffect(() => { if (tab === "review" && reviewOpenRequest > 0 && idsKey) { const handle = setTimeout(() => setShowResult(true), 0); return () => clearTimeout(handle); } }, [tab, reviewOpenRequest, idsKey]);
  const workIds = new Set(data.recordings.filter((recording) => tracks.some((item) => item.recordingId === recording.id)).flatMap((recording) => recording.workIds));
  const works = tab === "copyright" ? data.works.filter((work) => workIds.has(work.id) && (work.writers || work.contributors?.length || work.institutionNumbers.length)) : [];
  const localePrefix = typeof window !== "undefined" && window.location.pathname.startsWith("/en/") ? "/en" : "";
  const registered = records.some((item) => ["approved", "information_found", "listed"].includes(item.result)) || works.some((work) => work.institutionNumbers.length);
  const finishedReviewIds = new Set(records.filter((item) => item.status === "completed" || ["eligible", "ineligible", "rejected"].includes(item.result)).map((item) => item.trackId));
  const reviewSummary = memberReviewStatus(detail, release.id, track?.id);
  return <section className={`${panelClass} space-y-5`} aria-label={`${labels[tab]} 정보`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-black">{labels[tab]}</h3><Badge>{tab === "review" ? reviewSummary : registered ? (tab === "karaoke" ? "수록 정보 있음" : "등록 정보 있음") : tab === "copyright" && works.length ? "저작자 정보 있음" : records.length ? "확인 필요" : "등록 정보 없음"}</Badge></div>
    {tab === "review" ? <>
      {onside.length > 0 ? <div className="flex justify-end"><Button primary onClick={() => setShowResult(true)}>심의 결과 보기</Button></div> : <>
        {records.length > 0 && <div className="space-y-3">{records.map((item) => <Record key={item.id} task={item} tab={tab} trackTitle={!track ? tracks.find((track) => track.id === item.trackId)?.title : undefined} onEdit={() => setEditing({ initial: item })} />)}</div>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">{!finishedReviewIds.size && <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-foreground bg-foreground px-4 py-2 text-sm font-bold text-background" href={buildArchiveReviewEntryHref({ libraryId: detail.library.id, releaseId: release.id, trackId: track?.id, localePrefix })}>온사이드에 심의 신청</Link>}<Button primary={!!finishedReviewIds.size} disabled={busy || !tracks.length} onClick={() => setEditing({})}>심의 내역 입력</Button></div>
      </>}
    </> : <>
      {works.length > 0 && <div className="space-y-3">{works.map((work) => <div key={work.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">{!track && <p className="font-bold">{work.title}</p>}{work.contributors?.length ? <div className="space-y-1">{(["lyrics", "composition", "arrangement"] as const).map(role => { const people = work.contributors!.filter(person => person.role === role); return people.length ? <p key={role}><span className="mr-2 font-semibold">{{ lyrics: "작사", composition: "작곡", arrangement: "편곡" }[role]}</span>{people.map(person => person.name).join(", ")}</p> : null; })}</div> : work.writers && <p>{work.writers}</p>}{work.institutionNumbers.map((entry) => <p key={`${entry.agency}-${entry.number}`} className="text-muted-foreground">{entry.agency} · {entry.number}</p>)}</div>)}</div>}
      {records.length > 0 && <div className="space-y-3">{records.map((item) => <Record key={item.id} task={item} tab={tab} trackTitle={!track ? tracks.find((track) => track.id === item.trackId)?.title : undefined} onEdit={() => setEditing({ initial: item })} />)}</div>}
      {!registered && <div className="flex flex-wrap gap-2">{institutions[tab].map((institution) => {
        const guide = guides.find((item) => item.id === institution.id && item.visible);
        return <a key={institution.id} href={guide?.applyUrl || guide?.url || institution.fallback} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-sm font-bold hover:border-foreground">{institution.label}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden /></a>;
      })}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><button type="button" className="min-h-10 text-xs text-muted-foreground underline underline-offset-4" onClick={() => setShowGuide(true)}>등록 방법</button><div className="ml-auto flex flex-wrap justify-end gap-2">{tab === "copyright" && <Button disabled={busy} onClick={() => { void onRefreshMetadata().catch(() => {}); }}><RefreshCw className="h-4 w-4" aria-hidden />저작자 정보 다시 가져오기</Button>}<Button primary disabled={busy || !tracks.length} onClick={() => setEditing({})}>{tab === "karaoke" ? "수록 정보 입력" : "등록 정보 입력"}</Button></div></div>
    </>}
    {editing && <Modal title={`${tab === "review" ? "심의 내역" : tab === "karaoke" ? "수록 정보" : "등록 정보"} ${editing.initial ? "수정" : "입력"}`} onClose={() => { if (!busy) setEditing(null); }}><MemberRecordEditor tab={tab} tracks={tracks} data={data} initial={editing.initial} busy={busy} onCancel={() => setEditing(null)} onSave={async (commands) => { await onSave({ action: "commands", commands }); setEditing(null); }} /></Modal>}
    {showResult && <OnsideResultPopup submissionIds={submissionIds} onClose={() => setShowResult(false)} title="심의 결과" localePrefix={localePrefix} />}
    {showGuide && tab !== "review" && <Modal title={`${labels[tab]} 방법`} onClose={() => setShowGuide(false)}><ol className="list-decimal space-y-3 pl-5 text-sm leading-6">{tab === "copyright" ? <><li>가입한 저작권 협회에서 작품명과 저작자 정보를 확인하세요.</li><li>등록되지 않은 작품은 협회 안내에 따라 작품 등록을 신청하세요.</li><li>등록이 완료되면 작품번호와 저작자 정보를 여기에 저장하세요.</li></> : tab === "performer" ? <><li>음실련에서 본인의 참여 음원과 실연 정보를 확인하세요.</li><li>미등록 음원은 참여자·역할과 함께 실연 정보 등록을 신청하세요.</li><li>등록 완료 후 확인번호와 참여 정보를 여기에 저장하세요.</li></> : <><li>TJ 또는 금영에서 곡명과 가수로 수록 여부를 확인하세요.</li><li>수록되지 않은 곡은 해당 업체의 신청 안내에 따라 진행하세요.</li><li>실제 수록되면 업체별 곡번호를 여기에 저장하세요.</li></>}</ol><div className="flex flex-wrap gap-4">{institutions[tab].map((institution) => { const guide = guides.find((item) => item.id === institution.id && item.visible); return <External key={institution.id} href={guide?.url || institution.fallback}>{institution.label} 안내</External>; })}</div></Modal>}
  </section>;
}

function Record({ task, tab, trackTitle, onEdit }: { task: ArchiveTask; tab: MemberMusicTab; trackTitle?: string; onEdit: () => void }) {
  return <article className="rounded-lg border border-border p-3 text-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0 space-y-1">{trackTitle && <h4 className="break-words font-bold">{trackTitle}</h4>}<p className="font-semibold">{task.agency} · {taskLabel(task, tab)}</p>{(task.participant || task.role) && <p>{[task.participant, task.role].filter(Boolean).join(" · ")}</p>}{tab !== "review" && (task.songNumber || task.referenceNumber) && <p className="text-muted-foreground">{tab === "karaoke" ? "곡번호" : "등록번호"} {task.songNumber || task.referenceNumber}</p>}{task.completedDate && <p className="text-muted-foreground">{task.completedDate}</p>}{task.memo && <p className="whitespace-pre-wrap break-words">{tab === "review" && ["ineligible", "rejected"].includes(task.result) && <span className="font-semibold">부적격 사유: </span>}{task.memo}</p>}</div><button type="button" onClick={onEdit} className="min-h-10 shrink-0 px-2 text-xs font-semibold underline underline-offset-4">수정</button></div></article>;
}

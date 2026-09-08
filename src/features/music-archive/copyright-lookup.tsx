"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { prepareCopyrightLookup, type CopyrightAgency } from "@/lib/music-archive/copyright-providers";
import type { ArchiveData, ArchiveTrack } from "@/lib/music-archive/model";
import { Button, External, Field, Notice, inputClass, panelClass } from "./ui";

export type CopyrightRecordDraft = { trackId: string; agency: string; participant: string };
export function CopyrightLookup({ data, tracks, onRecord }: { data: ArchiveData; tracks: ArchiveTrack[]; onRecord: (draft: CopyrightRecordDraft) => void }) {
  const [trackId, setTrackId] = useState(tracks[0]?.id ?? "");
  const selected = tracks.find((track) => track.id === trackId);
  const recording = data.recordings.find((recording) => recording.id === selected?.recordingId);
  const work = data.works.find((work) => recording?.workIds.includes(work.id));
  const [title, setTitle] = useState(work?.title ?? selected?.title ?? "");
  const [writer, setWriter] = useState(work?.writers ?? "");
  const [agency, setAgency] = useState<CopyrightAgency>("komca");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  let prepared: ReturnType<typeof prepareCopyrightLookup> | null = null;
  try { prepared = prepareCopyrightLookup({ agency, title, writer }); } catch { /* The link appears only with valid search fields. */ }
  function chooseTrack(id: string) {
    const next = tracks.find((track) => track.id === id);
    const recording = data.recordings.find((recording) => recording.id === next?.recordingId);
    const work = data.works.find((work) => recording?.workIds.includes(work.id));
    setTrackId(id); setTitle(work?.title ?? next?.title ?? ""); setWriter(work?.writers ?? ""); setCopied(false); setError("");
  }
  return <section className={`${panelClass} space-y-4`} aria-label="음악저작물 공식 검색">
    <div><h3 className="font-black">음악저작물 찾아보기</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">곡 제목과 작사·작곡자를 확인한 뒤 관리기관의 공식 검색에서 작품을 찾아보세요.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      {tracks.length > 1 && <Field label="조회할 트랙"><select className={inputClass} value={trackId} onChange={(event) => chooseTrack(event.target.value)}>{tracks.map((track) => <option key={track.id} value={track.id}>{track.discNumber}-{track.trackNumber}. {track.title}</option>)}</select></Field>}
      <Field label="검색할 관리기관"><select className={inputClass} value={agency} onChange={(event) => setAgency(event.target.value as CopyrightAgency)}><option value="komca">한국음악저작권협회 (KOMCA)</option><option value="koscap">함께하는음악저작인협회 (KOSCAP)</option></select></Field>
      <Field label="검색할 작품명"><input className={inputClass} value={title} maxLength={200} onChange={(event) => { setTitle(event.target.value); setCopied(false); }} placeholder="곡 제목" /></Field>
      <Field label="검색할 저작자명" hint="가수의 활동명과 작사·작곡자의 이름은 다를 수 있습니다."><input className={inputClass} value={writer} maxLength={200} onChange={(event) => { setWriter(event.target.value); setCopied(false); }} placeholder="작사자 또는 작곡자" /></Field>
    </div>
    {error && <Notice error>{error}</Notice>}
    <div className="flex flex-wrap items-center gap-3"><Button disabled={!prepared} onClick={() => { if (!prepared) return; void navigator.clipboard.writeText(prepared.copyText).then(() => { setCopied(true); setError(""); }).catch(() => setError("화면의 작품명과 저작자명을 직접 복사해 주세요.")); }}><Copy className="h-4 w-4" aria-hidden />{copied ? "검색어 복사됨" : "검색어 복사"}</Button>{prepared && <External href={prepared.officialUrl}>{agency.toUpperCase()}에서 작품 검색</External>}<Button disabled={!selected?.managed || selected.excluded || !!selected.mergedInto} onClick={() => onRecord({trackId,agency:agency.toUpperCase(),participant:writer.trim()})}>확인한 내역 기록</Button></div>
    <p className="text-xs leading-5 text-muted-foreground">검색 결과의 작품명·저작자·작품번호를 비교한 후 내 기록에 남겨 주세요. 검색 페이지를 열어도 업무 상태는 바뀌지 않습니다.</p>
  </section>;
}

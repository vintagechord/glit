"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ArchiveCommand, ArchiveData, ArchiveTask, ArchiveTaskFields, ArchiveTrack } from "@/lib/music-archive/model";
import { stationLogoSources } from "@/lib/station-logos";
import type { MemberMusicTab } from "./member-music-status";
import { Button, Field, Notice, inputClass } from "./ui";

const agencies = { copyright: ["KOMCA", "KOSCAP"], performer: ["한국음악실연자연합회"], karaoke: ["TJ", "금영"] };
const writerRoles = ["작사", "작곡", "편곡"];
const roleNames: Record<string, string> = { lyrics: "작사", composition: "작곡", arrangement: "편곡" };
type Participant = { id: string; name: string; role: string };
const participant = (name = "", role = "") => ({ id: crypto.randomUUID(), name, role });

export function MemberRecordEditor({ tab, tracks, data, initial, busy, onSave, onCancel }: {
  tab: MemberMusicTab; tracks: ArchiveTrack[]; data: ArchiveData; initial?: ArchiveTask; busy: boolean;
  onSave: (commands: ArchiveCommand[]) => Promise<void>; onCancel: () => void;
}) {
  const firstTrack = initial?.trackId ?? (tracks.length === 1 ? tracks[0].id : tab === "review" ? "all" : "");
  function writersFor(trackId: string): Participant[] {
    const recordingId = tracks.find(item => item.id === trackId)?.recordingId;
    const workIds = data.recordings.find(item => item.id === recordingId)?.workIds ?? [];
    const credits = data.works.filter(item => workIds.includes(item.id)).flatMap(item => item.contributors ?? []);
    return credits.length ? credits.map(item => participant(item.name, roleNames[item.role])) : writerRoles.map(role => participant("", role));
  }
  const [selected, setSelected] = useState(firstTrack);
  const [agency, setAgency] = useState(initial?.agency ?? (tab === "review" ? "KBS" : agencies[tab][0]));
  const stations = [...new Set([...stationLogoSources.map(item => item.alt), "기타 방송사", ...(initial?.agency ? [initial.agency] : [])])];
  const [selectedStations, setSelectedStations] = useState([initial?.agency ?? "KBS"]);
  const [result, setResult] = useState<"eligible" | "ineligible">(["ineligible", "rejected"].includes(initial?.result ?? "") ? "ineligible" : "eligible");
  const [participants, setParticipants] = useState<Participant[]>(() => initial
    ? [participant(initial.participant ?? "", initial.role ?? (tab === "copyright" ? "작곡" : ""))]
    : tab === "copyright" ? writersFor(firstTrack) : [participant()]);
  const [number, setNumber] = useState((tab === "karaoke" ? initial?.songNumber : initial?.referenceNumber) ?? "");
  const [date, setDate] = useState(initial?.completedDate ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [error, setError] = useState("");
  const hasParticipants = tab === "copyright" || tab === "performer";
  const updateParticipant = (id: string, patch: Partial<Participant>) => setParticipants(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  async function save() {
    if (busy) return;
    setError("");
    try {
      const ids = selected === "all" ? tracks.map(item => item.id) : [selected];
      if (!selected || !ids.length) throw new Error("음원을 선택해 주세요.");
      if (tab === "review" && !selectedStations.length) throw new Error("방송사를 하나 이상 선택해 주세요.");
      if (tab === "review" && result === "ineligible" && !memo.trim()) throw new Error("부적격 사유를 입력해 주세요.");
      const people = participants.filter(row => row.name.trim());
      if (hasParticipants && (!people.length || people.some(row => !row.role.trim()))) throw new Error(tab === "copyright" ? "저작자 이름과 작사·작곡·편곡 역할을 입력해 주세요." : "실연자 이름과 연주 악기 또는 참여 역할을 입력해 주세요.");
      if (new Set(people.map(row => JSON.stringify([row.name.trim(), row.role.trim()]))).size !== people.length) throw new Error("같은 이름과 역할이 중복되어 있습니다.");
      const base: ArchiveTaskFields = {
        kind: initial?.kind ?? (tab === "copyright" ? "copyright_work" : tab), agency,
        status: "completed", result: tab === "review" ? result : tab === "karaoke" ? "listed" : "approved",
        completedDate: date || undefined, memo: tab === "review" && result === "eligible" ? "" : memo.trim(),
        ...(tab === "review" ? { referenceNumber: "" } : tab === "karaoke" ? { songNumber: number.trim() } : { referenceNumber: number.trim() }),
      };
      const entries = tab === "review" ? selectedStations.map(station => ({ ...base, agency: station }))
        : hasParticipants ? people.map(row => ({ ...base, participant: row.name.trim(), role: row.role.trim() })) : [base];
      const commands: ArchiveCommand[] = entries.map((task, index) => initial && index === 0
        ? { type: "update_task", taskId: initial.id, patch: task }
        : { type: "save_tasks", id: crypto.randomUUID(), trackIds: ids, task });
      await onSave(commands);
    } catch (error) { setError(error instanceof Error ? error.message : "저장하지 못했습니다."); }
  }
  return <form className="space-y-5" onSubmit={event => { event.preventDefault(); void save(); }}>
    {error && <Notice error>{error}</Notice>}
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      {tracks.length > 1 && <Field label="음원"><select className={inputClass} value={selected} disabled={!!initial} onChange={event => { setSelected(event.target.value); if (tab === "copyright") setParticipants(writersFor(event.target.value)); }} required><option value="">음원 선택</option>{tab === "review" && <option value="all">앨범 전체 ({tracks.length}곡)</option>}{tracks.map(item => <option key={item.id} value={item.id}>{item.trackNumber}. {item.title}{item.version ? ` (${item.version})` : ""}</option>)}</select></Field>}
      {tab === "review" ? <>
        <fieldset className="min-w-0 space-y-3"><legend className="mb-2 text-sm font-bold">방송사</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted px-3 text-sm font-bold"><input type="checkbox" className="h-4 w-4 accent-foreground" checked={selectedStations.length === stations.length} onChange={event => setSelectedStations(event.target.checked ? stations : [])} />방송사 전체 선택<span className="ml-auto text-xs text-muted-foreground">{selectedStations.length}곳 선택</span></label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{stations.map(station => <label key={station} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selectedStations.includes(station) ? "border-foreground bg-muted font-semibold" : "border-border"}`}><input type="checkbox" className="h-4 w-4 shrink-0 accent-foreground" checked={selectedStations.includes(station)} onChange={event => setSelectedStations(current => event.target.checked ? [...current, station] : current.filter(item => item !== station))} />{station}</label>)}</div>
          <p className="text-xs text-muted-foreground">같은 심의 결과를 받은 방송사를 함께 선택하세요.</p>
        </fieldset>
        <Field label="심의 결과"><select className={inputClass} value={result} onChange={event => setResult(event.target.value as typeof result)}><option value="eligible">적격</option><option value="ineligible">부적격</option></select></Field>
        {result === "ineligible" && <Field label="부적격 사유"><textarea className={inputClass} rows={3} required value={memo} onChange={event => setMemo(event.target.value)} maxLength={4000} placeholder="방송사에서 안내받은 부적격 사유를 입력해 주세요." /></Field>}
      </> : <Field label={tab === "karaoke" ? "업체" : "협회"}><select className={inputClass} value={agency} onChange={event => setAgency(event.target.value)}>{[...new Set([...agencies[tab], ...(initial?.agency ? [initial.agency] : [])])].map(item => <option key={item} value={item}>{item}</option>)}</select></Field>}
      {hasParticipants && <fieldset className="min-w-0 space-y-3"><legend className="mb-2 text-sm font-bold">{tab === "copyright" ? "저작자 정보" : "실연자 · 연주자 정보"}</legend>
        <p className="text-xs leading-5 text-muted-foreground">{tab === "copyright" ? "작사·작곡·편곡에 참여한 저작자를 입력하세요. 같은 역할에 여러 명을 추가할 수 있고, 해당 없는 역할은 비워두세요." : "연주자별 이름과 악기를 입력하세요. 보컬·코러스 참여자도 함께 추가할 수 있습니다."}</p>
        {participants.map((row, index) => <div key={row.id} className="flex items-end gap-2 rounded-lg border border-border p-3"><div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2"><Field label={`${tab === "copyright" ? "저작자" : "실연자"} ${index + 1}`}><input className={inputClass} value={row.name} onChange={event => updateParticipant(row.id, { name: event.target.value })} maxLength={500} placeholder="이름" /></Field><Field label={tab === "copyright" ? `역할 ${index + 1}` : `악기 / 역할 ${index + 1}`}>{tab === "copyright" ? <select className={inputClass} value={row.role} onChange={event => updateParticipant(row.id, { role: event.target.value })}>{[...new Set([...writerRoles, ...(row.role ? [row.role] : [])])].map(role => <option key={role}>{role}</option>)}</select> : <input className={inputClass} value={row.role} onChange={event => updateParticipant(row.id, { role: event.target.value })} maxLength={500} placeholder="기타, 피아노, 드럼, 보컬 등" />}</Field></div><Button aria-label={`${tab === "copyright" ? "저작자" : "실연자"} ${index + 1} 삭제`} disabled={participants.length === 1} onClick={() => setParticipants(rows => rows.filter(item => item.id !== row.id))}><Trash2 className="h-4 w-4" aria-hidden /></Button></div>)}
        <div className="flex justify-end"><Button disabled={participants.length >= 100} onClick={() => setParticipants(rows => [...rows, participant("", tab === "copyright" ? "작곡" : "")])}><Plus className="h-4 w-4" aria-hidden />{tab === "copyright" ? "저작자 추가" : "실연자 추가"}</Button></div>
      </fieldset>}
      <div className={`grid gap-4 ${tab === "review" ? "" : "sm:grid-cols-2"}`}>
        {tab !== "review" && <Field label={tab === "karaoke" ? "곡번호" : "등록번호 (선택)"}><input className={inputClass} value={number} onChange={event => setNumber(event.target.value)} maxLength={500} required={tab === "karaoke"} /></Field>}
        <Field label={tab === "review" ? "심의일 (선택)" : tab === "karaoke" ? "수록일 (선택)" : "등록일 (선택)"}><input className={inputClass} type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
      </div>
      {tab !== "review" && <Field label="메모 (선택)"><textarea className={inputClass} rows={2} value={memo} onChange={event => setMemo(event.target.value)} maxLength={4000} /></Field>}
    </fieldset>
    <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card py-3"><Button disabled={busy} onClick={onCancel}>취소</Button><Button primary type="submit" className="min-w-28" disabled={busy || !selected}>{busy ? "저장 중…" : "저장"}</Button></div>
  </form>;
}

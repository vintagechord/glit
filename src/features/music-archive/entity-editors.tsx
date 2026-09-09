"use client";
import { useState } from "react";
import { type ArchiveCommand, type ArchiveData, type ArchiveRelease, type ArchiveTrack, type ArchiveAffiliation, type ServiceLink } from "@/lib/music-archive/model";
import { parseMusicProviderUrl } from "@/lib/music-archive/providers";
import { isDomesticMusicProvider, providerNames, releaseLabels } from "./types";
import { Button, External, Field, inputClass, Notice } from "./ui";

export function LinksEditor({ kind, value, onChange }: { kind: "artist" | "release" | "track"; value: ServiceLink[]; onChange: (links: ServiceLink[]) => void }) {
  const [url, setUrl] = useState(""); const [error, setError] = useState("");
  return <div className="space-y-2"><strong className="text-sm">음악 서비스 링크</strong>{value.map((link, index) => <div key={`${link.url}-${index}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3"><External href={link.url}>{providerNames[link.provider] || link.provider}</External><Button aria-label={`${providerNames[link.provider] || link.provider} 링크 제거`} onClick={() => onChange(value.filter((_, i) => i !== index))}>제거</Button></div>)}<div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label="추가할 음악 서비스 링크"><input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} placeholder="https://…" /></Field></div><Button onClick={() => { const parsed = parseMusicProviderUrl(url, kind); if (!parsed || (!isDomesticMusicProvider(parsed.provider) && parsed.provider !== "apple")) { setError("멜론·지니뮤직·벅스 또는 Apple Music 한국 페이지 주소를 입력해 주세요."); return; } onChange([...value.filter((link) => link.url !== parsed.url), { provider: parsed.provider, url: parsed.url, externalId: parsed.externalId }]); setUrl(""); setError(""); }}>링크 추가</Button></div>{error && <Notice error>{error}</Notice>}<p className="text-xs text-muted-foreground">음악을 확인할 수 있는 페이지를 저장합니다. 앨범과 트랙 정보는 따로 추가·수정할 수 있습니다.</p></div>;
}

export function EntityEditor({ data, kind, release, track, busy, onSave }: { data: ArchiveData; kind: "artist" | "release" | "track"; release?: ArchiveRelease; track?: ArchiveTrack; busy: boolean; onSave: (commands: ArchiveCommand[]) => Promise<void> }) {
  const [title, setTitle] = useState(kind === "artist" ? data.artist.name : track?.title ?? (kind === "track" ? "" : release?.title) ?? "");
  const [artistName, setArtistName] = useState(track?.artistName ?? release?.artistName ?? data.artist.name);
  const [version, setVersion] = useState(track?.version ?? release?.version ?? "");
  const [releaseType, setReleaseType] = useState<ArchiveRelease["type"]>(release?.type ?? "album");
  const [releaseDate, setReleaseDate] = useState(release?.releaseDate ?? "");
  const editableAlbumLink = release?.links.find(link => ["melon", "genie"].includes(link.provider)) ?? release?.links[0];
  const [albumUrl, setAlbumUrl] = useState(editableAlbumLink?.url ?? "");
  const [trackNumber, setTrackNumber] = useState(track?.trackNumber ?? data.tracks.filter((item) => item.releaseId === release?.id).length + 1);
  const [error, setError] = useState("");
  async function save() {
    setError("");
    try {
      const commands: ArchiveCommand[] = [];
      if (kind === "artist") commands.push({ type: "update_artist", patch: { name: title } });
      if (kind === "release") {
        const link = albumUrl.trim() ? parseMusicProviderUrl(albumUrl.trim(), "release") : null;
        if (albumUrl.trim() && !link) throw new Error("지원하는 음원 사이트의 앨범 URL을 입력해 주세요.");
        const replacingDomesticLink = editableAlbumLink && ["melon", "genie"].includes(editableAlbumLink.provider);
        const links = link ? [...(release?.links ?? []).filter(item => item.provider !== link.provider && !(replacingDomesticLink && item.url === editableAlbumLink.url)), { provider: link.provider, url: link.url, externalId: link.externalId }] : (release?.links ?? []).filter(item => item.url !== editableAlbumLink?.url);
        const value = { title, artistName, version, type: releaseType, links, ...(releaseDate ? { releaseDate } : {}) };
        commands.push(release ? { type: "update_release", releaseId: release.id, patch: value } : { type: "add_release", release: { id: crypto.randomUUID(), ...value, participation: "primary" } });
      }
      if (kind === "track" && release) {
        const value = { title, artistName, version, trackNumber };
        if (track) commands.push({ type: "update_track", trackId: track.id, patch: value });
        else {
          const recordingId = crypto.randomUUID();
          commands.push({ type: "save_recording", recording: { id: recordingId, title, version, workIds: [] } });
          commands.push({ type: "add_track", track: { id: crypto.randomUUID(), releaseId: release.id, ...value, recordingId, discNumber: 1, managed: true, links: [] } });
        }
      }
      await onSave(commands);
    } catch (error) { setError(error instanceof Error ? error.message : "저장하지 못했습니다."); }
  }
  return <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
    {error && <Notice error>{error}</Notice>}
    <Field label={kind === "artist" ? "아티스트 활동명" : kind === "release" ? "앨범 제목" : "트랙 제목"}><input className={inputClass} value={title} required maxLength={500} onChange={(event) => setTitle(event.target.value)} /></Field>
    {kind !== "artist" && <Field label="아티스트"><input className={inputClass} value={artistName} maxLength={500} onChange={(event) => setArtistName(event.target.value)} /></Field>}
    {kind === "release" && <div className="grid gap-4 sm:grid-cols-2"><Field label="발매 형식"><select className={inputClass} value={releaseType} onChange={(event) => setReleaseType(event.target.value as ArchiveRelease["type"])}>{Object.entries(releaseLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="발매일"><input className={inputClass} value={releaseDate} placeholder="YYYY-MM-DD" pattern="[0-9]{4}(-[0-9]{2})?(-[0-9]{2})?" onChange={(event) => setReleaseDate(event.target.value)} /></Field></div>}
    {kind === "release" && <Field label="음원 사이트 앨범 URL (선택)" hint="멜론·지니 앨범 주소를 연결하면 공개된 저작자 정보를 다시 가져올 수 있습니다."><input type="url" className={inputClass} value={albumUrl} maxLength={2000} placeholder="https://…" onChange={event => setAlbumUrl(event.target.value)} /></Field>}
    {kind === "track" && <div className="grid gap-4 sm:grid-cols-2"><Field label="트랙 순서"><input type="number" min={1} max={10000} required className={inputClass} value={trackNumber} onChange={(event) => setTrackNumber(Number(event.target.value))} /></Field><Field label="버전"><input className={inputClass} value={version} maxLength={500} placeholder="원곡, 클린, 라이브 등" onChange={(event) => setVersion(event.target.value)} /></Field></div>}
    <div className="flex justify-end border-t border-border pt-4"><Button primary type="submit" className="min-w-28" disabled={busy}>{busy ? "저장 중…" : "저장"}</Button></div>
  </form>;
}

export function AffiliationEditor({ initial, busy, onSave }: { initial?: ArchiveAffiliation; busy: boolean; onSave: (command: ArchiveCommand) => Promise<void> }) {
  const [value, setValue] = useState<ArchiveAffiliation>(initial ?? { id: crypto.randomUUID(), agency: "KOMCA", participant: "", role: "", status: "unknown", memo: "" }); const [error, setError] = useState("");
  return <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void onSave({ type: "save_affiliation", affiliation: value }).catch((error: Error) => setError(error.message)); }}>{error && <Notice error>{error}</Notice>}<Notice>기관 가입·신탁·위탁 관계와 작품별 등록은 별도 기록입니다. KOMCA와 KOSCAP 모두에 가입해야 완료되는 구조가 아닙니다.</Notice><div className="grid gap-3 sm:grid-cols-2">{([['agency','기관명'],['participant','저작자 / 참여자명'],['role','권리 / 참여 역할']] as const).map(([key,label]) => <Field key={key} label={label}><input className={inputClass} value={value[key] ?? ""} required={key !== "role"} maxLength={500} onChange={(e) => setValue({ ...value, [key]: e.target.value })} /></Field>)}<Field label="가입 / 위탁 관계"><select className={inputClass} value={value.status} onChange={(e) => setValue({ ...value, status: e.target.value as ArchiveAffiliation["status"] })}>{Object.entries(affiliationLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div><Field label="확인 근거 / 메모"><textarea className={inputClass} value={value.memo ?? ""} maxLength={4000} onChange={(e) => setValue({ ...value, memo: e.target.value })} /></Field><Button primary type="submit" disabled={busy}>내 가입·위탁 기록 저장</Button></form>;
}
export const affiliationLabels = { unknown: "확인 필요", not_joined: "가입하지 않음 (사용자 기록)", applying: "가입 / 위탁 신청 중", joined: "가입 / 위탁 관계 있음 (사용자 기록)", not_applicable: "해당 없음" };

export function MergeEditor({ data, entityType, initialId, busy, onSave }: { data: ArchiveData; entityType: "release" | "track"; initialId?: string; busy: boolean; onSave: (command: ArchiveCommand) => Promise<void> }) {
  const items = entityType === "release" ? data.releases : data.tracks;
  const [sourceId, setSourceId] = useState(initialId ?? ""); const [targetId, setTargetId] = useState(""); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState("");
  const source = items.find((item) => item.id === sourceId); const target = items.find((item) => item.id === targetId);
  const comparison = (item: ArchiveRelease | ArchiveTrack) => { const release = "releaseId" in item ? data.releases.find((release) => release.id === item.releaseId) : item; const tracks = "releaseId" in item ? [item] : data.tracks.filter((track) => track.releaseId === item.id); const tasks = data.tasks.filter((task) => tracks.some((track) => track.id === task.trackId)); return <div className="min-w-0 space-y-2 rounded-lg border border-border p-3"><h3 className="font-bold">{item.title}</h3><p className="text-sm">{item.artistName || data.artist.name} · {release?.releaseDate || "발매일 없음"} · {item.version || "버전 미기록"}</p><p className="text-xs">출처: {item.source ? providerNames[item.source.provider] : "사용자 입력"}{item.source && item.userEdited ? " · 사용자 수정 포함" : ""}</p><ul className="list-disc pl-5 text-sm">{tracks.map((track) => <li key={track.id}>{track.discNumber}-{track.trackNumber}. {track.title} · {track.version || "버전 미기록"}</li>)}</ul><p className="text-sm font-bold">보존할 업무 기록 {tasks.length}건 / 심의 연결 {data.reviewLinks.filter((link) => link.releaseId === release?.id || tracks.some((track) => track.id === link.trackId)).length}건</p>{tasks.slice(0, 8).map((task) => <p key={task.id} className="text-xs">{task.agency} · {task.participant || "참여자 미기록"} · {task.status} / {task.result}</p>)}</div>; };
  return <div className="space-y-4"><Notice>대표 항목 아래에 중복 후보를 묶고 원래 트랙·버전·업무 이력을 보존합니다. 다른 버전의 결과를 자동 복사하지 않으며 “병합 복구”에서 다시 분리할 수 있습니다.</Notice>{error && <Notice error>{error}</Notice>}<div className="grid gap-3 sm:grid-cols-2"><Field label="묶을 중복 후보"><select className={inputClass} value={sourceId} onChange={(e) => { setSourceId(e.target.value); setConfirmed(false); }}><option value="">후보 선택</option>{items.filter((item) => !item.mergedInto).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.version || "버전 미기록"}</option>)}</select></Field><Field label="유지할 대표 항목"><select className={inputClass} value={targetId} onChange={(e) => { setTargetId(e.target.value); setConfirmed(false); }}><option value="">대표 항목 선택</option>{items.filter((item) => item.id !== sourceId && !item.mergedInto).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.version || "버전 미기록"}</option>)}</select></Field>{source && comparison(source)}{target && comparison(target)}</div>{source && target && <><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />제목뿐 아니라 아티스트·트랙·버전·출처와 영향을 받는 기록을 비교했습니다.</label><Button primary disabled={!confirmed || busy} onClick={() => void onSave({ type: "merge", entityType, id: source.id, targetId: target.id }).catch((error: Error) => setError(error.message))}>확인한 중복 후보 병합</Button></>}</div>;
}

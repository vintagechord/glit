"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Plus, Save, Search, X } from "lucide-react";
import type { ArchiveCommand, ArchiveLibrary } from "@/lib/music-archive/model";
import { parseMusicProviderUrl } from "@/lib/music-archive/providers";
import { archiveRequest } from "./types";
import { Badge, Button, External, Field, Notice, inputClass } from "./ui";

export function AdminAlbumEditor({ library, onSaved }: { library: ArchiveLibrary; onSaved: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [editing, setEditing] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState(library.data.artist.name);
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<"album" | "ep" | "single" | "other">("album");
  const [url, setUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [tracks, setTracks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const albums = useMemo(() => library.data.releases.filter(release => !release.excluded && !release.mergedInto && (!query.trim() || `${release.title} ${release.artistName ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [library.data.releases, query]);
  function begin(id?: string) {
    setTargetId(id ?? null); setEditing(true); setError(""); setMessage(""); setTracks("");
    if (!id) { setTitle(""); setArtist(library.data.artist.name); setDate(""); setKind("album"); setUrl(""); setImageUrl(""); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const titles = tracks.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (titles.length > 99) throw new Error("트랙은 한 번에 최대 99곡까지 추가할 수 있습니다.");
      if (targetId && !titles.length) throw new Error("추가할 트랙 제목을 입력해주세요.");
      const releaseId = targetId ?? crypto.randomUUID();
      const link = url.trim() ? parseMusicProviderUrl(url.trim(), "release") : null;
      if (!targetId && url.trim() && !link) throw new Error("지원하는 음원 사이트의 앨범 URL을 입력해주세요.");
      const commands: ArchiveCommand[] = targetId ? [] : [{ type: "add_release", release: { id: releaseId, title, artistName: artist, type: kind, ...(date ? { releaseDate: date } : {}), ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}), links: link ? [{ provider: link.provider, url: link.url, externalId: link.externalId }] : [] } }];
      const nextTrack = targetId ? Math.max(0, ...library.data.tracks.filter(track => track.releaseId === targetId && track.discNumber === 1).map(track => track.trackNumber)) : 0;
      titles.forEach((trackTitle, index) => commands.push({ type: "add_track", track: { id: crypto.randomUUID(), releaseId, title: trackTitle, artistName: targetId ? library.data.releases.find(release => release.id === targetId)?.artistName ?? artist : artist, trackNumber: nextTrack + index + 1, discNumber: 1, managed: true, links: [] } }));
      await archiveRequest("", { action: "admin-commands", libraryId: library.id, version: library.version, commands });
      await onSaved(); setEditing(false); setMessage(targetId ? `${titles.length}곡을 추가했습니다.` : `앨범과 ${titles.length}곡을 회원 음악 관리에 추가했습니다.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "앨범을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4" aria-label="회원 앨범 관리">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">앨범·트랙 관리</h3><p className="mt-1 text-sm text-muted-foreground">불러오지 못한 앨범과 트랙을 추가하면 회원 음악 관리에 바로 표시됩니다.</p></div><Button primary disabled={Boolean(library.archived_at) || busy} onClick={() => begin()}><Plus className="h-4 w-4" aria-hidden />앨범 직접 추가</Button></div>
    {error && <Notice error>{error}</Notice>}{message && <p role="status" className="text-sm">{message}</p>}
    {editing && <form onSubmit={save} className="space-y-4 rounded-xl border border-emerald-600/30 bg-muted/30 p-4"><fieldset disabled={busy} className="space-y-4"><div className="flex items-center justify-between gap-3"><h4 className="font-bold">{targetId ? `${library.data.releases.find(release => release.id === targetId)?.title} · 트랙 추가` : "누락 앨범 직접 입력"}</h4><Button onClick={() => setEditing(false)} aria-label="입력 닫기"><X className="h-4 w-4" /></Button></div>
      {!targetId && <><div className="grid gap-3 sm:grid-cols-2"><Field label="앨범명"><input required className={inputClass} value={title} onChange={event => setTitle(event.target.value)} maxLength={500} /></Field><Field label="아티스트"><input required className={inputClass} value={artist} onChange={event => setArtist(event.target.value)} maxLength={500} /></Field><Field label="발매일 (선택)"><input type="date" className={inputClass} value={date} onChange={event => setDate(event.target.value)} /></Field><Field label="앨범 유형"><select className={inputClass} value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="album">정규 앨범</option><option value="ep">EP</option><option value="single">싱글</option><option value="other">기타</option></select></Field></div><Field label="음원 사이트 앨범 URL (선택)"><input type="url" className={inputClass} value={url} onChange={event => setUrl(event.target.value)} maxLength={2000} placeholder="https://music.apple.com/..." /></Field><Field label="자켓 이미지 URL (선택)"><input type="url" className={inputClass} value={imageUrl} onChange={event => setImageUrl(event.target.value)} maxLength={2000} placeholder="https://..." /></Field></>}
      <Field label={targetId ? "추가할 트랙 제목" : "트랙 제목 (선택)"} hint="트랙 순서대로 한 줄에 한 곡씩 입력해주세요. 최대 99곡이며, 나중에 추가할 수도 있습니다."><textarea rows={5} className={inputClass} value={tracks} onChange={event => setTracks(event.target.value)} maxLength={49500} required={Boolean(targetId)} placeholder={"첫 번째 곡\n두 번째 곡"} /></Field>
      <div className="flex justify-end gap-2"><Button onClick={() => setEditing(false)}>취소</Button><Button type="submit" primary><Save className="h-4 w-4" aria-hidden />{busy ? "저장 중" : targetId ? "트랙 추가" : "앨범 등록"}</Button></div>
    </fieldset></form>}
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" aria-hidden /><input aria-label="앨범 검색" className={`${inputClass} pl-9`} placeholder="이 회원의 앨범 검색" value={query} maxLength={100} onChange={event => { setQuery(event.target.value); setLimit(20); }} /></div>
    <div className="divide-y divide-border rounded-lg border border-border">{albums.slice(0, limit).map(release => <article key={release.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0 flex-1"><p className="break-words font-semibold">{release.title}</p><p className="mt-1 text-xs text-muted-foreground">{release.releaseDate || "발매일 미입력"} · {library.data.tracks.filter(track => track.releaseId === release.id && !track.excluded && !track.mergedInto).length}곡{release.userEdited && <> · <Badge>직접 입력·수정</Badge></>}</p>{release.links[0] && <External href={release.links[0].url}>음원 사이트</External>}</div><Button disabled={Boolean(library.archived_at) || busy} onClick={() => begin(release.id)}><Plus className="h-4 w-4" aria-hidden />트랙 추가</Button></article>)}{!albums.length && <p className="p-4 text-sm text-muted-foreground">{query ? "검색한 앨범이 없습니다." : "등록된 앨범이 없습니다. 누락 앨범을 직접 추가할 수 있습니다."}</p>}</div>
    {albums.length > limit && <div className="flex justify-center"><Button onClick={() => setLimit(value => value + 20)}>앨범 더 보기 ({limit}/{albums.length})</Button></div>}
  </section>;
}

"use client";
import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { parseMusicProviderUrl, type ArtistCandidate, type MusicProviderLink, type ProviderSupport } from "@/lib/music-archive/providers";
import { archiveRequest, providerNames, supportLabels } from "./types";
import { Button, Field, Notice, Badge, External, inputClass } from "./ui";

export function ArtistConnect({ providers, existingName, impactCount = 0, onChoose, onLink, busy }: {
  providers: ProviderSupport[]; existingName?: string; impactCount?: number; busy: boolean;
  onChoose: (name: string, candidate?: ArtistCandidate) => Promise<void>;
  onLink: (name: string, link: MusicProviderLink) => Promise<void>;
}) {
  const [mode, setMode] = useState<"search" | "url" | "manual">("search");
  const [query, setQuery] = useState(existingName ?? "");
  const [manualName, setManualName] = useState(existingName ?? "");
  const [url, setUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<ArtistCandidate[]>([]);
  const [selected, setSelected] = useState<ArtistCandidate | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const provider = providers.find((p) => p.id === "musicbrainz");
  async function search(event?: FormEvent, offset = 0) {
    event?.preventDefault(); setError(""); setSearching(true); setSelected(null);
    try {
      const result = await archiveRequest<{ items: ArtistCandidate[]; nextOffset?: number | null; total?: number; queryStatus?: string; message?: string }>(`?action=search&provider=musicbrainz&q=${encodeURIComponent(query)}&offset=${offset}`);
      setCandidates((old) => offset ? [...old, ...result.items] : result.items);
      setNextOffset(result.nextOffset ?? (result.total && offset + result.items.length < result.total ? offset + result.items.length : null));
      if (["forbidden", "temporary_error", "unsupported"].includes(result.queryStatus || "")) { setError(result.message || "외부 조회를 사용할 수 없습니다. 직접 추가를 이용해 주세요."); setSearched(false); } else setSearched(true);
    } catch (e) { setError((e as Error).message); } finally { setSearching(false); }
  }
  async function act(callback: () => Promise<void>) { setError(""); try { await callback(); } catch (e) { setError((e as Error).message); } }
  return <div className="space-y-4">
    <Notice>관리 목록 연결은 아티스트 본인이나 권리자 인증이 아닙니다. 내 계정에서 작성한 업무와 연결한 심의만 볼 수 있습니다.</Notice>
    <div className="flex flex-wrap gap-2" aria-label="아티스트 추가 방법">{([['search','이름 검색'],['url','서비스 URL / ID'],['manual','직접 추가']] as const).filter(([key]) => !existingName || key !== "manual").map(([key,label]) => <Button key={key} primary={mode === key} aria-pressed={mode === key} onClick={() => { setMode(key); setError(""); }}>{label}</Button>)}</div>
    {error && <Notice error>{error}</Notice>}
    {mode === "search" && <>
      <div className="flex flex-wrap items-center gap-2"><strong>MusicBrainz</strong><Badge>{supportLabels[provider?.status ?? "configuration_required"]}</Badge></div>
      {provider?.status !== "available" && <Notice>{provider?.message || "제공처 상태를 확인하지 못했습니다."} 서비스 URL 연결 또는 직접 추가를 사용할 수 있습니다.</Notice>}
      <form className="flex items-end gap-2" onSubmit={search}><div className="min-w-0 flex-1"><Field label="아티스트 이름"><input className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)} required maxLength={200} placeholder="아티스트명 또는 영문 활동명" /></Field></div><Button type="submit" disabled={searching || provider?.status !== "available" || !query.trim()}><Search className="h-4 w-4" />{searching ? "조회 중" : "검색"}</Button></form>
      <div className="space-y-2" aria-label="아티스트 검색 후보">{candidates.map((candidate) => <label key={candidate.externalId} className={`flex cursor-pointer gap-3 rounded-lg border-2 p-3 ${selected?.externalId === candidate.externalId ? "border-[#1556a4]" : "border-border"}`}><input className="mt-1 h-4 w-4" type="radio" name="artist-candidate" checked={selected?.externalId === candidate.externalId} onChange={() => setSelected(candidate)} /><span className="min-w-0 space-y-1"><strong className="block">{candidate.name}</strong><span className="block text-sm text-muted-foreground">{[candidate.disambiguation, candidate.country, candidate.type, candidate.sortName !== candidate.name ? candidate.sortName : ""].filter(Boolean).join(" · ") || "구분 정보 없음 — 공식 아티스트 페이지를 확인해 주세요."}</span><span className="block text-xs">출처: {providerNames[candidate.provider]} · 대표 발매작: {candidate.representativeRelease || "검색 응답에 미제공"}</span><External href={candidate.url}>후보 공식 정보</External></span></label>)}</div>
      {searched && candidates.length === 0 && <Notice>검색 결과가 없습니다. 미발매·미등록을 뜻하지 않습니다. 다른 이름으로 검색하거나 직접 추가해 주세요.</Notice>}
      {nextOffset !== null && <Button disabled={searching} onClick={() => void search(undefined, nextOffset)}>후보 더 보기</Button>}
      {selected && <div className="space-y-3 rounded-lg bg-muted p-3"><p className="text-sm"><strong>{selected.name}</strong> · {selected.disambiguation || "구분 설명 없음"} 후보를 내 관리 목록에 연결합니다.{existingName && ` 기존 업무 ${impactCount}건은 보존되며 새 후보에 결과를 자동 승계하지 않습니다.`}</p><Button primary disabled={busy} onClick={() => void act(() => onChoose(selected.name, selected))}>선택한 아티스트 확인하고 연결</Button></div>}
    </>}
    {mode === "url" && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const parsed = parseMusicProviderUrl(url, "artist"); if (!parsed) { setError("지원하는 서비스의 HTTPS 아티스트 URL 또는 MusicBrainz 아티스트 ID를 입력해 주세요."); return; } void act(() => onLink(manualName, parsed)); }}><Field label="관리할 아티스트 이름"><input className={inputClass} value={manualName} onChange={(e) => setManualName(e.target.value)} required maxLength={200} /></Field><Field label="아티스트 서비스 URL 또는 MusicBrainz ID" hint="멜론·Spotify·지니·벅스·MusicBrainz 아티스트 링크를 지원합니다. URL만으로 모든 발매작을 수집하지 않습니다."><input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} required maxLength={2048} /></Field>{existingName && <Notice>기존 제공처 연결을 교체합니다. 업무 {impactCount}건과 기존 발매작은 보존됩니다. 새 연결의 수집 결과는 별도 확인이 필요합니다.</Notice>}<Button primary type="submit" disabled={busy}>입력한 아티스트 확인하고 링크 연결</Button></form>}
    {mode === "manual" && <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void act(() => onChoose(manualName)); }}><Field label="아티스트 활동명"><input className={inputClass} value={manualName} onChange={(e) => setManualName(e.target.value)} required maxLength={200} /></Field><p className="text-sm text-muted-foreground">외부 연동 없이 앨범과 트랙을 추가하고 업무 내역을 기록할 수 있습니다.</p><Button primary type="submit" disabled={busy}>아티스트 직접 추가</Button></form>}
  </div>;
}

"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import { Check, LoaderCircle, Music2, Search } from "lucide-react";
import { parseMusicProviderUrl, type ArtistCandidate, type MusicProviderLink, type ProviderSupport } from "@/lib/music-archive/providers";
import { archiveRequest, isDomesticMusicProvider, providerNames } from "./types";
import { Button, Field, Notice, External, inputClass } from "./ui";

type SearchResult = { items: ArtistCandidate[]; nextOffset?: number | null; total?: number; queryStatus?: string; message?: string; scopeNote?: string };
type Mode = "search" | "url" | "manual";
const searchFailure = "검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색하거나 아티스트 링크로 추가해 주세요.";

function ArtistPortrait({ candidate }: { candidate: ArtistCandidate }) {
  const [failed, setFailed] = useState(false);
  const imageUrl: string | null = candidate.imageUrl;
  return <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
    {imageUrl && !failed ? <Image src={imageUrl} alt="" width={56} height={56} unoptimized className="h-full w-full object-cover" onError={() => setFailed(true)} /> : <Music2 className="h-6 w-6 text-muted-foreground" aria-hidden />}
  </span>;
}

export function ArtistConnect({ existingName, impactCount = 0, onChoose, onLink, busy }: {
  providers: ProviderSupport[]; existingName?: string; impactCount?: number; busy: boolean;
  onChoose: (name: string, candidate?: ArtistCandidate) => Promise<void>;
  onLink: (name: string, link: MusicProviderLink) => Promise<void>;
}) {
  const modes = ([['search', '이름으로 찾기'], ['url', '아티스트 링크'], ['manual', '직접 추가']] as const).filter(([key]) => key !== "manual" || !existingName);
  const [mode, setMode] = useState<Mode>("search");
  const activeMode = modes.find(([key]) => key === mode)?.[0] ?? modes[0]?.[0];
  const [query, setQuery] = useState(existingName ?? "");
  const queryRef = useRef(query);
  const [manualName, setManualName] = useState(existingName ?? "");
  const [url, setUrl] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<ArtistCandidate[]>([]);
  const [selected, setSelected] = useState<ArtistCandidate | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [scopeNote, setScopeNote] = useState("");
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  const cancelSearch = useCallback(() => {
    sequence.current += 1;
    request.current?.abort(); request.current = null;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = null;
  }, []);

  const search = useCallback(async (text: string, offset = 0) => {
    if (!text.trim()) return;
    cancelSearch();
    const currentSequence = sequence.current;
    const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setError(""); setSearching(true); setSelected(null); setOpen(true); setHighlighted(-1);
    try {
      const result = await archiveRequest<SearchResult>(`?action=search&q=${encodeURIComponent(text.trim())}&offset=${offset}`, undefined, { signal: controller.signal });
      if (!mounted.current || currentSequence !== sequence.current || queryRef.current.trim() !== text.trim()) return;
      if (["forbidden", "temporary_error", "unsupported"].includes(result.queryStatus || "")) {
        setError(searchFailure); setSearched(false); setNextOffset(null); return;
      }
      setCandidates((previous) => {
        const items = offset ? [...previous, ...result.items] : result.items;
        return items.filter((item, index) => items.findIndex((other) => other.provider === item.provider && other.externalId === item.externalId) === index);
      });
      setNextOffset(result.nextOffset ?? null);
      setScopeNote(result.scopeNote ?? "");
      setSearched(true);
    } catch {
      if (mounted.current && currentSequence === sequence.current && (!controller.signal.aborted || timedOut)) setError(searchFailure);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      if (mounted.current && currentSequence === sequence.current) setSearching(false);
    }
  }, [cancelSearch]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelSearch(); };
  }, [cancelSearch]);
  useEffect(() => {
    cancelSearch(); setSelected(null); setCandidates([]); setNextOffset(null); setSearched(false); setSearching(false); setHighlighted(-1); setError(""); setScopeNote("");
    if (activeMode === "search" && query.trim() && !composing) debounce.current = setTimeout(() => void search(query), 650);
    return cancelSearch;
  }, [query, activeMode, composing, search, cancelSearch]);

  function choose(candidate: ArtistCandidate) { cancelSearch(); setSearching(false); setSelected(candidate); setOpen(false); setHighlighted(-1); }
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || composing) return;
    if (event.key === "Escape") { event.preventDefault(); cancelSearch(); setSearching(false); setOpen(false); setHighlighted(-1); return; }
    if (!candidates.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      setHighlighted((previous) => event.key === "ArrowDown" ? Math.min(previous + 1, candidates.length - 1) : previous < 0 ? candidates.length - 1 : Math.max(previous - 1, 0));
    } else if (open && event.key === "Enter" && highlighted >= 0) { event.preventDefault(); choose(candidates[highlighted]); }
    else if (open && (event.key === "Home" || event.key === "End")) { event.preventDefault(); setHighlighted(event.key === "Home" ? 0 : candidates.length - 1); }
  }
  useEffect(() => { if (open && highlighted >= 0) document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView({ block: "nearest" }); }, [highlighted, open, listId]);
  function submitSearch(event: FormEvent) { event.preventDefault(); if (!composing) void search(query); }
  async function act(callback: () => Promise<void>) {
    setError("");
    try { await callback(); }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : "아티스트를 추가하지 못했습니다. 다시 시도해 주세요."); }
  }
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-muted-foreground">아티스트를 찾고 내 음악 목록을 만들어 보세요. 같은 이름의 아티스트가 있다면 활동 정보를 확인해 주세요.</p>
    <div className="flex flex-wrap gap-2" aria-label="아티스트 추가 방법">{modes.map(([key, label]) => <Button key={key} primary={activeMode === key} aria-pressed={activeMode === key} disabled={busy} onClick={() => setMode(key)}>{label}</Button>)}</div>
    {error && <Notice error>{error}</Notice>}
    {activeMode === "search" && <>
      <form className="flex items-end gap-2" onSubmit={submitSearch}>
        <div className="min-w-0 flex-1"><Field label="아티스트 이름">
          <input className={inputClass} value={query} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open && candidates.length > 0} aria-controls={listId} aria-describedby={`${listId}-hint`} aria-activedescendant={open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined} aria-busy={searching} disabled={busy} maxLength={200} placeholder="아티스트 이름 또는 초성" onChange={(event) => { queryRef.current = event.target.value; setQuery(event.target.value); setOpen(true); }} onFocus={() => { if (candidates.length) setOpen(true); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={onSearchKeyDown} />
        </Field></div><Button type="submit" disabled={busy || searching || !query.trim()} aria-label="아티스트 검색"><Search className="h-4 w-4" aria-hidden />검색</Button>
      </form>
      <p id={`${listId}-hint`} className="text-xs leading-5 text-muted-foreground">활동명이나 초성을 입력하면 후보를 제안합니다. 예: 아이유, ㅇㅇ</p>
      {searching && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />아티스트를 찾고 있습니다…</p>}
      {open && candidates.length > 0 && <div className="space-y-3">
        <ul id={listId} role="listbox" aria-label="아티스트 검색 후보" className="max-h-[360px] space-y-2 overflow-y-auto rounded-xl border border-border bg-background p-2">
          {candidates.map((candidate, index) => <li key={`${candidate.provider}-${candidate.externalId}`} id={`${listId}-${index}`} role="option" aria-selected={selected?.provider === candidate.provider && selected.externalId === candidate.externalId} onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setHighlighted(index)} onClick={() => choose(candidate)} className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 ${highlighted === index ? "border-foreground bg-card" : "border-transparent hover:bg-card"}`}>
            <ArtistPortrait candidate={candidate} /><span className="min-w-0 flex-1 space-y-1"><strong className="block break-words">{candidate.name}</strong>{[candidate.disambiguation, candidate.type, candidate.country].filter(Boolean).length > 0 && <span className="block text-xs leading-5 text-muted-foreground">{[candidate.disambiguation, candidate.type, candidate.country].filter(Boolean).join(" · ")}</span>}{candidate.representativeRelease && <span className="block text-xs leading-5">대표 발매작 · {candidate.representativeRelease}</span>}<span className="block text-xs text-muted-foreground">{providerNames[candidate.provider]}</span></span>
          </li>)}
        </ul><p className="text-xs text-muted-foreground">↑ ↓로 이동하고 Enter로 선택할 수 있습니다.</p>
        {nextOffset !== null && <Button disabled={searching || busy} onClick={() => void search(query, nextOffset)}>검색 결과 더 보기</Button>}
      </div>}
      {searched && scopeNote && <p className="text-xs leading-5 text-muted-foreground">{scopeNote}</p>}
      {searched && !searching && candidates.length === 0 && <Notice>{/^[ㄱ-ㅎ\s]+$/.test(query.trim()) ? "일치하는 초성 후보가 없습니다. 아티스트의 전체 이름으로 검색해 주세요." : "검색 결과가 없습니다. 다른 활동명으로 검색하거나 아티스트 링크를 입력해 주세요."}</Notice>}
      {selected && <div className="space-y-4 rounded-xl border-2 border-foreground bg-background p-4">
        <div className="flex items-start gap-3"><ArtistPortrait candidate={selected} /><div className="min-w-0 flex-1"><p className="flex items-center gap-2 font-black"><Check className="h-4 w-4 shrink-0" aria-hidden />{selected.name}</p>{selected.disambiguation && <p className="mt-1 text-sm text-muted-foreground">{selected.disambiguation}</p>}{selected.representativeRelease && <p className="mt-1 text-sm">{selected.representativeRelease}</p>}<External href={selected.url}>{providerNames[selected.provider]} 아티스트 확인</External></div></div>
        {existingName && <p className="text-xs leading-5 text-muted-foreground">기존 발매작과 업무 {impactCount}건을 보존하고 이 아티스트의 새 발매작을 확인합니다.</p>}
        <Button primary disabled={busy} onClick={() => void act(() => onChoose(selected.name, selected))}>{busy ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />아티스트 연결 중…</> : "이 아티스트의 앨범 불러오기"}</Button>
      </div>}
    </>}
    {activeMode === "url" && <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); const parsed = parseMusicProviderUrl(url, "artist");
      if (!parsed || !isDomesticMusicProvider(parsed.provider)) { setError("멜론·지니뮤직·벅스의 아티스트 페이지 주소를 입력해 주세요."); return; }
      void act(() => onLink(manualName, parsed));
    }}>
      <Field label="아티스트 링크" hint="멜론·지니뮤직·벅스의 아티스트 페이지 주소를 붙여넣어 주세요."><input className={inputClass} type="url" value={url} onChange={(event) => setUrl(event.target.value)} required disabled={busy} maxLength={2048} placeholder="https://www.melon.com/artist/…" /></Field>
      <Field label="관리할 아티스트 이름"><input className={inputClass} value={manualName} onChange={(event) => setManualName(event.target.value)} required disabled={busy} maxLength={200} /></Field>
      {existingName && <p className="text-xs leading-5 text-muted-foreground">연결을 바꿔도 기존 발매작과 업무 {impactCount}건은 보존됩니다.</p>}
      <p className="text-sm text-muted-foreground">링크를 저장한 뒤 ‘앨범 찾아보기’에서 발매작을 추가할 수 있습니다.</p>
      <Button primary type="submit" disabled={busy}>{busy ? "링크 저장 중…" : "아티스트 링크 추가"}</Button>
    </form>}
    {activeMode === "manual" && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act(() => onChoose(manualName)); }}>
      <Field label="아티스트 활동명"><input className={inputClass} value={manualName} onChange={(event) => setManualName(event.target.value)} required disabled={busy} maxLength={200} /></Field>
      <p className="text-sm text-muted-foreground">직접 앨범과 트랙을 추가하고 심의·등록 업무를 기록할 수 있습니다.</p><Button primary type="submit" disabled={busy}>{busy ? "추가 중…" : "아티스트 직접 추가"}</Button>
    </form>}
    <p className="text-xs leading-5 text-muted-foreground">아티스트 연결은 내 계정의 관리 목록에만 적용됩니다. 본인·권리자 인증을 대신하지 않습니다.</p>
  </div>;
}

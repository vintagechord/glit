"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight, LoaderCircle, Music2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { DashboardShell, englishDefaultDashboardTabs } from "@/components/dashboard/dashboard-shell";
import type { ArchiveCommand, ArchiveRelease, ArchiveTrack } from "@/lib/music-archive/model";
import type { ArtistCandidate, MusicProviderLink } from "@/lib/music-archive/providers";
import { archiveRequest, availableImportProviders, mergeSyncJobs, responseSyncJobs, type ArchiveIndex, type Library, type LibraryDetail, type SyncJob, type SyncResponse } from "./types";
import { Button, Cover, Modal, Notice, inputClass, panelClass } from "./ui";
import { MusicStatusBadge } from "./music-status-badge";
import { ArtistConnect } from "./artist-connect";
import { EntityEditor } from "./entity-editors";
import { SyncStatus } from "./sync-status";
import { MemberMusicStatus, memberReviewStatus, type MemberMusicTab } from "./member-music-status";
import { CopyrightCreditDetails, trackCopyrightCredits } from "./track-credits";
import { groupArchiveAlbums } from "@/lib/music-archive/album-groups";
import { albumDisplayCommands, albumDisplayDetail, libraryDisplayCounts } from "./album-display";

const tabs: { key: MemberMusicTab; label: string }[] = [
  { key: "review", label: "심의" }, { key: "copyright", label: "저작권 등록" },
  { key: "performer", label: "실연자 등록" }, { key: "karaoke", label: "노래방" },
];
type Dialog = { type: "add_artist" | "connect" | "artist" | "release" | "track"; release?: ArchiveRelease; track?: ArchiveTrack } | null;
const failure = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";

export function MusicArchiveClient() {
  const pathname = usePathname();
  const english = pathname === "/en" || pathname.startsWith("/en/");
  const localePrefix = english ? "/en" : "";
  const [index, setIndex] = useState<ArchiveIndex | null>(null);
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const latest = useRef<Library | null>(null); const activeArtist = useRef(""); const connectionDraft = useRef<Library | null>(null);
  const [artistId, setArtistId] = useState(""); const [releaseId, setReleaseId] = useState(""); const [trackId, setTrackId] = useState("");
  const [tab, setTab] = useState<MemberMusicTab>("review"); const [reviewOpenRequest, setReviewOpenRequest] = useState(0);
  const [loading, setLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [loginRequired, setLoginRequired] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [dialog, setDialog] = useState<Dialog>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Library | null>(null); const [removalError, setRemovalError] = useState("");
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1);
  const refreshIndex = useCallback(async () => { const result = await archiveRequest<ArchiveIndex>(); setIndex(result); setLoginRequired(false); return result; }, []);
  const refreshDetail = useCallback(async (id: string, signal?: AbortSignal) => {
    const result = await archiveRequest<LibraryDetail>(`?libraryId=${encodeURIComponent(id)}`, undefined, { signal });
    if (!signal?.aborted && activeArtist.current === id && (!latest.current || latest.current.id !== id || latest.current.version <= result.library.version)) {
      setDetail(result); latest.current = result.library;
      setIndex((previous) => previous ? { ...previous, libraries: previous.libraries.map((library) => library.id === id && library.version <= result.library.version ? result.library : library) } : previous);
    }
    return result;
  }, []);
  useEffect(() => {
    function readUrl() {
      const params = new URLSearchParams(window.location.search); activeArtist.current = params.get("artist") || "";
      setArtistId(activeArtist.current); setReleaseId(params.get("release") || ""); setTrackId(params.get("track") || "");
      const nextTab = params.get("tab") as MemberMusicTab; setTab(tabs.some((item) => item.key === nextTab) ? nextTab : "review");
    }
    readUrl(); window.addEventListener("popstate", readUrl);
    void refreshIndex().catch((error: Error & { status?: number }) => { setLoginRequired(error.status === 401); setError(error.message); }).finally(() => setLoading(false));
    return () => window.removeEventListener("popstate", readUrl);
  }, [refreshIndex]);
  useEffect(() => {
    if (!artistId) return;
    const controller = new AbortController(); Promise.resolve().then(() => { if (!controller.signal.aborted) setDetailLoading(true); });
    void refreshDetail(artistId, controller.signal).catch((error) => { if (!controller.signal.aborted) setError(failure(error)); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [artistId, refreshDetail]);
  const current = detail?.library.id === artistId ? detail : null;
  const activeJobs = current?.jobs.some((job) => ["queued", "running"].includes(job.status));
  useEffect(() => {
    if (!artistId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let pending = false;
    async function poll() {
      if (controller.signal.aborted || pending) return;
      if (timer) clearTimeout(timer);
      if (document.visibilityState === "visible") { pending = true; try { await refreshDetail(artistId, controller.signal); } catch { /* Retain the saved view while retrying. */ } finally { pending = false; } }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), activeJobs ? 5000 : 60000);
    }
    function visible() { if (document.visibilityState === "visible") void poll(); }
    timer = setTimeout(() => void poll(), activeJobs ? 2500 : 60000); document.addEventListener("visibilitychange", visible); window.addEventListener("focus", visible);
    return () => { controller.abort(); if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [artistId, activeJobs, refreshDetail]);
  useEffect(() => { if (dialog?.type !== "add_artist") connectionDraft.current = null; }, [dialog?.type]);
  function navigate(artist = "", release = "", track = "", nextTab: MemberMusicTab = "review") {
    activeArtist.current = artist; setArtistId(artist); setReleaseId(release); setTrackId(track); setTab(nextTab); setPage(1); setSearch(""); setError(""); setMessage("");
    const query = new URLSearchParams(); if (artist) query.set("artist", artist); if (release) query.set("release", release); if (track) query.set("track", track); if (release) query.set("tab", nextTab);
    const prefix = window.location.pathname.startsWith("/en/") ? "/en" : "";
    window.history.pushState({}, "", `${prefix}/mypage/music${query.size ? `?${query}` : ""}`);
  }
  function acceptLibrary(library: Library) {
    if (activeArtist.current === library.id) { latest.current = library; setDetail((previous) => previous?.library.id === library.id ? { ...previous, library } : { library, jobs: [], reviews: [], evidence: [], events: [] }); }
    setIndex((previous) => previous ? { ...previous, libraries: previous.libraries.some((item) => item.id === library.id) ? previous.libraries.map((item) => item.id === library.id ? library : item) : [...previous.libraries, library] } : previous);
  }
  async function run(callback: () => Promise<void>, close = false) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try { await callback(); if (close) setDialog(null); setMessage("저장했습니다."); } catch (error) { setError(failure(error)); throw error; } finally { setBusy(false); }
  }
  function act(callback: () => Promise<void>, close = false) { void run(callback, close).catch(() => {}); }
  async function commands(values: ArchiveCommand[]) {
    const library = latest.current; if (!library || library.id !== artistId) throw new Error("아티스트를 다시 선택해 주세요.");
    const result = await archiveRequest<{ library: Library }>("", { action: "commands", libraryId: library.id, version: library.version, commands: albumDisplayCommands(values, groupArchiveAlbums(library.data)) }); acceptLibrary(result.library);
  }
  async function addArtist(name: string, candidate?: ArtistCandidate, link?: MusicProviderLink) {
    if (busy) return; setBusy(true); setError(""); setMessage("");
    try {
      let library = dialog?.type === "connect" ? latest.current : connectionDraft.current; let jobs: SyncJob[] = []; let syncNotice = "";
      if (!library) { const created = await archiveRequest<{ library: Library }>("", { action: "create", name }); library = created.library; connectionDraft.current = library; acceptLibrary(library); }
      if (candidate || link) {
        const connected = await archiveRequest<SyncResponse & { library: Library }>("", { action: "connect", libraryId: library.id, version: library.version, provider: candidate?.provider ?? link!.provider, externalId: candidate?.externalId ?? link!.externalId, url: candidate?.url ?? link!.url, candidateName: name });
        library = connected.library; jobs = responseSyncJobs(connected); syncNotice = connected.syncNotice ?? ""; connectionDraft.current = library;
      }
      navigate(library.id); acceptLibrary(library);
      if (jobs.length) setDetail((previous) => previous?.library.id === library.id ? { ...previous, jobs: mergeSyncJobs(previous.jobs, jobs) } : previous);
      setDialog(null); connectionDraft.current = null; setMessage(syncNotice || (jobs.some((job) => ["queued", "running"].includes(job.status)) ? "" : "아티스트를 저장했습니다."));
    } catch (error) { setError(failure(error)); throw error; } finally { setBusy(false); }
  }
  async function removeArtist() {
    if (busy || !pendingRemoval) return;
    const target = pendingRemoval;
    setBusy(true); setRemovalError(""); setError(""); setMessage("");
    function finish(saved: Library) {
      acceptLibrary(saved); setPendingRemoval(null); setMessage("아티스트를 내 목록에서 삭제했습니다.");
    }
    try {
      const result = await archiveRequest<{ library: Library }>("", { action: "archive", libraryId: target.id, version: target.version });
      finish(result.library);
    } catch (error) {
      // A failed response may follow a successful archive. Reconcile the saved
      // state, or refresh a conflicting version before the member confirms again.
      try {
        const refreshed = await archiveRequest<LibraryDetail>(`?libraryId=${encodeURIComponent(target.id)}`);
        acceptLibrary(refreshed.library);
        if (refreshed.library.archived_at) { finish(refreshed.library); return; }
        setPendingRemoval(refreshed.library);
      } catch { /* Keep the original item and error when confirmation is unavailable. */ }
      setRemovalError(failure(error));
    } finally { setBusy(false); }
  }
  const library = current?.library; const sourceData = library?.data;
  const albumGroups = useMemo(() => sourceData ? groupArchiveAlbums(sourceData) : [], [sourceData]);
  const displayDetail = useMemo(() => current ? albumDisplayDetail(current, albumGroups) : null, [current, albumGroups]);
  const data = displayDetail?.library.data;
  const albumGroup = albumGroups.find(group => group.releaseIds.includes(releaseId));
  const release = data?.releases.find(item => item.id === albumGroup?.release.id);
  const albumTracks = data?.tracks.filter((item) => item.releaseId === release?.id).sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber) ?? [];
  const albumCredits = new Map(data ? trackCopyrightCredits(data, albumTracks).map(credits => [credits.track.id, credits]) : []);
  const releaseTracks = albumTracks.filter((item) => item.managed);
  const selectedTrackId = albumGroup?.tracks.find(item => item.trackIds.includes(trackId))?.track.id;
  const track = releaseTracks.find((item) => item.id === selectedTrackId);
  const sourceTrack = sourceData?.tracks.find(item => item.id === track?.id);
  const libraries = index?.libraries.filter((item) => !item.archived_at) ?? [];
  const releases = albumGroups.filter(group => !search || sourceData?.releases.some(item => group.releaseIds.includes(item.id) && item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))).map(group => group.release).sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || "") || a.id.localeCompare(b.id));
  const importProviders = availableImportProviders(index?.providers ?? []);
  async function refreshMusic() {
    if (!data) return;
    for (const provider of importProviders.filter((provider) => data.connections.some((connection) => connection.provider === provider.id))) {
      const result = await archiveRequest<SyncResponse>("", { action: "sync", libraryId: artistId, provider: provider.id });
      const jobs = responseSyncJobs(result); if (jobs.length) setDetail((previous) => previous?.library.id === artistId ? { ...previous, jobs: mergeSyncJobs(previous.jobs, jobs) } : previous);
    }
    await refreshDetail(artistId);
  }
  async function refreshMetadata() {
    if (busy) return;
    let notice = "앨범 정보를 다시 가져왔습니다.";
    await run(async () => {
      let offset: number | null = 0; let refreshReleaseIds: string[] | undefined;
      do {
        const saved = latest.current;
        if (!saved || saved.id !== artistId || !release) throw new Error("앨범을 다시 선택해 주세요.");
        const result: { library: Library; metadataNotice?: string; nextOffset?: number | null; refreshReleaseIds?: string[] } = await archiveRequest("", { action: "refresh-metadata", libraryId: saved.id, version: saved.version, releaseId: release.id, ...(offset ? { offset } : {}), ...(refreshReleaseIds ? { refreshReleaseIds } : {}) });
        acceptLibrary(result.library); notice = result.metadataNotice || notice;
        offset = result.nextOffset ?? null; refreshReleaseIds = result.refreshReleaseIds;
      } while (offset !== null);
      await refreshDetail(artistId);
    });
    setMessage(notice);
  }
  const panelTitle = dialog?.type === "add_artist" ? "아티스트 추가" : dialog?.type === "connect" ? "앨범 찾아보기" : dialog?.type === "artist" ? "아티스트 수정" : dialog?.type === "release" ? (dialog.release ? "앨범 수정" : "앨범 추가") : dialog?.track ? "트랙 수정" : "트랙 추가";
  return <DashboardShell title="내 음악 관리" description="내 음악과 심의·등록 정보를 한곳에서 관리하세요." activeTab="music" tabs={english ? englishDefaultDashboardTabs : undefined} contextLabel={english ? "My Page" : "마이페이지"} action={!artistId ? <Button primary disabled={loading || loginRequired} onClick={() => setDialog({ type: "add_artist" })}><Plus className="h-4 w-4" aria-hidden />아티스트 추가</Button> : undefined}>
    <div className="space-y-5" data-testid="music-archive">
      {error && <Notice error>{error}</Notice>}{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      {loading ? <p role="status" className="flex items-center justify-center gap-2 py-10"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />내 음악을 불러오고 있습니다.</p> : loginRequired ? <Notice><Link className="font-bold underline" href={`${localePrefix}/login?next=${encodeURIComponent(`${localePrefix}/mypage/music`)}`}>로그인하고 내 음악 관리 시작</Link></Notice> : index && <>
        {!artistId ? <>
          {!libraries.length ? <div className={`${panelClass} space-y-3 py-12 text-center`}><Music2 className="mx-auto h-9 w-9" aria-hidden /><h2 className="font-black">내 아티스트를 추가해 주세요</h2><p className="text-sm text-muted-foreground">발매한 음악을 찾아 한곳에 모아드립니다.</p></div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{libraries.map((item) => <article key={item.id} aria-labelledby={`artist-card-${item.id}`} className={`${panelClass} space-y-3`}>
            <button type="button" disabled={busy} onClick={() => navigate(item.id)} className="flex w-full items-center gap-3 rounded-lg text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"><Cover small kind="artist" src={item.data.artist.imageUrl} fallbackSources={item.data.releases.filter(release => !release.excluded && !release.mergedInto).map(release => release.imageUrl)} title={item.data.artist.name} /><span className="min-w-0 flex-1"><strong id={`artist-card-${item.id}`} className="block break-words text-lg">{item.data.artist.name}</strong><span className="mt-1 block text-sm text-muted-foreground">앨범 {libraryDisplayCounts(item).releaseCount}개 · 트랙 {libraryDisplayCounts(item).trackCount}개</span></span><ChevronRight className="h-4 w-4 shrink-0" aria-hidden /></button>
            <div className="flex justify-end border-t border-border pt-2"><button type="button" disabled={busy} aria-label="아티스트 삭제" aria-describedby={`artist-card-${item.id}`} onClick={() => { setRemovalError(""); setPendingRemoval(item); }} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden />삭제</button></div>
          </article>)}</div>}
          {index.nextPage != null && <div className="flex justify-center"><Button disabled={busy} onClick={() => act(async () => { const result = await archiveRequest<ArchiveIndex>(`?page=${index.nextPage}`); setIndex((previous) => previous ? { ...result, libraries: [...previous.libraries, ...result.libraries.filter((item) => !previous.libraries.some((saved) => saved.id === item.id))] } : result); })}>아티스트 더 보기</Button></div>}
        </> : detailLoading && !current ? <p role="status" className="py-10 text-center">음악을 불러오고 있습니다.</p> : data && library && current ? <>
          <nav aria-label="내 음악 경로" className="flex flex-wrap items-center gap-2 text-sm"><Button onClick={() => navigate(release ? artistId : "")}><ArrowLeft className="h-4 w-4" aria-hidden />{release ? "앨범 목록" : "아티스트 목록"}</Button>{release && <span className="min-w-0 break-words text-muted-foreground">{data.artist.name}</span>}</nav>
          {!release ? <>
            <section className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><Cover small kind="artist" src={data.artist.imageUrl} fallbackSources={releases.map(item => item.imageUrl)} title={data.artist.name} /><div className="min-w-0"><h2 className="break-words text-2xl font-black">{data.artist.name}</h2><p className="mt-1 text-sm text-muted-foreground">앨범 {releases.length}개</p></div></div><div className="ml-auto flex w-full flex-wrap justify-end gap-2 sm:w-auto"><Button disabled={busy || !!activeJobs} onClick={() => setDialog({ type: "connect" })}><Search className="h-4 w-4" aria-hidden />앨범 찾아보기</Button>{importProviders.some((provider) => data.connections.some((connection) => connection.provider === provider.id)) && <Button disabled={busy || !!activeJobs} onClick={() => act(refreshMusic)}><RefreshCw className="h-4 w-4" aria-hidden />새 발매작 확인</Button>}</div></div><SyncStatus jobs={current.jobs} busy={busy} resumableProviders={importProviders.map((provider) => provider.id)} onResume={(jobId) => act(async () => { await archiveRequest("", { action: "resume", jobId }); await refreshDetail(artistId); })} /></section>
            <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><input aria-label="앨범 검색" className={inputClass} placeholder="앨범 검색" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div><Button onClick={() => setDialog({ type: "release" })}><Plus className="h-4 w-4" aria-hidden />앨범 추가</Button></div>
            {!releases.length && <div className={`${panelClass} py-10 text-center text-sm text-muted-foreground`}>{search ? "일치하는 앨범이 없습니다." : "아직 추가한 앨범이 없습니다."}</div>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{releases.slice(0, page * 24).map((item) => <button type="button" key={item.id} onClick={() => navigate(artistId, item.id)} className={`${panelClass} flex items-start gap-3 text-left transition hover:border-foreground`}><Cover small src={item.imageUrl} title={item.title} /><span className="min-w-0"><strong className="block break-words">{item.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{[item.releaseDate, `${data.tracks.filter((track) => track.releaseId === item.id && !track.excluded && !track.mergedInto).length}곡`].filter(Boolean).join(" · ")}</span><span className="mt-2 block"><MusicStatusBadge status={memberReviewStatus(displayDetail!, item.id)} /></span></span></button>)}</div>
            {releases.length > page * 24 && <div className="flex justify-center"><Button onClick={() => setPage(page + 1)}>앨범 더 보기</Button></div>}
            <div className="flex justify-end"><button type="button" className="min-h-10 text-xs text-muted-foreground underline underline-offset-4" onClick={() => setDialog({ type: "artist" })}>아티스트 이름 수정</button></div>
          </> : <>
            <section className={`${panelClass} flex flex-wrap items-center gap-4`}><Cover src={release.imageUrl} title={release.title} /><div className="min-w-0 flex-1"><h2 className="break-words text-xl font-black">{release.title}</h2><p className="mt-1 text-sm text-muted-foreground">{[release.releaseDate, `${albumTracks.length}곡`].filter(Boolean).join(" · ")}</p></div><div className="ml-auto flex flex-wrap justify-end gap-2"><Button disabled={busy || !!activeJobs} onClick={() => { void refreshMetadata().catch(() => {}); }}><RefreshCw className="h-4 w-4" aria-hidden />앨범 정보 다시 가져오기</Button><Button onClick={() => setDialog({ type: "release", release: sourceData!.releases.find(item => item.id === release.id) })}>수정</Button></div></section>
            {albumTracks.some((item) => !item.managed) && <details key={release.id} open={!releaseTracks.length} className={panelClass}>
              <summary className="cursor-pointer text-sm font-bold">전체 수록곡 {albumTracks.length}곡</summary>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">앨범의 전체 수록곡과 확인된 저작자 정보입니다. 아래 관리 목록에는 이 아티스트의 곡으로 연결된 항목만 표시됩니다.</p>
              <ol aria-label="앨범 전체 수록곡" className="mt-3 divide-y divide-border">{albumTracks.map((item) => {
                const credits = albumCredits.get(item.id);
                return <li key={item.id} className="flex items-start gap-3 py-3 text-sm"><span className="shrink-0 text-muted-foreground">{item.discNumber > 1 ? `${item.discNumber}-` : ""}{item.trackNumber}.</span><div className="min-w-0 flex-1"><p className="break-words font-semibold">{item.title}{item.version ? ` (${item.version})` : ""}</p>{item.artistName && <p className="mt-1 break-words text-xs text-muted-foreground">{item.artistName}</p>}{credits && <div className="mt-2 text-xs leading-5"><CopyrightCreditDetails credits={credits} /></div>}<p className="mt-2 text-xs text-muted-foreground">{credits ? "저작자 정보 있음" : "저작자 정보 확인 필요"}</p></div>{item.managed && <span className="shrink-0 text-xs text-muted-foreground">관리 중</span>}</li>;
              })}</ol>
            </details>}
            <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><select className={inputClass} aria-label="관리할 음악" value={track?.id ?? ""} onChange={(event) => navigate(artistId, release.id, event.target.value, tab)}><option value="">앨범 전체</option>{releaseTracks.map((item) => <option key={item.id} value={item.id}>{item.trackNumber}. {item.title}{item.version ? ` (${item.version})` : ""}</option>)}</select></div>{track ? <Button onClick={() => setDialog({ type: "track", track: sourceTrack, release: sourceData!.releases.find(item => item.id === sourceTrack?.releaseId) })}>트랙 수정</Button> : <Button onClick={() => setDialog({ type: "track", release: sourceData!.releases.find(item => item.id === release.id) })}><Plus className="h-4 w-4" aria-hidden />트랙 추가</Button>}</div>
            <nav aria-label="음악 관리 탭" className="grid grid-cols-4 gap-1 border-b border-border">{tabs.map((item) => <button type="button" key={item.key} aria-current={tab === item.key ? "page" : undefined} className={`min-h-12 border-b-2 px-1 text-xs font-bold transition sm:text-sm ${tab === item.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} onClick={() => { navigate(artistId, release.id, track?.id, item.key); if (item.key === "review") setReviewOpenRequest((value) => value + 1); }}>{item.label}</button>)}</nav>
            <MemberMusicStatus key={`${artistId}-${release.id}-${track?.id || "album"}-${tab}`} detail={displayDetail!} release={release} track={track} tab={tab} guides={index.guides} busy={busy} reviewOpenRequest={reviewOpenRequest} onRefreshMetadata={refreshMetadata} onSave={async (body) => { await run(async () => { const saved = latest.current; if (!saved || saved.id !== artistId) throw new Error("아티스트를 다시 선택해 주세요."); const result = await archiveRequest<{ library: Library }>("", { ...body, libraryId: saved.id, version: saved.version }); acceptLibrary(result.library); await refreshDetail(artistId); }); }} />
          </>}
        </> : <Notice>아티스트를 찾을 수 없습니다. <button type="button" className="font-bold underline" onClick={() => navigate()}>내 목록으로 이동</button></Notice>}
      </>}
    </div>
    {dialog && <Modal title={panelTitle} onClose={() => { if (!busy) setDialog(null); }}>
      {(dialog.type === "add_artist" || dialog.type === "connect") && <ArtistConnect providers={index?.providers || []} existingName={dialog.type === "connect" ? data?.artist.name : undefined} busy={busy} onChoose={(name, candidate) => addArtist(name, candidate)} onLink={(name, link) => addArtist(name, undefined, link)} />}
      {sourceData && ["artist", "release", "track"].includes(dialog.type) && <EntityEditor data={sourceData} kind={dialog.type as "artist" | "release" | "track"} release={dialog.release} track={dialog.track} busy={busy} onSave={(values) => run(() => commands(values), true)} />}
    </Modal>}
    {pendingRemoval && <Modal title="아티스트 삭제" onClose={() => { if (!busy) setPendingRemoval(null); }}>
      <p className="break-words text-lg font-black">{pendingRemoval.data.artist.name}</p>
      <p className="text-sm leading-6">이 아티스트와 앨범 {libraryDisplayCounts(pendingRemoval).releaseCount}개를 내 음악 관리 목록에서 숨깁니다. 진행 중인 앨범 불러오기도 중단됩니다.</p>
      <p className="text-sm leading-6 text-muted-foreground">저장된 음악 자료와 심의 신청·결과는 삭제되지 않습니다.</p>
      {removalError && <Notice error>{removalError}</Notice>}
      <div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setPendingRemoval(null)}>취소</Button><Button primary disabled={busy} onClick={() => void removeArtist()}><Trash2 className="h-4 w-4" aria-hidden />{busy ? "삭제 중…" : "삭제"}</Button></div>
    </Modal>}
  </DashboardShell>;
}

"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import {
  kindLabels, queryStatusLabels, resultLabels, sourceLabels, statusLabels,
  type ArchiveLibrary, type ArchiveSourceReference, type ArchiveTask,
} from "@/lib/music-archive/model";
import { archiveRequest, jobLabels, providerNames, type LibraryDetail } from "./types";
import { AdminAlbumEditor } from "./admin-album-editor";
import { Badge, Button, External, Field, Modal, Notice, displayDate, inputClass, panelClass } from "./ui";

export type AdminLibrarySummary = {
  id: string; owner_id: string; version: number; artist_name: string; release_count: number;
  track_count: number; member_name?: string; member_company?: string; archived_at: string | null; updated_at: string;
};
export type AdminLibraryIndex = { libraries?: AdminLibrarySummary[]; total?: number; pageSize?: number; nextPage?: number | null };
export type AdminLibraryDetail = Omit<LibraryDetail, "library" | "events"> & {
  library: ArchiveLibrary;
  events: (LibraryDetail["events"][number] & { actor_id?: string | null; details?: Record<string, unknown> })[];
};
type SourceRow = { id: string; kind: string; title: string; source?: ArchiveSourceReference; userEdited?: boolean; excluded?: boolean; mergedInto?: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "운영 정보를 불러오지 못했습니다.";
const connectionLabels: Record<string, string> = { automatic: "자동 수집", needs_configuration: "설정 필요", partnership_required: "제휴 필요", link_only: "링크 저장", manual: "직접 입력" };

function MetadataSources({ detail }: { detail: AdminLibraryDetail }) {
  const [kind, setKind] = useState("");
  const [limit, setLimit] = useState(25);
  const rows = useMemo<SourceRow[]>(() => [
    ...detail.library.data.releases.map(item => ({ ...item, kind: "발매작" })),
    ...detail.library.data.tracks.map(item => ({ ...item, kind: "트랙" })),
    ...detail.library.data.recordings.map(item => ({ ...item, kind: "녹음" })),
    ...detail.library.data.works.map(item => ({ ...item, kind: "저작물" })),
  ], [detail.library.data]);
  const visible = rows.filter(row => !kind || row.kind === kind);
  return <section aria-labelledby="admin-source-heading" className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3"><h3 id="admin-source-heading" className="font-black">메타데이터 출처 ({rows.length}건)</h3><Field label="정보 종류"><select className={inputClass} value={kind} onChange={event => { setKind(event.target.value); setLimit(25); }}><option value="">전체 정보</option>{["발매작", "트랙", "녹음", "저작물"].map(value => <option key={value}>{value}</option>)}</select></Field></div>
    {visible.slice(0, limit).map(row => <article key={`${row.kind}:${row.id}`} className="min-w-0 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><strong className="break-words">{row.title}</strong><Badge>{row.kind}</Badge>{row.userEdited && <Badge>사용자 수정 포함</Badge>}{row.excluded && <Badge>사용자 제외</Badge>}{row.mergedInto && <Badge>병합됨</Badge>}</div>
      <p className="mt-2">출처: {row.source ? providerNames[row.source.provider] ?? row.source.provider : "사용자 입력"}</p>
      <p className="mt-1 break-all text-xs text-muted-foreground">관리 ID: {row.id}{row.source && <> · 제공처 ID: {row.source.externalId}</>}</p>
      {row.source && <p className="mt-1 text-xs text-muted-foreground">확인 시각: {displayDate(row.source.checkedAt)}</p>}
      {row.mergedInto && <p className="mt-1 break-all text-xs text-muted-foreground">병합 대상: {row.mergedInto}</p>}
    </article>)}
    {!visible.length && <p className="text-sm text-muted-foreground">표시할 정보가 없습니다.</p>}
    {visible.length > limit && <Button onClick={() => setLimit(value => value + 25)}>출처 더 보기</Button>}
  </section>;
}

function TaskRecords({ detail }: { detail: AdminLibraryDetail }) {
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(20);
  const tracks = useMemo(() => new Map(detail.library.data.tracks.map(track => [track.id, track])), [detail.library.data.tracks]);
  const tasks = detail.library.data.tasks.filter(task => (!kind || task.kind === kind) && (!status || task.status === status));
  return <section aria-labelledby="admin-task-heading" className="space-y-3">
    <h3 id="admin-task-heading" className="font-black">업무 기록 ({detail.library.data.tasks.length}건)</h3>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="업무 종류"><select className={inputClass} value={kind} onChange={event => { setKind(event.target.value); setLimit(20); }}><option value="">전체 업무</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="업무 기록 필터"><select className={inputClass} value={status} onChange={event => { setStatus(event.target.value); setLimit(20); }}><option value="">전체 상태</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
    {tasks.slice(0, limit).map(task => <TaskRecord key={task.id} task={task} title={tracks.get(task.trackId)?.title ?? task.trackId} detail={detail} />)}
    {!tasks.length && <p className="text-sm text-muted-foreground">선택한 조건의 업무 기록이 없습니다.</p>}
    {tasks.length > limit && <Button onClick={() => setLimit(value => value + 20)}>업무 기록 더 보기</Button>}
  </section>;
}

function TaskRecord({ task, title, detail }: { task: ArchiveTask; title: string; detail: AdminLibraryDetail }) {
  const evidence = detail.evidence.filter(file => file.task_id === task.id);
  return <article className="min-w-0 space-y-3 rounded-lg border border-border p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><strong className="break-words">{title} · {task.agency}</strong><Badge>{kindLabels[task.kind]}</Badge></div>
    <div className="flex flex-wrap gap-2"><Badge>{statusLabels[task.status]}</Badge><Badge>{resultLabels[task.result]}</Badge><Badge>{sourceLabels[task.source]}</Badge><Badge>{queryStatusLabels[task.queryStatus]}</Badge></div>
    <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
      {([
        ["참여자 / 역할", [task.participant, task.role].filter(Boolean).join(" / ")],
        ["진행 주체", task.executor === "agency" ? `대행사 ${task.agencyName ?? ""}` : task.executor === "onside" ? "온사이드" : task.executor === "self" ? "본인" : ""],
        ["신청일", task.applicationDate], ["처리일", task.completedDate], ["확인일", task.checkedDate], ["재확인일", task.recheckDate],
        ["접수·등록 번호", task.referenceNumber], ["노래방 번호", task.songNumber], ["녹음 ID", task.recordingId], ["저작물 ID", task.workId],
      ] as const).filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0"><dt className="font-bold">{label}</dt><dd className="mt-1 break-words text-muted-foreground">{value}</dd></div>)}
    </dl>
    {task.memo && <p className="whitespace-pre-wrap break-words">{task.memo}</p>}
    {task.applicationUrl && <External href={task.applicationUrl}>신청·조회 근거</External>}
    <p className="break-all text-xs text-muted-foreground">업무 ID: {task.id}</p>
    {evidence.length > 0 && <div className="rounded-lg bg-muted p-3"><h4 className="text-xs font-bold">첨부 증빙 ({evidence.length}개)</h4>{evidence.map(file => <p key={file.id} className="mt-2 break-words text-xs">{file.file_name} · {Math.ceil(file.size_bytes / 1024)} KB · {displayDate(file.created_at)}</p>)}</div>}
  </article>;
}

function LibrarySyncJobs({ detail, onRetry }: { detail: AdminLibraryDetail; onRetry: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function retry(id: string) {
    setBusy(id); setError(""); setMessage("");
    try { await onRetry(id); setMessage("저장된 수집 범위부터 재시도를 요청했습니다."); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(null); }
  }
  return <section className="space-y-3" aria-labelledby="admin-library-jobs-heading">
    <h3 id="admin-library-jobs-heading" className="font-black">아카이브 수집 작업</h3>
    {error && <Notice error>{error}</Notice>}{message && <p role="status" className="text-sm">{message}</p>}
    {detail.jobs.map(job => <article key={job.id} className="min-w-0 space-y-2 rounded-lg border border-border p-3 text-xs"><div className="flex flex-wrap items-center gap-2"><strong>{providerNames[job.provider] ?? job.provider}</strong><Badge>{jobLabels[job.status] ?? job.status}</Badge></div><p className="break-all">작업 ID: {job.id} · 아티스트 ID: {job.external_artist_id}</p><p>발매작 {job.counts?.releases ?? 0}개 · 트랙 {job.counts?.tracks ?? 0}개 · 최근 확인 {displayDate(job.checked_at)}</p>{job.cursor?.scopeNote && <p>{job.cursor.scopeNote}</p>}{job.error_code && <p className="break-words">{job.error_code} · {job.error_message}</p>}{["partial", "blocked", "failed", "queued", "running"].includes(job.status) && <Button disabled={Boolean(busy)} onClick={() => void retry(job.id)}>{busy === job.id ? "요청 중" : "저장 지점부터 재시도"}</Button>}</article>)}
    {!detail.jobs.length && <p className="text-sm text-muted-foreground">수집 작업 이력이 없습니다.</p>}
  </section>;
}

type ResolveConflict = (id: string, resolution: "keep" | "accept") => Promise<void>;

function ConflictRecords({ detail, onResolve }: { detail: AdminLibraryDetail; onResolve: ResolveConflict }) {
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const conflicts = [...detail.library.data.conflicts].reverse();
  if (!conflicts.length) return null;
  async function resolve(id: string, resolution: "keep" | "accept") {
    setBusy(id); setError(""); setMessage("");
    try { await onResolve(id, resolution); setMessage(resolution === "keep" ? "기존 정보를 유지했습니다." : "수집된 변경 정보를 반영했습니다."); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(null); }
  }
  return <section aria-labelledby="admin-conflicts-heading" className="space-y-3">
    <h3 id="admin-conflicts-heading" className="font-black">동기화 변경 후보 ({conflicts.length}건)</h3>
    {error && <Notice error>{error}</Notice>}{message && <p role="status" className="text-sm">{message}</p>}
    {conflicts.slice(0, limit).map(conflict => <article key={conflict.id} className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <p className="break-words font-bold">{(conflict.entityType === "release" ? detail.library.data.releases : detail.library.data.tracks).find(item => item.id === conflict.entityId)?.title ?? conflict.entityId} · {conflict.field}</p>
      <p className="break-all text-muted-foreground">{conflict.entityType === "release" ? "발매작" : "트랙"} ID: {conflict.entityId}</p>
      <p className="break-words">기존값: {String(conflict.current ?? "없음")}</p><p className="break-words">수집값: {String(conflict.incoming ?? "없음")}</p>
      <p>{providerNames[conflict.source.provider] ?? conflict.source.provider} · {displayDate(conflict.createdAt)}</p>
      {conflict.resolved ? <Badge>{conflict.resolved === "keep" ? "기존값 유지" : "수집값 반영"}</Badge> : <div className="flex flex-wrap gap-2"><Button disabled={Boolean(busy)} onClick={() => void resolve(conflict.id, "keep")}>기존값 유지</Button><Button disabled={Boolean(busy)} onClick={() => void resolve(conflict.id, "accept")}>수집값 반영</Button></div>}
    </article>)}
    {conflicts.length > limit && <Button onClick={() => setLimit(value => value + 20)}>변경 후보 더 보기</Button>}
  </section>;
}

function LibraryOperationsDetail({ detail, onRetry, onResolve, onSaved }: { detail: AdminLibraryDetail; onRetry: (id: string) => Promise<void>; onResolve: ResolveConflict; onSaved: () => Promise<void> }) {
  const { library } = detail;
  const [tab, setTab] = useState("albums");
  const tabs = [{ id: "albums", label: "앨범·트랙" }, { id: "sources", label: "출처·연결" }, { id: "tasks", label: "업무 기록" }, { id: "history", label: "변경 이력" }];
  return <div className="min-w-0 space-y-5">
    <div className="space-y-1 break-all text-xs text-muted-foreground"><p>아카이브 ID: {library.id}</p><p>회원 ID: {library.owner_id}</p><p>버전 {library.version} · 최근 변경 {displayDate(library.updated_at)}{library.archived_at ? ` · 보관됨 ${displayDate(library.archived_at)}` : ""}</p></div>
    <div className="flex flex-wrap gap-2" aria-label="아카이브 운영 정보">{tabs.map(item => <Button key={item.id} primary={tab === item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}</div>
    {tab === "albums" && <AdminAlbumEditor library={library} onSaved={onSaved} />}
    {tab === "sources" && <>
      <section aria-labelledby="admin-connections-heading" className="space-y-3"><h3 id="admin-connections-heading" className="font-black">아티스트 연결</h3>{library.data.connections.map((connection, index) => <article key={`${connection.provider}:${connection.externalArtistId}:${index}`} className="min-w-0 rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><strong>{providerNames[connection.provider] ?? connection.provider}</strong><Badge>{connectionLabels[connection.status] ?? connection.status}</Badge><Badge>{connection.confirmed ? "사용자 확인됨" : "미확인"}</Badge></div><p className="mt-2 break-all text-xs">아티스트 ID: {connection.externalArtistId || "미기록"}</p><p className="mt-1 text-xs text-muted-foreground">최근 확인: {displayDate(connection.checkedAt)}</p>{connection.url && <div className="mt-1"><External href={connection.url}>연결된 프로필</External></div>}</article>)}{!library.data.connections.length && <p className="text-sm text-muted-foreground">등록된 제공처 연결이 없습니다.</p>}</section>
      {library.data.artist.links.length > 0 && <section><h3 className="font-black">아티스트 참고 링크</h3><div className="mt-2 flex flex-wrap gap-x-4">{library.data.artist.links.map(link => <External key={`${link.provider}:${link.url}`} href={link.url}>{providerNames[link.provider] ?? link.provider}</External>)}</div></section>}
      <LibrarySyncJobs detail={detail} onRetry={onRetry} />
      <MetadataSources detail={detail} />
      <ConflictRecords detail={detail} onResolve={onResolve} />
    </>}
    {tab === "tasks" && <>
      <TaskRecords detail={detail} />
      {library.data.reviewLinks.length > 0 && <section className="space-y-3"><h3 className="font-black">온사이드 심의 연결</h3>{library.data.reviewLinks.map(link => <div key={link.id} className="min-w-0 rounded-lg border border-border p-3 text-xs"><p className="font-bold">{detail.reviews.find(review => review.id === link.submissionId)?.title || "심의 내역"}</p><p className="mt-1 break-all">심의 ID: {link.submissionId}</p><p className="mt-1 break-all">{link.trackId ? `트랙 ${link.trackId}` : `발매작 ${link.releaseId}`}{link.submissionTrackId ? ` · 심의 트랙 ${link.submissionTrackId}` : ""}</p>{link.note && <p className="mt-2 whitespace-pre-wrap break-words">{link.note}</p>}</div>)}</section>}
      {library.data.affiliations.length > 0 && <section className="space-y-3"><h3 className="font-black">협회 가입 기록</h3>{library.data.affiliations.map(item => <div key={item.id} className="rounded-lg border border-border p-3 text-sm"><strong>{item.agency} · {item.participant}</strong><p className="mt-1">{item.role} · {item.status}</p>{item.memo && <p className="mt-2 whitespace-pre-wrap">{item.memo}</p>}</div>)}</section>}
    </>}
    {tab === "history" && <section className="space-y-3" aria-labelledby="admin-history-heading"><h3 id="admin-history-heading" className="font-black">변경 이력 · 최근 {detail.events.length}건</h3>{detail.events.map(event => <article key={event.id} className="min-w-0 space-y-2 rounded-lg border border-border p-3 text-xs"><p className="break-words font-bold">{event.action}</p><p>{displayDate(event.created_at)} · 버전 {event.before_version} → {event.after_version}</p>{event.actor_id && <p className="break-all text-muted-foreground">처리자: {event.actor_id}</p>}{event.details && Object.keys(event.details).length > 0 && <details><summary className="cursor-pointer font-bold">변경 상세</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3">{JSON.stringify(event.details, null, 2)}</pre></details>}</article>)}{!detail.events.length && <p className="text-sm text-muted-foreground">변경 이력이 없습니다.</p>}</section>}
  </div>;
}

export function AdminLibraryInspector({ initial }: { initial: AdminLibraryIndex }) {
  const [index, setIndex] = useState(initial);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ state: "active", content: "all", sort: "recent", pageSize: "20" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<AdminLibraryDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestId = useRef(0);
  const detailRequestId = useRef(0);
  useEffect(() => { setIndex(initial); setQuery(""); setActiveQuery(""); setPage(0); setFilters({ state: "active", content: "all", sort: "recent", pageSize: "20" }); }, [initial]);
  useEffect(() => () => { requestId.current++; detailRequestId.current++; }, []);

  async function search(nextPage: number, q = activeQuery, nextFilters = filters) {
    const request = ++requestId.current;
    setLoading(true); setError("");
    try {
      const result = await archiveRequest<AdminLibraryIndex>(`?action=admin&q=${encodeURIComponent(q)}&page=${nextPage}&${new URLSearchParams(nextFilters)}`);
      if (requestId.current === request) { setIndex(result); setPage(nextPage); setActiveQuery(q); setFilters(nextFilters); }
    } catch (caught) { if (requestId.current === request) setError(errorMessage(caught)); }
    finally { if (requestId.current === request) setLoading(false); }
  }
  async function inspect(id: string) {
    const request = ++detailRequestId.current;
    setSelectedId(id); setDetail(null); setError("");
    try { const result = await archiveRequest<AdminLibraryDetail>(`?action=admin-library&libraryId=${encodeURIComponent(id)}`); if (detailRequestId.current === request) setDetail(result); }
    catch (caught) { if (detailRequestId.current === request) { setError(errorMessage(caught)); setSelectedId(null); } }
  }
  async function retry(jobId: string) {
    const libraryId = detail?.library.id;
    if (!libraryId) return;
    const request = detailRequestId.current;
    await archiveRequest("", { action: "admin-retry", jobId });
    const updated = await archiveRequest<AdminLibraryDetail>(`?action=admin-library&libraryId=${encodeURIComponent(libraryId)}`);
    if (detailRequestId.current === request) setDetail(updated);
  }
  async function resolveConflict(conflictId: string, resolution: "keep" | "accept") {
    if (!detail) return;
    const request = detailRequestId.current;
    await archiveRequest("", { action: "admin-resolve-conflict", libraryId: detail.library.id, version: detail.library.version, conflictId, resolution });
    const updated = await archiveRequest<AdminLibraryDetail>(`?action=admin-library&libraryId=${encodeURIComponent(detail.library.id)}`);
    if (detailRequestId.current === request) setDetail(updated);
  }
  async function reloadDetail() {
    if (!detail) return;
    const request = detailRequestId.current;
    const updated = await archiveRequest<AdminLibraryDetail>(`?action=admin-library&libraryId=${encodeURIComponent(detail.library.id)}`);
    if (detailRequestId.current === request) setDetail(updated);
    await search(page);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void search(0, query.trim()); }
  const libraries = index.libraries ?? [];
  return <section className={panelClass} aria-labelledby="admin-libraries-heading">
    <h2 id="admin-libraries-heading" className="text-lg font-black">회원 음악 아카이브</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">회원 또는 아티스트를 찾고 누락 앨범을 추가하세요. 목록은 필요한 범위만 불러옵니다.</p>
    <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={submit}><div className="min-w-0 flex-1"><Field label="회원·아티스트 검색"><input className={inputClass} value={query} maxLength={100} placeholder="회원명, 소속, 아티스트 이름 또는 회원 ID" onChange={event => setQuery(event.target.value)} /></Field></div><Button type="submit" disabled={loading}><Search className="h-4 w-4" aria-hidden />검색</Button>{activeQuery && <Button disabled={loading} onClick={() => { setQuery(""); void search(0, ""); }}>검색 해제</Button>}</form>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([
      ["state", "아카이브", [["active", "사용 중"], ["archived", "보관됨"], ["all", "전체"]]],
      ["content", "앨범·트랙", [["all", "전체"], ["no_albums", "앨범 없는 회원"], ["no_tracks", "트랙 없는 회원"]]],
      ["sort", "정렬", [["recent", "최근 변경순"], ["oldest", "오래된 변경순"], ["artist", "아티스트 이름순"], ["albums", "앨범 많은 순"]]],
      ["pageSize", "페이지당 표시", [["20", "20개"], ["50", "50개"], ["100", "100개"]]],
    ] as const).map(([key, label, options]) => <Field key={key} label={label}><select className={inputClass} value={filters[key]} disabled={loading} onChange={event => { const next = { ...filters, [key]: event.target.value }; void search(0, activeQuery, next); }}>{options.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></Field>)}</div>
    {error && <div className="mt-3"><Notice error>{error}</Notice></div>}
    {loading && <p role="status" className="mt-3 text-sm">아카이브 목록을 불러오고 있습니다.</p>}
    <div className="mt-4 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="p-3 font-semibold">회원 / 소속</th><th className="p-3 font-semibold">아티스트</th><th className="p-3 text-right font-semibold">앨범 / 트랙</th><th className="p-3 font-semibold">최근 변경</th><th className="p-3 text-right font-semibold">관리</th></tr></thead><tbody className="divide-y divide-border">{libraries.map(library => <tr key={library.id} className="hover:bg-muted/30"><td className="max-w-44 p-3"><p className="break-words font-semibold">{library.member_name || "회원명 미입력"}</p>{library.member_company && <p className="mt-1 break-words text-xs text-muted-foreground">{library.member_company}</p>}<details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">회원 ID</summary><p className="mt-1 break-all">{library.owner_id}</p></details></td><td className="max-w-52 p-3"><strong className="break-words">{library.artist_name}</strong>{library.archived_at && <span className="ml-2"><Badge>보관됨</Badge></span>}</td><td className="p-3 text-right tabular-nums">{library.release_count} / {library.track_count}</td><td className="p-3 text-xs text-muted-foreground">{displayDate(library.updated_at)}</td><td className="p-3 text-right"><Button onClick={() => void inspect(library.id)} aria-label={`${library.artist_name} 운영 정보 보기`}>관리</Button></td></tr>)}</tbody></table></div>
    {!loading && !libraries.length && <p className="mt-4 text-sm text-muted-foreground">검색 조건에 맞는 아카이브가 없습니다.</p>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">검색 결과 {index.total ?? libraries.length}건 · {page + 1} / {Math.max(1, Math.ceil((index.total ?? libraries.length) / Number(filters.pageSize)))}페이지</p><div className="flex gap-2"><Button disabled={loading || page === 0} onClick={() => void search(page - 1)}>이전</Button><Button disabled={loading || index.nextPage == null} onClick={() => index.nextPage != null && void search(index.nextPage)}>다음</Button></div></div>
    {selectedId && <Modal title={detail ? `${detail.library.data.artist.name} 운영 정보` : "아카이브 운영 정보"} onClose={() => { detailRequestId.current++; setSelectedId(null); setDetail(null); }}>{detail ? <LibraryOperationsDetail detail={detail} onRetry={retry} onResolve={resolveConflict} onSaved={reloadDetail} /> : <p role="status" className="text-sm">아카이브 운영 정보를 불러오고 있습니다.</p>}</Modal>}
  </section>;
}

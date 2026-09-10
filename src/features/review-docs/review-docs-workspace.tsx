"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REVIEW_DOC_LIMITS, validateReviewData, canConfirmReviewIssue, type ReviewAlbum, type ReviewDocumentData, type ReviewTrack, type ReviewIssue } from "@/lib/review-docs/model";
import { getReviewRetrySourceIds } from "@/lib/review-docs/retry";
import type { publicReviewJob } from "@/lib/review-docs/jobs-types";
import { alignTranslationSegments, emptyAlbum, emptyTrack, mergeReviewAlbums, moveReviewTrack, reorderReviewTrack } from "./editor";

type Job = ReturnType<typeof publicReviewJob>;
type Tab = "files" | "urls" | "mv";
const busyStatuses = new Set(["queued", "uploading", "extracting", "translating", "generating", "validating"]);
const statusLabels: Record<Job["status"], string> = { uploading: "업로드 중", queued: "작업 대기", extracting: "자료 분석 중", translating: "번역 중", needs_review: "확인·수정 필요", generating: "문서 생성 중", validating: "결과 검사 중", completed: "생성 완료", failed: "작업 실패", cancelled: "취소됨", expired: "보관 만료" };
const tabs: { id: Tab; label: string }[] = [{ id: "files", label: "기준파일 · 음반" }, { id: "urls", label: "멜론·지니 URL · 음반" }, { id: "mv", label: "영등위 · 곡별 가사" }];
const inputClass = "mt-1 w-full rounded-[8px] border-2 border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60";
const buttonClass = "rounded-[8px] border-2 border-border px-3 py-2 text-sm font-bold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const panelClass = "rounded-[12px] border-2 border-border bg-card p-4 sm:p-5";
const uid = () => crypto.randomUUID();
const toggle = (items: string[], value: string, checked: boolean) => checked ? [...new Set([...items, value])] : items.filter((item) => item !== value);
const formatDate = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(options?.signal?.reason);
  if (options?.signal?.aborted) cancel();
  else options?.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException("서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.", "TimeoutError")), 60_000);
  try {
    const response = await fetch(url, { ...options, cache: "no-store", credentials: "same-origin", signal: controller.signal });
    let body: Record<string, unknown>;
    try { body = await response.json(); } catch { throw new Error("서버 응답을 읽을 수 없습니다. 연결 상태를 확인한 후 다시 시도해주세요."); }
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "작업을 처리할 수 없습니다. 다시 시도해주세요.");
    return body as T;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", cancel);
  }
}
function Field({ label, value, onChange, multiline = false, type = "text" }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; type?: string }) {
  return <label className="block min-w-0 text-xs font-semibold text-muted-foreground">{label}{multiline
    ? <textarea className={`${inputClass} min-h-28 resize-y leading-6`} value={value} onChange={(event) => onChange(event.target.value)} />
    : <input className={inputClass} type={type} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

export function ReviewDocsWorkspace() {
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [draft, setDraft] = useState<ReviewDocumentData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [workerReady, setWorkerReady] = useState<boolean | null>(null);
  const [workerMode, setWorkerMode] = useState<"dedicated" | "web" | "unavailable">("unavailable");
  const [workerError, setWorkerError] = useState("");
  const [supportedFormats, setSupportedFormats] = useState<string[]>(["docx"]);
  const mounted = useRef(false);
  const historyRequest = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const dirtyRef = useRef(false);
  const selectedId = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const jobId = job?.id;
  const running = Boolean(job && busyStatuses.has(job.status));
  const editable = Boolean(job && !running && !pending && !["cancelled", "expired"].includes(job.status));
  let issues: ReviewIssue[] = [];
  if (draft) {
    try { issues = validateReviewData(draft); }
    catch { issues = [{ id: "invalid-input", code: "INVALID_INPUT", severity: "error", message: "신청일·입력 길이·WBS 선택 수를 확인해주세요. 날짜를 입력하고 WBS는 최대 3곡까지 선택할 수 있습니다." }]; }
  }
  const blocking = issues.filter((issue) => issue.severity === "error");
  const failedSourceCount = draft && job ? getReviewRetrySourceIds(draft, job.sources).length : 0;
  const confirmedIssues = draft?.issues.filter((issue) => canConfirmReviewIssue(issue) && draft.confirmedIssueIds.includes(issue.id)) ?? [];

  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  const acceptJob = useCallback((next: Job, replaceDraft = false) => {
    if (!mounted.current) return;
    loadSequence.current += 1;
    setJob(next); selectedId.current = next.id;
    setJobs((current) => [next, ...current.filter((item) => item.id !== next.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    if (replaceDraft || !dirtyRef.current) { setDraft(next.data); markDirty(false); }
  }, [markDirty]);
  const loadHistory = useCallback(() => {
    if (historyRequest.current) return historyRequest.current.promise;
    const controller = new AbortController();
    const sequence = loadSequence.current;
    const promise = (async () => {
      try {
        const result = await api<{ jobs: Job[]; workerReady: boolean; workerMode?: "dedicated" | "web" | "unavailable"; supportedFormats?: string[]; workerError?: string }>("/api/admin/review-docs/jobs", { signal: controller.signal });
        if (controller.signal.aborted) return;
        // A history response started before a save/selection must not replace newer job summaries.
        if (sequence === loadSequence.current) setJobs(result.jobs);
        setWorkerReady(result.workerReady === true); setHistoryError("");
        setWorkerMode(result.workerMode ?? (result.workerReady ? "dedicated" : "unavailable"));
        setWorkerError(result.workerError ?? "");
        setSupportedFormats((result.supportedFormats ?? (result.workerMode === "web" ? ["docx"] : ["doc", "docx", "hwp", "pdf"]))
          .filter((format) => ["doc", "docx", "hwp", "pdf"].includes(format)));
      } catch (error) {
        if (controller.signal.aborted) return;
        setWorkerReady(null);
        setWorkerMode("unavailable");
        setHistoryError(error instanceof Error ? error.message : "작업 이력과 연결 상태를 불러오지 못했습니다. 잠시 후 다시 확인합니다.");
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
        if (historyRequest.current?.controller === controller) historyRequest.current = null;
      }
    })();
    historyRequest.current = { controller, promise };
    return promise;
  }, []);
  const loadJob = useCallback(async (id: string, replaceDraft = false) => {
    const sequence = ++loadSequence.current;
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    try {
      const result = await api<{ job: Job }>(`/api/admin/review-docs/jobs/${id}`, { signal: controller.signal });
      if (!controller.signal.aborted && sequence === loadSequence.current) acceptJob(result.job, replaceDraft);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (detailRequest.current === controller) detailRequest.current = null;
    }
  }, [acceptJob]);

  useEffect(() => {
    mounted.current = true;
    void loadHistory();
    const refresh = () => { if (!document.hidden) void loadHistory(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      historyRequest.current?.controller.abort(); historyRequest.current = null;
      detailRequest.current?.abort(); detailRequest.current = null;
      loadSequence.current += 1;
    };
  }, [loadHistory]);
  useEffect(() => {
    if (!jobId || !running) return;
    const id = jobId;
    let stopped = false;
    let timer: number;
    const refresh = async () => {
      if (selectedId.current === id && !document.hidden && !detailRequest.current) {
        try { await loadJob(id); }
        catch (error) { if (!stopped && mounted.current) setError(error instanceof Error ? error.message : "작업 상태 조회에 실패했습니다. 상태 새로고침을 눌러주세요."); }
      }
      if (!stopped) timer = window.setTimeout(() => void refresh(), 4_000);
    };
    timer = window.setTimeout(() => void refresh(), 4_000);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [jobId, running, loadJob]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(update: (current: ReviewDocumentData) => ReviewDocumentData) {
    setDraft((current) => current ? update(current) : current); markDirty(true); setNotice("");
  }
  function albumEdit(id: string, update: (album: ReviewAlbum) => ReviewAlbum) {
    edit((data) => ({ ...data, albums: data.albums.map((album) => album.id === id ? update(album) : album) }));
  }
  function trackEdit(albumId: string, trackId: string, update: (track: ReviewTrack) => ReviewTrack) {
    albumEdit(albumId, (album) => ({ ...album, tracks: album.tracks.map((track) => track.id === trackId ? update(track) : track) }));
  }
  async function perform(task: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError(""); setNotice("");
    try { await task(); } catch (error) {
      if (mounted.current) setError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "서버 응답이 지연되고 있습니다. 작업 이력을 새로고침해 접수 여부를 확인해주세요.");
    } finally { if (mounted.current) setPending(false); }
  }
  async function createJob() {
    if (dirty || workerReady !== true) return;
    await perform(async () => {
      let options: RequestInit;
      if (tab === "urls") {
        const list = urls.split(/\s+/).map((url) => url.trim()).filter(Boolean);
        if (!list.length || list.length > REVIEW_DOC_LIMITS.urls) throw new Error(`멜론·지니 URL을 1~${REVIEW_DOC_LIMITS.urls}개 입력해주세요.`);
        if (new Set(list).size !== list.length) throw new Error("중복 URL이 있습니다. 같은 URL은 한 번만 입력해주세요.");
        options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: list, mode: "album" }) };
      } else {
        if (!files.length || files.length > REVIEW_DOC_LIMITS.files) throw new Error(`파일을 1~${REVIEW_DOC_LIMITS.files}개 선택해주세요.`);
        if (files.some((file) => file.size > REVIEW_DOC_LIMITS.fileBytes) || files.reduce((total, file) => total + file.size, 0) > REVIEW_DOC_LIMITS.totalBytes) throw new Error("파일은 개별 10MB, 전체 40MB 이내로 업로드해주세요.");
        const body = new FormData(); files.forEach((file) => body.append("files", file)); body.set("mode", tab === "mv" ? "mv" : "album");
        options = { method: "POST", body };
      }
      const result = await api<{ job: Job; duplicate: boolean }>("/api/admin/review-docs/jobs", options);
      if (!mounted.current) return;
      acceptJob(result.job, true); setNotice(result.duplicate ? "같은 입력으로 생성된 기존 작업을 열었습니다. 중복 작업은 생성하지 않았습니다." : "작업이 접수되었습니다. 분석이 끝나면 아래에서 결과를 확인해주세요.");
    });
  }
  async function save() {
    if (!job || !draft) return;
    await perform(async () => {
      const result = await api<{ job: Job }>(`/api/admin/review-docs/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: job.version, data: draft }) });
      if (!mounted.current) return;
      acceptJob(result.job, true); setNotice("수정 내용을 저장했습니다.");
    });
  }
  async function action(action: "generate" | "translate" | "retry" | "cancel") {
    if (!job || dirty || (action !== "cancel" && workerReady !== true)) return;
    await perform(async () => {
      const result = await api<{ job: Job }>(`/api/admin/review-docs/jobs/${job.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: job.version }) });
      acceptJob(result.job, true);
    });
  }
  const sourceChecks = (selected: string[], onChange: (ids: string[]) => void) => <div className="flex flex-wrap gap-x-5 gap-y-2">{draft?.sources.map((source) => <Check key={source.id} label={source.name} checked={selected.includes(source.id)} onChange={(checked) => onChange(toggle(selected, source.id, checked))} />)}</div>;

  return <div className="mt-7 space-y-6">
    {workerReady === false && <p role="status" className="rounded-[8px] border-2 border-amber-500/60 bg-amber-500/10 p-4 text-sm">{workerError || "문서 처리 작업자가 연결되어 있지 않습니다. 연결 상태를 자동으로 확인하고 있습니다. 기존 자료를 확인·수정할 수 있으며, 새 분석·번역·생성은 연결이 복구되면 진행할 수 있습니다."}</p>}
    {workerMode === "web" && <p role="status" className="rounded-[8px] border border-emerald-600/40 bg-emerald-600/5 p-4 text-sm">{supportedFormats.length > 1 ? "DOC · DOCX · HWP · PDF 파일과 멜론·지니 URL을 바로 분석할 수 있습니다." : "DOCX 파일과 멜론·지니 URL은 바로 분석할 수 있습니다. DOC·HWP·PDF는 DOCX로 저장해서 업로드해주세요."}</p>}
    <section className={panelClass} aria-label="자료 입력">
      <div role="tablist" aria-label="생성 방식" className="flex flex-wrap gap-2">{tabs.map((item) => <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls="review-input-panel" onClick={() => setTab(item.id)} className={`${buttonClass} ${tab === item.id ? "border-[#111111] bg-[#f2cf27] text-[#111111]" : ""}`}>{item.label}</button>)}</div>
      <div id="review-input-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-5 space-y-4">
        <p className="text-sm text-muted-foreground">{tab === "mv" ? "아티스트·곡명·가사로 곡별 DOCX를 만듭니다. 한 곡도 DOCX와 ZIP을 각각 다운로드할 수 있습니다." : tab === "urls" ? "멜론·지니 링크로 앨범 정보·트랙·크레딧·가사를 분석합니다. URL별 결과를 확인하고 같은 앨범의 자료를 합칠 수 있습니다." : "한 앨범의 자료를 여러 파일로, 여러 앨범을 한 파일로 업로드할 수 있습니다. 분석 후 원본 연결과 트랙 순서를 확인해주세요."}</p>
        {tab === "urls" ? <Field label="멜론·지니 URL (한 줄에 하나, 최대 8개)" value={urls} onChange={setUrls} multiline /> : <div>
          <label className="block text-sm font-semibold">기준파일 선택<input type="file" multiple accept={supportedFormats.map((format) => `.${format}`).join(",")} onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className={`${inputClass} file:mr-4 file:rounded file:border-0 file:px-3 file:py-1`} /></label>
          <p className="mt-2 text-xs text-muted-foreground">{supportedFormats.length <= 1 ? "DOCX / 최대 8개, 파일당 10MB, 전체 40MB" : "DOC · DOCX · HWP · PDF / 최대 8개, 파일당 10MB, 전체 40MB, PDF 파일당 80쪽"}</p>
          {files.length > 0 && <ul className="mt-3 space-y-1 text-sm">{files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3"><span className="break-all">{file.name} ({(file.size / 1024 / 1024).toFixed(2)}MB)</span><button type="button" className="shrink-0 text-xs underline" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>제외</button></li>)}</ul>}
        </div>}
        <button type="button" className="bauhaus-button px-5 py-3 text-sm disabled:opacity-50" onClick={() => void createJob()} disabled={pending || dirty || workerReady !== true}>{pending ? "처리 중…" : "업로드·분석 시작"}</button>
        <details className="text-xs leading-6 text-muted-foreground"><summary className="cursor-pointer font-semibold">처리 범위와 보관 기간</summary><p>최대 8개 앨범·100곡, 번역 요청당 60,000자, 작업당 추가 번역 요청은 최대 3회. 한 관리자당 진행 중 작업은 최대 3개이며, 변환은 한 번에 1개씩 처리합니다. 작업은 최대 15분, 원본·결과는 7일간 비공개 보관합니다. 스캔 PDF는 OCR 설치 상태와 인식 결과를 확인해야 합니다. 변환기나 템플릿이 없으면 해당 원인을 표시합니다.</p></details>
      </div>
    </section>

    {(error || historyError) && <div role="alert" className="rounded-[8px] border-2 border-red-500/60 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{error || historyError}</div>}
    {notice && <p role="status" className="rounded-[8px] border-2 border-emerald-600/50 bg-emerald-500/10 p-4 text-sm">{notice}</p>}

    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-5">
        {job ? <>
          <section className={panelClass} aria-label="작업 상태">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black">{job.mode === "mv" ? "영등위 가사파일" : "음반 심의자료"} · {statusLabels[job.status]}</h2><p className="mt-1 break-all text-xs text-muted-foreground">작업 {job.id} / 자료 버전 {job.version}</p></div><button type="button" className={buttonClass} disabled={pending} onClick={() => void perform(() => loadJob(job.id))}>상태 새로고침</button></div>
            <ol className="mt-4 flex flex-wrap gap-2 text-xs" aria-label="처리 단계">{["자료 입력", "분석·번역", "확인·수정", "생성·검사", "다운로드"].map((label, index) => <li key={label} className="rounded border border-border px-2 py-1">{index + 1}. {label}</li>)}</ol>
            <p className="mt-3 text-sm" role="status" aria-live="polite">{running ? `${statusLabels[job.status]}입니다. 다른 페이지로 이동해도 최근 작업 이력에서 다시 확인할 수 있습니다.` : dirty ? "저장하지 않은 수정 내용이 있습니다. 저장 후 번역·생성을 진행해주세요." : "원문과 추출 내용을 확인한 뒤 저장·생성을 진행해주세요."}</p>
            {job.error_message && <p className="mt-3 rounded bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{job.error_message}</p>}
            <div className="mt-4 flex flex-wrap gap-2">{running && <button type="button" className={buttonClass} disabled={pending || dirty} onClick={() => void action("cancel")}>작업 취소</button>}{job.status === "failed" && job.retryable && <button type="button" className={buttonClass} disabled={pending || dirty || workerReady !== true} onClick={() => void action("retry")}>실패한 단계 재시도</button>}{job.status === "needs_review" && failedSourceCount > 0 && <button type="button" className={buttonClass} disabled={pending || dirty || workerReady !== true || (job.extraction_attempts ?? 0) >= 3} onClick={() => void action("retry")}>실패한 원본 다시 분석 ({failedSourceCount}개)</button>}</div>{job.status === "needs_review" && failedSourceCount > 0 && (job.extraction_attempts ?? 0) >= 3 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">원본 재분석 횟수를 모두 사용했습니다. 오류 원인을 확인하고 수정된 파일·URL로 새 작업을 시작해주세요.</p>}
          </section>

          <section className={panelClass} aria-label="입력 원본">
            <h2 className="font-black">입력 원본 {job.sources.length}개</h2>
            <div className="mt-3 space-y-3">{job.sources.map((source) => {
              const extracted = draft?.sources.find((item) => item.id === source.id);
              const linked = draft?.albums.filter((album) => album.sourceIds.includes(source.id) || album.tracks.some((track) => track.sourceIds.includes(source.id)));
              return <details key={source.id} className="rounded border border-border p-3"><summary className="cursor-pointer break-all text-sm font-semibold">{source.name}{extracted?.pageCount ? ` · ${extracted.pageCount}쪽` : ""}</summary><div className="mt-3 space-y-2 text-sm">
                {source.url ? <p className="break-all text-xs">입력 URL: {source.url}</p> : <a className="font-semibold underline" href={`/api/admin/review-docs/jobs/${job.id}/source?file=${encodeURIComponent(source.id)}`}>원본 다운로드</a>}
                <p className="text-xs text-muted-foreground">연결된 앨범: {linked?.map((album) => `${album.title || "제목 미입력"} (${album.tracks.length}곡)`).join(", ") || "확인 필요"}</p>
                {extracted?.warnings.map((warning, index) => <p key={index} className="text-amber-700 dark:text-amber-300">{warning}</p>)}
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs leading-6">{extracted?.text || "아직 추출된 원문 텍스트가 없습니다."}</pre>
              </div></details>;
            })}</div>
          </section>

          {draft && <>
            <section className={panelClass} aria-label="검토 필요 항목"><h2 className="font-black">확인 필요 {issues.length}건 {blocking.length > 0 && <span className="text-sm text-red-600">· 생성 전 보완 {blocking.length}건</span>}</h2>
              {issues.length ? <ul className="mt-3 max-h-96 space-y-3 overflow-auto">{issues.map((issue) => <li key={issue.id} className={`rounded border p-3 text-sm ${issue.severity === "error" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                <p>{issue.albumId && <span className="font-bold">{draft.albums.find((album) => album.id === issue.albumId)?.title || "앨범"} · </span>}{issue.trackId && <span className="font-bold">{draft.albums.flatMap((album) => album.tracks).find((track) => track.id === issue.trackId)?.title || "곡"} · </span>}{issue.message}</p>
                {!canConfirmReviewIssue(issue) && <p className="mt-2 text-xs text-muted-foreground">원본 처리 실패는 확인만으로 해제할 수 없습니다. 오류 원인을 해결한 후 원본을 다시 분석하거나 수정된 자료를 업로드해주세요.</p>}
                {canConfirmReviewIssue(issue) && draft.issues.some((item) => item.id === issue.id) && editable && <div className="mt-2"><Check label="원문과 비교해 수정·확인했습니다" checked={draft.confirmedIssueIds.includes(issue.id)} onChange={(checked) => edit((data) => ({ ...data, confirmedIssueIds: toggle(data.confirmedIssueIds, issue.id, checked) }))} /></div>}
              </li>)}</ul> : <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">필수 정보 검사가 통과했습니다. 원문·번역·타이틀 표시를 최종 확인해주세요.</p>}
              {confirmedIssues.length > 0 && <details className="mt-3 text-xs"><summary>확인한 원문 경고 {confirmedIssues.length}건</summary><div className="mt-2 space-y-2">{confirmedIssues.map((issue) => <Check key={issue.id} label={issue.message} checked onChange={() => edit((data) => ({ ...data, confirmedIssueIds: data.confirmedIssueIds.filter((id) => id !== issue.id) }))} />)}</div></details>}
            </section>

            <fieldset disabled={!editable} className="min-w-0 space-y-5 disabled:opacity-70"><legend className="sr-only">추출 결과 수정</legend>
              <div className={`${panelClass} flex flex-wrap items-end justify-between gap-4`}><p className="text-sm"><span className="block text-xs text-muted-foreground">신청일 · 작업 시작일 (한국 시간)</span><strong className="mt-1 block">{draft.applicationDate}</strong></p><p className="text-sm">앨범 {draft.albums.length}개 · {draft.albums.reduce((sum, album) => sum + album.tracks.length, 0)}곡</p><button type="button" className={buttonClass} disabled={draft.albums.length >= REVIEW_DOC_LIMITS.albums} onClick={() => edit((data) => ({ ...data, albums: [...data.albums, emptyAlbum(uid())] }))}>+ 앨범 추가·분리</button></div>
              {draft.albums.map((album, albumIndex) => <section key={album.id} className={panelClass} aria-label={`앨범 ${albumIndex + 1}`}>
                <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black">{albumIndex + 1}. {album.title || "앨범명 확인 필요"} <span className="text-sm font-normal">· {album.tracks.length}곡</span></h2>{!album.tracks.length && <button type="button" className={buttonClass} onClick={() => edit((data) => ({ ...data, albums: data.albums.filter((item) => item.id !== album.id) }))}>빈 앨범 삭제</button>}</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">{([ ["artistName", "아티스트명"], ["artistNameEn", "아티스트 영문명"], ["title", "앨범명"], ["company", "실제 기획사·소속사·제작사"], ["distributor", "유통사"], ["releaseDate", "발매일"], ["productionDate", "제작일"], ["genre", "장르"], ["albumType", "앨범 유형"], ["actType", "그룹·솔로"], ["members", "구성원"], ["previousReleases", "이전 발매곡"] ] as const).filter(([key]) => draft.mode === "album" || ["artistName", "title"].includes(key)).map(([key, label]) => <Field key={key} label={label} value={album[key]} onChange={(value) => albumEdit(album.id, (item) => ({ ...item, [key]: value }))} />)}</div>
                <details className="mt-4 rounded border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">원본 연결·앨범 합치기·트랙 수 확인</summary><div className="mt-3 space-y-4">{sourceChecks(album.sourceIds, (sourceIds) => albumEdit(album.id, (item) => ({ ...item, sourceIds })))}<p className="text-xs text-muted-foreground">원문 트랙 수: {album.declaredTrackCount ?? "미기재"} / 현재 {album.tracks.length}곡</p><Check label="트랙 수 차이를 원문과 비교해 확인했습니다" checked={album.reviewedFields.includes("declaredTrackCount")} onChange={(checked) => albumEdit(album.id, (item) => ({ ...item, reviewedFields: toggle(item.reviewedFields, "declaredTrackCount", checked) }))} /><Check label="같은 아티스트·앨범명이 있어도 별도 앨범입니다" checked={album.reviewedFields.includes("separateAlbum")} onChange={(checked) => albumEdit(album.id, (item) => ({ ...item, reviewedFields: toggle(item.reviewedFields, "separateAlbum", checked) }))} />
                  <label className="block text-xs font-semibold">이 앨범 자료를 다른 앨범으로 합치기<select className={inputClass} value="" onChange={(event) => event.target.value && edit((data) => mergeReviewAlbums(data, album.id, event.target.value))}><option value="">대상 앨범 선택</option>{draft.albums.filter((item) => item.id !== album.id).map((item) => <option key={item.id} value={item.id}>{item.title || "제목 미입력"} · {item.artistName}</option>)}</select></label><p className="text-xs text-muted-foreground">모든 곡을 유지해 합칩니다. 중복된 곡은 원문을 비교한 후 제외하고, 충돌한 앨범 정보는 경고에서 확인해주세요.</p>
                  {album.evidence.length > 0 && <details><summary className="cursor-pointer text-xs">추출 근거</summary>{album.evidence.map((item, index) => <p key={index} className="mt-1 break-words text-xs">{item.location}: {item.excerpt}</p>)}</details>}
                </div></details>
                <div className="mt-5 space-y-4">{album.tracks.map((track, trackIndex) => <details key={track.id} open={album.tracks.length === 1 ? true : undefined} className="rounded-[10px] border-2 border-border bg-background p-3 sm:p-4"><summary className="cursor-pointer font-bold">{track.number}. {track.title || "곡명 확인 필요"}{track.isTitle ? " · 타이틀" : ""}{track.instrumentalConfirmed ? " · Inst./MR" : ""}</summary><div className="mt-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-2"><button type="button" className={buttonClass} disabled={trackIndex === 0} onClick={() => edit((data) => reorderReviewTrack(data, album.id, track.id, -1))}>↑ 위로</button><button type="button" className={buttonClass} disabled={trackIndex === album.tracks.length - 1} onClick={() => edit((data) => reorderReviewTrack(data, album.id, track.id, 1))}>↓ 아래로</button><label className="min-w-0 flex-1 text-xs">다른 앨범으로 곡 이동<select className={inputClass} value={album.id} onChange={(event) => edit((data) => moveReviewTrack(data, album.id, track.id, event.target.value))}>{draft.albums.map((item) => <option key={item.id} value={item.id}>{item.title || "제목 미입력"}</option>)}</select></label></div>
                  <div className="grid gap-3 sm:grid-cols-2">{([["title", "곡명"], ["artistName", "곡 아티스트 (앨범과 다르면 입력)"], ["lyricist", "작사"], ["composer", "작곡"], ["arranger", "편곡"], ["featuring", "피처링"], ["performers", "실연·연주자"]] as const).filter(([key]) => draft.mode === "album" || ["title", "artistName"].includes(key)).map(([key, label]) => <Field key={key} label={label} value={track[key]} onChange={(value) => trackEdit(album.id, track.id, (item) => ({ ...item, [key]: value }))} />)}</div>
                  {draft.mode === "album" && <div className="grid gap-3 sm:grid-cols-2"><Check label="타이틀곡" checked={track.isTitle} onChange={(checked) => trackEdit(album.id, track.id, (item) => ({ ...item, isTitle: checked, titleConfirmed: true }))} /><Check label="타이틀 여부를 원문에서 확인했습니다" checked={track.titleConfirmed} onChange={(checked) => trackEdit(album.id, track.id, (item) => ({ ...item, titleConfirmed: checked }))} /><Check label="WBS 신청곡 선택 (타이틀이 3곡 초과할 때 3곡 지정)" checked={album.wbsTrackIds.includes(track.id)} onChange={(checked) => albumEdit(album.id, (item) => ({ ...item, wbsTrackIds: toggle(item.wbsTrackIds, track.id, checked) }))} /></div>}
                  <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">가사 상태<select className={inputClass} value={track.lyricStatus} onChange={(event) => trackEdit(album.id, track.id, (item) => ({ ...item, lyricStatus: event.target.value as ReviewTrack["lyricStatus"] }))}><option value="provided">가사 제공됨</option><option value="not_provided">가사 미제공</option><option value="extraction_failed">가사 추출 실패</option><option value="none">가사 없음</option><option value="instrumental">Inst./MR</option></select></label><div className="space-y-2"><Check label="Inst./MR임을 원문에서 확인했습니다" checked={track.instrumentalConfirmed} onChange={(checked) => trackEdit(album.id, track.id, (item) => ({ ...item, instrumentalConfirmed: checked, lyricStatus: checked ? "instrumental" : item.lyricStatus }))} /><Check label="가사 없음·누락 상태를 확인했습니다" checked={track.reviewedFields.includes("lyrics")} onChange={(checked) => trackEdit(album.id, track.id, (item) => ({ ...item, reviewedFields: toggle(item.reviewedFields, "lyrics", checked) }))} />{track.instrumentalConfirmed && !!track.lyrics.trim() && <Check label="Inst./MR 표시와 가사가 함께 있는 이유를 확인했습니다" checked={track.reviewedFields.includes("instrumentalConfirmed")} onChange={(checked) => trackEdit(album.id, track.id, (item) => ({ ...item, reviewedFields: toggle(item.reviewedFields, "instrumentalConfirmed", checked) }))} />}</div></div>
                  <Field label="원문 가사 (반복 후렴 포함)" value={track.lyrics} multiline onChange={(lyrics) => trackEdit(album.id, track.id, (item) => ({ ...item, lyrics, lyricStatus: lyrics.trim() ? "provided" : "not_provided" }))} />
                  <Field label="기존 번역 원문" value={track.existingTranslation} multiline onChange={(value) => trackEdit(album.id, track.id, (item) => ({ ...item, existingTranslation: value }))} />
                  <div className="rounded border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">원문 구간별 한글 번역</h3><button type="button" className={buttonClass} onClick={() => trackEdit(album.id, track.id, alignTranslationSegments)}>원문 기준 번역 구간 만들기</button></div><p className="mt-2 text-xs text-muted-foreground">기존 번역을 해당 원문 옆에 붙여넣거나 저장 후 누락 번역을 요청해주세요. 가사를 수정한 경우 구간 연결을 다시 확인해주세요.</p><div className="mt-3 space-y-3">{track.translationSegments.map((segment, segmentIndex) => <div key={segment.id} className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">원문 구간 {segmentIndex + 1}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{segment.source}</p></div><div><Field label="한글 번역" multiline value={segment.translation} onChange={(value) => trackEdit(album.id, track.id, (item) => ({ ...item, translationSegments: item.translationSegments.map((entry) => entry.id === segment.id ? { ...entry, translation: value, origin: "admin", confirmed: false } : entry) }))} /><div className="mt-2"><Check label="원문 대응·누락·중복을 확인했습니다" checked={segment.confirmed} onChange={(checked) => trackEdit(album.id, track.id, (item) => ({ ...item, translationSegments: item.translationSegments.map((entry) => entry.id === segment.id ? { ...entry, confirmed: checked } : entry) }))} /></div></div></div>)}</div></div>
                  <details className="text-xs"><summary className="cursor-pointer font-semibold">이 곡의 원본 연결·추출 근거</summary><div className="mt-3 space-y-3">{sourceChecks(track.sourceIds, (sourceIds) => trackEdit(album.id, track.id, (item) => ({ ...item, sourceIds })))}{track.evidence.map((evidence, index) => <p key={index} className="break-words">{evidence.location}: {evidence.excerpt}</p>)}</div></details>
                  <button type="button" className="text-xs text-red-600 underline" onClick={() => albumEdit(album.id, (item) => ({ ...item, tracks: item.tracks.filter((entry) => entry.id !== track.id).map((entry, index) => ({ ...entry, number: index + 1 })), wbsTrackIds: item.wbsTrackIds.filter((id) => id !== track.id) }))}>중복·불필요한 곡 제외</button>
                </div></details>)}</div>
                <button type="button" className={`${buttonClass} mt-4`} disabled={draft.albums.reduce((n, item) => n + item.tracks.length, 0) >= REVIEW_DOC_LIMITS.tracks} onClick={() => albumEdit(album.id, (item) => ({ ...item, tracks: [...item.tracks, { ...emptyTrack(uid(), item.tracks.length + 1), sourceIds: item.sourceIds }] }))}>+ 곡 추가</button>
              </section>)}
            </fieldset>

            <section className={`${panelClass} sticky bottom-3 z-10 shadow-lg`} aria-label="저장 및 생성"><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={!editable || !dirty} onClick={() => void save()}>수정 내용 저장</button>{dirty && <button type="button" className={buttonClass} disabled={pending} onClick={() => { setDraft(job.data); markDirty(false); setNotice("저장 전 내용으로 되돌렸습니다."); }}>저장 전으로 되돌리기</button>}<button type="button" className={buttonClass} disabled={!editable || dirty || workerReady !== true} onClick={() => void action("translate")}>누락 번역 요청</button><button type="button" className="bauhaus-button px-5 py-2 text-sm disabled:opacity-50" disabled={!editable || dirty || blocking.length > 0 || workerReady !== true} onClick={() => void action("generate")}>{draft.mode === "mv" ? "곡별 가사 DOCX 생성" : "전체 심의자료 생성"}</button></div><p className="mt-2 text-xs text-muted-foreground">{dirty ? "수정한 내용을 먼저 저장해주세요." : blocking.length ? `필수 확인 ${blocking.length}건을 보완하면 생성할 수 있습니다.` : "현재 저장된 버전으로 생성합니다. 수정 후에는 새로 생성해야 합니다."}</p></section>
          </>}

          {job.status === "completed" && <section className={panelClass} aria-label="완료 결과"><h2 className="text-lg font-black">완료 결과 · 자료 버전 {job.result_version}</h2><p className="mt-2 text-sm">앨범 {job.counts?.albumCount ?? 0}개 · 곡 {job.counts?.trackCount ?? 0}개 · DOCX {job.counts?.docxCount ?? job.outputs.length}개</p><p className="mt-1 text-xs text-muted-foreground">{job.validation?.structureChecked ? "문서 구조 검사 완료" : "문서 구조 검사 정보 없음"} · {job.validation?.rendered ? "문서 렌더링 검사 완료" : "Word/PDF 렌더링 육안 검수는 별도로 필요합니다."}</p><p className="mt-1 text-xs text-muted-foreground">다운로드 기한: {formatDate(job.expires_at)}</p><div className="mt-4 flex flex-wrap gap-2">{job.has_zip && !dirty && <a className="bauhaus-button px-5 py-3 text-sm" href={`/api/admin/review-docs/jobs/${job.id}/download?file=zip`}>전체 ZIP 다운로드</a>}{!dirty && job.outputs.map((output) => <a key={output.id} className={`${buttonClass} break-all`} href={`/api/admin/review-docs/jobs/${job.id}/download?file=${encodeURIComponent(output.id)}`}>{output.name}</a>)}</div>{dirty && <p className="mt-2 text-sm text-amber-700">수정 중인 자료와 이전 결과가 다릅니다. 저장 후 다시 생성해주세요.</p>}</section>}
        </> : <div className={`${panelClass} py-16 text-center text-sm text-muted-foreground`}>새 자료를 분석하거나 최근 작업을 선택해주세요.</div>}
      </div>

      <aside className={panelClass} aria-label="최근 생성 작업 이력"><div className="flex items-center justify-between gap-2"><h2 className="font-black">최근 작업</h2><button type="button" className="text-xs underline" onClick={() => void loadHistory()}>새로고침</button></div>{dirty && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">현재 수정 내용을 저장한 뒤 다른 작업을 선택해주세요.</p>}{historyLoading ? <p className="mt-4 text-sm">이력 불러오는 중…</p> : <ul className="mt-4 space-y-3">{jobs.map((item) => <li key={item.id}><button type="button" disabled={dirty || pending} className={`w-full rounded-[8px] border-2 p-3 text-left disabled:opacity-50 ${job?.id === item.id ? "border-[#1556a4] bg-blue-500/5" : "border-border"}`} onClick={() => void perform(async () => { await loadJob(item.id, true); if (!mounted.current) return; setTab(item.mode === "mv" ? "mv" : item.input_kind === "urls" ? "urls" : "files"); })}><span className="block text-sm font-bold">{item.mode === "mv" ? "영등위 가사" : "음반 자료"} · {statusLabels[item.status]}</span><span className="mt-1 block truncate text-xs">{item.sources[0]?.name || "새 작업"}{item.sources.length > 1 ? ` 외 ${item.sources.length - 1}개` : ""}</span><span className="mt-1 block text-[11px] text-muted-foreground">{formatDate(item.created_at)} · v{item.version}</span></button></li>)}</ul>}{!historyLoading && !jobs.length && <p className="mt-4 text-xs text-muted-foreground">최근 생성 작업이 없습니다.</p>}</aside>
    </div>
  </div>;
}

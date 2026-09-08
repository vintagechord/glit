"use client";

import { useEffect, useState, type FormEvent } from "react";
import { RefreshCw, Save } from "lucide-react";
import type { ArchiveSyncJob } from "@/lib/music-archive/model";
import type { AgencyGuide } from "@/lib/music-archive/guides";
import type { ProviderSupport } from "@/lib/music-archive/providers";
import { archiveRequest, jobLabels, providerNames, supportLabels } from "./types";
import { Badge, Button, External, Field, Notice, displayDate, inputClass, panelClass } from "./ui";

type AdminJob = Pick<ArchiveSyncJob, "id" | "library_id" | "provider" | "external_artist_id" | "status" | "cursor" | "counts" | "error_code" | "error_message" | "attempts" | "available_at" | "checked_at" | "updated_at">;
type AdminData = { jobs: AdminJob[]; guides: AgencyGuide[]; providers: ProviderSupport[] };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
const textFields = [
  ["name", "안내 제목"], ["introduction", "업무 설명"], ["eligibility", "확인·신청 대상"], ["costNote", "비용·승인 안내"],
] as const;
const listFields = [["preparation", "준비 정보·자료"], ["steps", "공식 신청 경로"], ["after", "신청 후 확인·기록할 사항"]] as const;

export function MusicArchiveAdminClient() {
  const [data, setData] = useState<AdminData | null>(null);
  const [draft, setDraft] = useState<AgencyGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [jobFilter, setJobFilter] = useState("attention");

  useEffect(() => {
    let active = true;
    archiveRequest<AdminData>("?action=admin").then(result => {
      if (active) { setData(result); setDraft(result.guides[0] ?? null); }
    }).catch(caught => { if (active) setError(errorMessage(caught)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function refresh() {
    setLoading(true); setError("");
    try { setData(await archiveRequest<AdminData>("?action=admin")); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setLoading(false); }
  }
  async function retry(job: AdminJob) {
    setBusy(job.id); setError(""); setMessage("");
    try {
      await archiveRequest("", { action: "admin-retry", jobId: job.id });
      setMessage("저장된 수집 범위부터 재시도를 요청했습니다. 새로고침으로 결과를 확인하세요.");
      await refresh();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(null); }
  }
  async function saveGuide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!draft) return;
    setBusy("guide"); setError(""); setMessage("");
    try {
      const guide = { ...draft, preparation: draft.preparation.map(item => item.trim()).filter(Boolean), steps: draft.steps.map(item => item.trim()).filter(Boolean), after: draft.after.map(item => item.trim()).filter(Boolean) };
      const result = await archiveRequest<{ guides: AgencyGuide[] }>("", { action: "admin-guide", guide });
      setData(previous => previous ? { ...previous, guides: result.guides } : previous);
      setDraft(result.guides.find(item => item.id === draft.id) ?? guide);
      setMessage("공식 안내를 저장했습니다. 회원 화면을 새로 열거나 새로고침하면 반영됩니다.");
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setBusy(null); }
  }
  const jobs = (data?.jobs ?? []).filter(job => jobFilter === "all" || ["partial", "blocked", "failed"].includes(job.status) || Boolean(job.error_code));

  return <div className="mt-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">최근 수집 작업 최대 100건 · 변경·재시도 이력 저장</p><Button onClick={() => void refresh()} disabled={loading || Boolean(busy)}><RefreshCw className="h-4 w-4" aria-hidden />{loading ? "불러오는 중" : "상태 새로고침"}</Button></div>
    {error && <Notice error>{error}</Notice>}
    {message && <div role="status"><Notice>{message}</Notice></div>}
    {loading && !data && <p role="status" className="text-sm">음악 관리 운영 정보를 불러오고 있습니다.</p>}
    {data && <>
      <section className={panelClass} aria-labelledby="provider-operations-heading">
        <h2 id="provider-operations-heading" className="text-lg font-black">제공처 연결 상태</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{data.providers.map(provider => <div key={provider.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{provider.name}</strong><Badge attention={provider.status !== "available"}>{supportLabels[provider.status] ?? provider.status}</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{provider.message}</p><External href={provider.url}>공식 이용 조건</External></div>)}</div>
      </section>
      <section className={panelClass} aria-labelledby="sync-operations-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="sync-operations-heading" className="text-lg font-black">수집 작업·오류</h2><Field label="표시할 작업"><select className={inputClass} value={jobFilter} onChange={event => setJobFilter(event.target.value)}><option value="attention">확인 필요한 작업</option><option value="all">최근 작업 전체</option></select></Field></div>
        {!jobs.length && <p className="mt-4 text-sm text-muted-foreground">선택한 조건의 수집 작업이 없습니다.</p>}
        <div className="mt-4 space-y-3">{jobs.map(job => <article key={job.id} className="rounded-lg border border-border p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{providerNames[job.provider] ?? job.provider}</strong><Badge attention={Boolean(job.error_code)}>{jobLabels[job.status] ?? job.status}</Badge></div>
          <p className="mt-2 break-all text-xs text-muted-foreground">작업 {job.id} · 아티스트 연결 {job.external_artist_id}</p>
          <p className="mt-2 text-sm">불러온 발매작 {job.counts.releases ?? 0}개 · 트랙 {job.counts.tracks ?? 0}개 · 관리 대상 트랙 {job.counts.managedTracks ?? 0}개 · 처리 단계 {job.counts.steps ?? 0}회</p>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">최근 확인 {displayDate(job.checked_at)} · 상태 변경 {displayDate(job.updated_at)} · 실행 {job.attempts}회</p>
          {typeof job.cursor.scopeNote === "string" && <p className="mt-2 text-sm leading-6">{job.cursor.scopeNote}</p>}
          {job.error_code && <div className="mt-2"><Notice error><strong className="break-all">{job.error_code}</strong><p>{job.error_message || "오류 상세가 없습니다. 제공처 설정과 운영 기록을 확인하세요."}</p></Notice></div>}
          {["partial", "blocked", "failed", "queued", "running"].includes(job.status) && <div className="mt-3 flex flex-wrap items-center gap-3"><Button disabled={Boolean(busy) || loading} onClick={() => void retry(job)}>{busy === job.id ? "요청 중" : "저장 지점부터 재시도"}</Button><span className="text-xs text-muted-foreground">재시도 가능 시각 {displayDate(job.available_at)}</span></div>}
        </article>)}</div>
      </section>
      <section className={panelClass} aria-labelledby="guide-operations-heading">
        <h2 id="guide-operations-heading" className="text-lg font-black">공식 절차·링크 안내</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">공식 출처에서 확인한 안내와 확인일을 저장하세요. 링크는 해당 기관의 기존 공식 도메인 안에서 변경할 수 있습니다.</p>
        <div className="mt-4"><Field label="수정할 안내"><select className={inputClass} value={draft?.id ?? ""} disabled={Boolean(busy)} onChange={event => { setDraft(data.guides.find(guide => guide.id === event.target.value) ?? null); setMessage(""); }}>{data.guides.map(guide => <option key={guide.id} value={guide.id}>{guide.name}{guide.visible ? "" : " · 숨김"}</option>)}</select></Field></div>
        {draft && <form className="mt-4" onSubmit={saveGuide}><fieldset disabled={Boolean(busy)} className="space-y-4">
          {textFields.map(([key, label]) => <Field key={key} label={label}>{key === "name" ? <input className={inputClass} value={draft[key]} required maxLength={500} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /> : <textarea className={inputClass} rows={3} value={draft[key]} required maxLength={8000} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />}</Field>)}
          {listFields.map(([key, label]) => <Field key={key} label={label} hint="한 줄에 한 항목씩 입력하세요. 최대 12개 항목을 저장할 수 있습니다."><textarea className={inputClass} rows={4} value={draft[key].join("\n")} onChange={event => setDraft({ ...draft, [key]: event.target.value.split("\n") })} /></Field>)}
          <div className="grid gap-4 sm:grid-cols-2">{([["url", "공식 안내 주소"], ["searchUrl", "공식 검색 주소"], ["applyUrl", "공식 신청 주소"]] as const).map(([key, label]) => <Field key={key} label={label}><input className={inputClass} type="url" required value={draft[key]} maxLength={2000} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></Field>)}<Field label="공식 자료 마지막 확인일"><input className={inputClass} type="date" required value={draft.checkedAt} onChange={event => setDraft({ ...draft, checkedAt: event.target.value })} /></Field></div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={draft.visible} onChange={event => setDraft({ ...draft, visible: event.target.checked })} className="h-5 w-5" />회원 화면에 이 안내 표시</label>
          <div className="rounded-lg bg-muted p-3"><p className="text-sm font-bold">공식 근거 자료</p><div className="mt-1 flex flex-col items-start">{draft.sources.map(source => <External key={source.url} href={source.url}>{source.title}</External>)}</div></div>
          <Button type="submit" primary disabled={Boolean(busy)}><Save className="h-4 w-4" aria-hidden />{busy === "guide" ? "저장 중" : "공식 안내 저장"}</Button>
        </fieldset></form>}
      </section>
    </>}
  </div>;
}

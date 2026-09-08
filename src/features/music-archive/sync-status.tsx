"use client";
import { LoaderCircle } from "lucide-react";
import type { SyncJob } from "./types";
import { jobLabels, providerNames } from "./types";
import { Badge, Button, displayDate } from "./ui";

export function SyncStatus({ jobs, busy, resumableProviders = [], onResume }: { jobs: SyncJob[]; busy: boolean; resumableProviders?: string[]; onResume: (jobId: string) => void }) {
  const ordered = [...jobs].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  const latest = ordered.filter((job, index) => ordered.findIndex((item) => item.provider === job.provider) === index);
  const history = ordered.filter((job) => !latest.includes(job));
  function renderJob(job: SyncJob, historical = false) {
    const running = ["queued", "running"].includes(job.status);
    const interrupted = ["partial", "failed", "blocked"].includes(job.status);
    const limited = job.cursor?.providerCursor?.phase === "limited";
    return <div key={job.id} className="space-y-2 rounded-lg border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{providerNames[job.provider] || "앨범 불러오기"}</strong><Badge attention={interrupted}>{running && <LoaderCircle className="mr-1 h-3 w-3 animate-spin" aria-hidden />}{jobLabels[job.status] || "확인 필요"}</Badge></div>
      <p role={running ? "status" : undefined}>불러온 발매작 {job.counts?.releases ?? job.counts?.albums ?? 0}개 · 트랙 {job.counts?.tracks ?? 0}개</p>
      {running && <p className="text-xs text-muted-foreground">확인된 음악부터 차례로 추가됩니다. 페이지를 나가도 계속 진행됩니다.</p>}
      {limited ? <p className="text-xs text-muted-foreground">제공 목록에서 확인한 음악을 불러왔습니다. 빠진 앨범은 직접 추가해 주세요.</p> : interrupted && <p className="text-xs text-muted-foreground">일부 음악을 아직 불러오지 못했습니다. 이미 추가한 음악과 업무 기록은 보존됩니다.</p>}
      {job.status === "completed" && <p className="text-xs text-muted-foreground">검색에서 확인된 발매작을 불러왔습니다. 빠진 앨범은 직접 추가할 수 있습니다.</p>}
      <p className="text-xs text-muted-foreground">최근 확인 {displayDate(job.checked_at || job.updated_at)}</p>
      {!historical && !limited && interrupted && resumableProviders.includes(job.provider) && <Button disabled={busy} onClick={() => onResume(job.id)}>이어서 불러오기</Button>}
    </div>;
  }
  return <div className="space-y-2" aria-label="앨범 불러오기 현황">{latest.map((job) => renderJob(job))}{history.length > 0 && <details><summary className="cursor-pointer py-2 text-xs font-bold">이전 불러오기 기록 ({history.length}건)</summary><div className="space-y-2">{history.map((job) => renderJob(job, true))}</div></details>}</div>;
}

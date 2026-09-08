"use client";
import { LoaderCircle } from "lucide-react";
import type { SyncJob } from "./types";
import { Button } from "./ui";

/** Member feedback intentionally excludes provider identities, diagnostics and history. */
export function SyncStatus({ jobs, busy, onResume }: { jobs: SyncJob[]; busy: boolean; resumableProviders?: string[]; onResume: (jobId: string) => void }) {
  if (jobs.some((job) => ["queued", "running"].includes(job.status))) return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />앨범을 불러오고 있습니다.</p>;
  const retry = jobs.filter((job) => ["partial", "failed", "blocked"].includes(job.status));
  if (!retry.length) return null;
  return <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-muted-foreground">아직 불러오지 못한 앨범이 있습니다.</p><Button disabled={busy} onClick={() => onResume(retry[0].id)}>다시 불러오기</Button></div>;
}

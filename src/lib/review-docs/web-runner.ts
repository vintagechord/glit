import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobDatabaseError } from "./jobs";
import { REVIEW_JOB_LIMITS, ReviewJobError, type ReviewJob } from "./jobs-types";
import { isReviewWebEnabled } from "./web-runtime";
import { cleanupReviewJobs, failReviewJob, processReviewJob } from "./worker";
import { awaitReviewAbort } from "./abort";

const state = globalThis as typeof globalThis & { __reviewWebBatch?: Promise<void>; __reviewWebCleanupAt?: number };

export async function runClaimedWebReviewJob(job: ReviewJob, options: {
  process?: (job: ReviewJob, signal: AbortSignal) => Promise<void>;
  fail?: typeof failReviewJob;
  renew?: () => Promise<boolean>;
  every?: typeof setInterval;
  clear?: typeof clearInterval;
  now?: () => number;
  timeoutMs?: number;
} = {}) {
  const now = options.now ?? Date.now;
  const started = now();
  const timeoutMs = options.timeoutMs ?? REVIEW_JOB_LIMITS.processingSeconds * 1000;
  const deadline = started + timeoutMs;
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(new ReviewJobError(
    "문서 처리 시간이 초과되었습니다. 작업을 나누거나 잠시 후 다시 시도해주세요.", 503, "WORKER_INTERRUPTED", true,
  )), timeoutMs);
  let renewing = false;
  let lost = false;
  const renew = options.renew ?? (async () => {
    const { data, error } = await createAdminClient().from("review_document_jobs")
      .update({ lease_until: new Date(Math.min(Date.now() + 90_000, deadline)).toISOString() })
      .eq("id", job.id).eq("lease_token", job.lease_token!).eq("version", job.version)
      .gt("lease_until", new Date().toISOString()).select("id")
      .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])).maybeSingle();
    return !error && !!data;
  });
  const timer = (options.every ?? setInterval)(() => {
    if (renewing || lost || controller.signal.aborted || now() >= deadline) return;
    renewing = true;
    void renew().then((ok) => { lost = !ok; }, () => { lost = true; }).finally(() => {
      renewing = false;
      if (lost) controller.abort(new ReviewJobError("작업이 취소되었거나 실행 권한이 만료되었습니다.", 409, "LEASE_LOST"));
    });
  }, 20_000);
  try {
    // Updates inside processReviewJob compare version, token and live lease.
    // A cancelled/timed-out request can never publish a stale result.
    await awaitReviewAbort((options.process ?? processReviewJob)(job, controller.signal), controller.signal);
  } catch (error) {
    if (error instanceof ReviewJobError && error.code === "LEASE_LOST") return;
    await (options.fail ?? failReviewJob)(job, error);
  } finally { clearTimeout(deadlineTimer); (options.clear ?? clearInterval)(timer); }
}

/** One durable, globally leased job per wake-up; response polling and startup resume it. */
export function runWebReviewBatch(): Promise<void> {
  if (!isReviewWebEnabled()) return Promise.resolve();
  if (state.__reviewWebBatch) return state.__reviewWebBatch;
  state.__reviewWebBatch = (async () => {
    const { data, error } = await createAdminClient().rpc("claim_review_document_web_job", { p_token: randomUUID() });
    jobDatabaseError(error);
    const job = data?.[0] as ReviewJob | undefined;
    if (job) await runClaimedWebReviewJob(job);
    else if (Date.now() > (state.__reviewWebCleanupAt ?? 0)) {
      state.__reviewWebCleanupAt = Date.now() + 60_000;
      await cleanupReviewJobs();
    }
  })().finally(() => { delete state.__reviewWebBatch; });
  return state.__reviewWebBatch;
}

export async function resumeWebReviewJobs() {
  try { await runWebReviewBatch(); }
  catch { console.error("[review-docs] automatic document batch failed; the persisted queue will retry"); }
}

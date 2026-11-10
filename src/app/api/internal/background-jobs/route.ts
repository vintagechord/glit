import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, getRequestIdentifier } from "@/lib/request-rate-limit";
import { readBoundedJsonBody } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby allows at most 300 seconds, including after() work.
export const maxDuration = 300;

/**
 * Vercel has no resident process for the former in-process dispatchers.
 * pg_cron (`dispatch_background_jobs`) calls this only while durable music
 * archive or review document work is waiting. Both runners use DB leases, so
 * overlapping calls, request after() work and optional CLI workers stay safe.
 * `dispatch_storage_cleanup` calls it with {"task":"storage-cleanup"} while
 * expired uploads, abandoned grants, unfinished purges or orphan artwork
 * wait; that run uses DB leases too. `dispatch_support_chat_notices` calls it
 * with {"task":"support-chat-notices"} while a customer's chat message has
 * waited a minute unread; claims are stamped in the DB, so overlapping runs
 * mail each conversation once.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return NextResponse.json({ ok: false }, { status: 401 });
  const rate = consumeRateLimit({ namespace: "background-jobs-auth", identifier: getRequestIdentifier(request.headers), limit: 30, windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  try {
    // The scheduler shares the email worker token; both are DB-to-app calls.
    const auth = await createAdminClient().rpc("authorize_email_worker", { p_token: token });
    if (auth.error) return NextResponse.json({ ok: false }, { status: 503 });
    if (auth.data !== true) return NextResponse.json({ ok: false }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const body = await readBoundedJsonBody(request, 1024);
  const requested = body.ok ? (body.value as { task?: unknown } | null)?.task : undefined;
  const task = requested === "storage-cleanup" || requested === "support-chat-notices" ? requested : "default";
  // Answer the short pg_net timeout first; Vercel keeps after() work alive.
  if (task === "support-chat-notices") {
    after(async () => {
      const { runSupportChatNotices } = await import("@/lib/support-chat-notices");
      const report = await runSupportChatNotices(createAdminClient()).catch(() => null);
      if (!report) console.error("[support-chat-notice] scheduled run failed; the next dispatch retries");
      else if (report.claimed) console.info("[support-chat-notice] scheduled run", report);
    });
    return NextResponse.json({ ok: true }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  if (task === "storage-cleanup") {
    after(async () => {
      const { runUploadStorageCleanup } = await import("@/lib/upload-storage-cleanup");
      const report = await runUploadStorageCleanup().catch(() => null);
      if (!report) console.error("[storage-cleanup] scheduled run failed; the next dispatch retries");
      else console.info("[storage-cleanup] scheduled run", report);
    });
    return NextResponse.json({ ok: true }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  after(async () => {
    const [{ runArchiveBatch }, { resumeWebReviewJobs }] = await Promise.all([
      import("@/lib/music-archive/sync"),
      import("@/lib/review-docs/web-runner"),
    ]);
    await Promise.all([
      runArchiveBatch().catch(() => { console.error("[music-archive] scheduled batch failed; the persisted queue will retry"); }),
      resumeWebReviewJobs(),
    ]);
  });
  return NextResponse.json({ ok: true }, { status: 202, headers: { "cache-control": "no-store" } });
}

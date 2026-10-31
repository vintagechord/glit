import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, getRequestIdentifier } from "@/lib/request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby allows at most 300 seconds, including after() work.
export const maxDuration = 300;

/**
 * Vercel has no resident process for the former in-process dispatchers.
 * pg_cron (`dispatch_background_jobs`) calls this only while durable music
 * archive or review document work is waiting. Both runners use DB leases, so
 * overlapping calls, request after() work and optional CLI workers stay safe.
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
  // Answer the short pg_net timeout first; Vercel keeps after() work alive.
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

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainEmailOutbox } from "@/lib/email-outbox";
import { drainPaidSubmissionNotifications } from "@/lib/payments/notification-events";
import { consumeRateLimit, getRequestIdentifier } from "@/lib/request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One attachment send can take about 165 seconds (EMAIL_SEND_BUDGET_MS), so
// 60 seconds cut sends off mid-attempt and their leases expired as
// "uncertain". pg_net stops waiting after 60 seconds; the function still
// runs to completion.
export const maxDuration = 300;
// Time kept after the last send for the heartbeat update and the response.
const RESPONSE_MARGIN_MS = 15_000;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return NextResponse.json({ ok: false }, { status: 401 });
  const rate = consumeRateLimit({ namespace: "email-worker-auth", identifier: getRequestIdentifier(request.headers), limit: 30, windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  const db = createAdminClient();
  try {
    const auth = await db.rpc("authorize_email_worker", { p_token: token });
    if (auth.error) return NextResponse.json({ ok: false }, { status: 503 });
    if (auth.data !== true) return NextResponse.json({ ok: false }, { status: 401 });
    const started = await db.from("email_worker_config").update({ last_started_at: new Date().toISOString() }).eq("singleton", true);
    if (started.error) return NextResponse.json({ ok: false }, { status: 503 });
    const [result, receipts] = await Promise.all([
      // Batches of three while a worst-case send still fits before the deadline.
      drainEmailOutbox({ limit: 9, batchSize: 3, deadline: startedAt + maxDuration * 1_000 - RESPONSE_MARGIN_MS }),
      drainPaidSubmissionNotifications({ limit: 2 }),
    ]);
    const finished = await db.from("email_worker_config").update({ last_finished_at: new Date().toISOString(), last_error: false }).eq("singleton", true);
    return NextResponse.json({ ok: !finished.error, ...result, receipts }, { status: finished.error ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    // Log only the category: neither the scheduler token nor mail payload.
    console.error("[email-worker] drain failed");
    await db.from("email_worker_config").update({ last_error: true }).eq("singleton", true).then(() => undefined, () => undefined);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

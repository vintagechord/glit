import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import type { RuntimeHealthCheck } from "@/lib/runtime-health";

/** Read-only queue/scheduler health. Never sends a probe email or returns PII. */
export async function checkEmailOutboxHealth(): Promise<RuntimeHealthCheck[]> {
  if (getEmailDeliveryMode() !== "transactional") return [];
  try {
    const db = createAdminClient();
    const [stats, worker] = await Promise.all([
      db.rpc("email_outbox_stats"),
      db.from("email_worker_config").select("enabled,last_error,last_finished_at").eq("singleton", true).maybeSingle(),
    ]);
    if (stats.error || worker.error || !stats.data) return [{ name: "email queue connectivity", ok: false, severity: "error" }];
    const data = stats.data as { oldestPendingAt?: string | null; uncertain?: number; failed?: number };
    const oldest = data.oldestPendingAt ? Date.parse(data.oldestPendingAt) : null;
    const finished = Date.parse(worker.data?.last_finished_at ?? "");
    return [
      { name: "email queue connectivity", ok: true, severity: "error" },
      { name: "email retry worker", ok: worker.data?.enabled === true && worker.data?.last_error === false && Number.isFinite(finished) && finished > Date.now() - 27 * 60 * 60_000, severity: "error" },
      { name: "email queue processing", ok: oldest === null || (Number.isFinite(oldest) && oldest > Date.now() - 15 * 60_000), severity: "warning" },
      { name: "email delivery exceptions", ok: Number(data.uncertain ?? 0) + Number(data.failed ?? 0) === 0, severity: "warning" },
    ];
  } catch {
    return [{ name: "email queue connectivity", ok: false, severity: "error" }];
  }
}

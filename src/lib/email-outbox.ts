import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import type { EmailProvider } from "@/lib/email-config";
import type { EmailAttemptResult, EmailMessage, EmailSendResult } from "@/lib/email-transport";

export type EmailOutboxStatus = "pending" | "sending" | "retry" | "accepted" | "uncertain" | "failed" | "expired";
export type EmailOutboxRow = {
  id: string; idempotency_key: string; provider: EmailProvider; recipient_email: string;
  subject: string; html: string | null; reply_to: string | null; operation: string;
  status: EmailOutboxStatus; attempt_count: number; max_attempts: number;
  lease_token: string | null; lease_expires_at: string | null; next_attempt_at: string;
  provider_message_id: string | null; last_error_reason: EmailSendResult["reason"] | null;
  last_error_code: string | null; expires_at: string; created_at: string; updated_at: string;
  submission_id?: string | null; mark_result_notified?: boolean;
};
type EnqueueInput = Omit<EmailOutboxRow, "id" | "status" | "attempt_count" | "max_attempts" | "lease_token" | "lease_expires_at" | "next_attempt_at" | "provider_message_id" | "last_error_reason" | "last_error_code" | "created_at" | "updated_at">;
export type EmailOutboxStats = Record<EmailOutboxStatus, number> & { oldestPendingAt: string | null };
export type EmailOutboxStore = {
  enqueue(input: EnqueueInput): Promise<EmailOutboxRow>;
  claim(limit: number, id?: string): Promise<EmailOutboxRow[]>;
  finish(row: EmailOutboxRow, result: EmailAttemptResult): Promise<EmailOutboxRow | null>;
  get(id: string): Promise<EmailOutboxRow | null>;
  stats(): Promise<EmailOutboxStats>;
};
type Deliver = (message: EmailMessage, expectedProvider: EmailProvider, replyTo?: string | null) => Promise<EmailAttemptResult>;

const dbFailure = () => new Error("Email outbox storage unavailable");
const arrayResult = <T>(data: unknown): T[] => Array.isArray(data) ? data as T[] : [];
function createDatabaseStore(): EmailOutboxStore {
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    const { data, error } = await createAdminClient().rpc(name, args);
    if (error) throw dbFailure();
    return data;
  };
  return {
    async enqueue(input) {
      const data = await rpc("enqueue_email_outbox", {
        p_idempotency_key: input.idempotency_key, p_provider: input.provider,
        p_recipient_email: input.recipient_email, p_subject: input.subject, p_html: input.html,
        p_reply_to: input.reply_to, p_operation: input.operation, p_expires_at: input.expires_at,
        p_submission_id: input.submission_id ?? null, p_mark_result_notified: input.mark_result_notified ?? false,
      });
      const row = arrayResult<EmailOutboxRow>(data)[0];
      if (!row?.id) throw dbFailure();
      return row;
    },
    async claim(limit, id) { return arrayResult<EmailOutboxRow>(await rpc("claim_email_outbox", { p_limit: limit, p_id: id ?? null })); },
    async finish(row, result) {
      return arrayResult<EmailOutboxRow>(await rpc("finish_email_outbox", {
        p_id: row.id, p_lease_token: row.lease_token, p_outcome: result.outcome,
        p_message_id: result.messageId ?? null, p_error_reason: result.reason ?? null,
        p_error_code: result.errorCode ?? null, p_retry_after_seconds: result.retryAfterSeconds ?? null,
      }))[0] ?? null;
    },
    async get(id) {
      const { data, error } = await createAdminClient().from("email_outbox").select("*").eq("id", id).maybeSingle();
      if (error) throw dbFailure();
      return data as EmailOutboxRow | null;
    },
    async stats() { return await rpc("email_outbox_stats") as EmailOutboxStats; },
  };
}

const outcomeMessage = (status: EmailOutboxStatus) => status === "uncertain"
  ? "메일 서버 접수 여부를 확인하지 못했습니다. 중복 발송을 막기 위해 자동 재시도를 중지했습니다."
  : status === "pending" || status === "retry" || status === "sending"
    ? "이메일을 발송 대기열에 저장했습니다. 일시적인 오류는 자동으로 다시 시도합니다."
    : "이메일 발송에 실패했습니다. 잠시 후 다시 요청해주세요.";
function rowResult(row: EmailOutboxRow, includeMessageId = true): EmailSendResult {
  return {
    ok: row.status === "accepted", outboxId: row.id, status: row.status,
    ...(row.status === "accepted"
      ? includeMessageId && row.provider_message_id ? { messageId: row.provider_message_id } : {}
      : { queued: ["pending", "retry", "sending"].includes(row.status), reason: row.last_error_reason ?? "delivery", message: outcomeMessage(row.status) }),
  };
}
const unknownResult = (id: string): EmailSendResult => ({ ok: false, outboxId: id, status: "uncertain", queued: false, reason: "delivery", message: outcomeMessage("uncertain") });

/** Dependencies are explicit so tests never contact a real mailbox or database. */
export function createEmailOutboxService({ store, deliver, now = Date.now }: {
  store: EmailOutboxStore; deliver: Deliver; now?: () => number;
}) {
  const sendClaimed = async (row: EmailOutboxRow): Promise<EmailSendResult> => {
    let attempt: EmailAttemptResult;
    try {
      if (!row.html || new Date(row.expires_at).getTime() <= now()) {
        attempt = { ok: false, outcome: "failed", reason: "delivery", errorCode: "payload_expired" };
      } else {
        attempt = await deliver({
          to: row.recipient_email, subject: row.subject, html: row.html, operation: row.operation,
          // Stable across retries. Resend supports provider idempotency; SMTP
          // uncertainty is still held for explicit operator review.
          idempotencyKey: `outbox-${row.id}`, includeMessageId: true, requestId: row.id,
        }, row.provider, row.reply_to);
      }
    } catch {
      attempt = { ok: false, outcome: "uncertain", reason: "delivery", errorCode: "unexpected_attempt_error" };
    }
    try {
      const updated = await store.finish(row, attempt);
      return updated ? rowResult(updated) : unknownResult(row.id);
    } catch {
      // Even an accepted send is not repeated when its durable receipt cannot
      // be confirmed. The lease reaper subsequently marks it uncertain.
      console.error("[Email outbox] receipt persistence unavailable", { outboxId: row.id });
      return unknownResult(row.id);
    }
  };
  return {
    async enqueueAndSend(message: EmailMessage, provider: EmailProvider, replyTo?: string): Promise<EmailSendResult> {
      let row: EmailOutboxRow;
      try {
        const ttl = ["signup verification", "password reset"].includes(message.operation) ? 10 * 60_000 : 24 * 60 * 60_000;
        const expiry = message.expiresAt ? new Date(message.expiresAt).getTime() : now() + ttl;
        if (!Number.isFinite(expiry) || expiry <= now() || expiry > now() + 24 * 60 * 60_000) throw dbFailure();
        const key = createHash("sha256").update(`${message.operation}\0${message.to.toLowerCase()}\0${message.idempotencyKey ?? randomUUID()}`).digest("hex");
        row = await store.enqueue({
          idempotency_key: key, provider, recipient_email: message.to, subject: message.subject,
          html: message.html, reply_to: replyTo ?? null, operation: message.operation,
          expires_at: new Date(expiry).toISOString(), submission_id: message.submissionId ?? null,
          mark_result_notified: Boolean(message.markResultNotified && message.submissionId && ["review result", "submission update"].includes(message.operation)),
        });
      } catch {
        console.error("[Email outbox] enqueue unavailable");
        return { ok: false, reason: "configuration", queued: false, message: "이메일을 안전하게 저장하지 못했습니다. 잠시 후 다시 요청해주세요." };
      }
      if (!["pending", "retry"].includes(row.status)) return rowResult(row, message.includeMessageId);
      try {
        // Request-triggered sends may only claim their own newly queued item.
        const claimed = await store.claim(1, row.id);
        const result = claimed[0] ? await sendClaimed(claimed[0]) : rowResult(await store.get(row.id) ?? row);
        if (!message.includeMessageId) delete result.messageId;
        return result;
      } catch {
        // The enqueue is durable; the scheduled worker can claim it later.
        return rowResult(row, message.includeMessageId);
      }
    },
    async drain({ limit = 5 }: { limit?: number } = {}) {
      const summary = { claimed: 0, accepted: 0, retry: 0, uncertain: 0, failed: 0, expired: 0 };
      if (getEmailDeliveryMode() !== "transactional") return summary;
      const rows = await store.claim(Math.min(20, Math.max(1, Math.floor(limit))));
      summary.claimed = rows.length;
      await Promise.all(rows.map(async (row) => {
        const result = await sendClaimed(row);
        if (result.status && result.status in summary && result.status !== "pending" && result.status !== "sending") summary[result.status as "accepted" | "retry" | "uncertain" | "failed" | "expired"]++;
      }));
      return summary;
    },
  };
}

export async function enqueueAndSendEmail(message: EmailMessage, provider: EmailProvider, replyTo: string | undefined, deliver: Deliver) {
  return createEmailOutboxService({ store: createDatabaseStore(), deliver }).enqueueAndSend(message, provider, replyTo);
}
export async function drainEmailOutbox(options: { limit?: number } = {}) {
  const { sendEmailAttempt } = await import("@/lib/email-transport");
  return createEmailOutboxService({ store: createDatabaseStore(), deliver: sendEmailAttempt }).drain(options);
}
export async function getEmailOutboxStats(): Promise<EmailOutboxStats> {
  return createDatabaseStore().stats();
}

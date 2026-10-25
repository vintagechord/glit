import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailDeliveryMode } from "@/lib/email-delivery-mode";
import { sendPaidSubmissionNotificationsById } from "./notifications";

type Event = { submission_id: string; payment_key: string; lease_token: string };
type Store = {
  claim(limit: number): Promise<Event[]>;
  finish(event: Event, recorded: boolean): Promise<boolean>;
};
function databaseStore(): Store {
  const db = createAdminClient();
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("claim_paid_submission_notifications", { p_limit: limit });
      if (error || !Array.isArray(data)) throw new Error("Receipt event queue unavailable");
      return data as Event[];
    },
    async finish(event, recorded) {
      const { data, error } = await db.rpc("finish_paid_submission_notification", {
        p_submission_id: event.submission_id, p_lease_token: event.lease_token, p_recorded: recorded,
      });
      if (error) throw new Error("Receipt event acknowledgement unavailable");
      return data === true;
    },
  };
}

/** No financial writes: recover committed payments whose request ended before
 * mail was queued. Independent message keys prevent duplicate customer/admin mail. */
export async function drainPaidSubmissionNotifications({ limit = 2, store = databaseStore(),
  notify = sendPaidSubmissionNotificationsById,
}: { limit?: number; store?: Store; notify?: typeof sendPaidSubmissionNotificationsById } = {}) {
  const summary = { claimed: 0, recorded: 0, retry: 0 };
  if (getEmailDeliveryMode() !== "transactional") return summary;
  const events = await store.claim(Math.min(5, Math.max(1, Math.floor(limit))));
  summary.claimed = events.length;
  await Promise.all(events.map(async event => {
    let recorded = false;
    try {
      const result = await notify({ submissionId: event.submission_id, paymentKey: event.payment_key });
      recorded = result.recorded;
    } catch { /* Keep the intent for a later safe retry. */ }
    const saved = await store.finish(event, recorded);
    if (saved && recorded) summary.recorded++;
    else summary.retry++;
  }));
  return summary;
}

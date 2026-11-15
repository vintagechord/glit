import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Sends an album on to "결과 통보 완료" while a station still has no result,
 * or puts it back into review. A broadcaster can be unable to announce
 * results for weeks; the album would otherwise sit in "심의 진행 중" although
 * every other station is decided and the customer has been told.
 *
 * Only the mark is written. The application stays IN_PROGRESS, so customers
 * keep seeing the open station as pending, nothing is mailed, and the missing
 * result can still be saved later; the album then waits for its result mail
 * like any other. See partialNoticeStage in submission-stages.ts.
 */
export type PartialResultNoticeResult = { ok: true; changed: boolean } | { ok: false; error: string };

const FINAL_STATION_STATUSES = new Set(["APPROVED", "REJECTED"]);
const saveFailed = "저장하지 못했습니다. 새로고침 후 다시 시도해주세요.";

type Station = { name?: string | null; code?: string | null };
type ReviewRow = { status?: string | null; station?: Station | Station[] | null };

export async function setPartialResultNotice(
  db: SupabaseClient,
  input: { submissionId: string; closed: boolean; actorUserId: string; now?: Date },
): Promise<PartialResultNoticeResult> {
  if (!z.string().uuid().safeParse(input.submissionId).success) return { ok: false, error: "접수 ID를 확인해주세요." };
  const { submissionId } = input;

  const [submissionResult, reviewsResult] = await Promise.all([
    db.from("submissions").select("id, type, status, payment_status, partial_result_notified_at").eq("id", submissionId).maybeSingle(),
    db.from("station_reviews").select("status, station:stations ( name, code )").eq("submission_id", submissionId),
  ]);
  if (submissionResult.error || reviewsResult.error) return { ok: false, error: "접수 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." };
  const submission = submissionResult.data as {
    type: string | null; status: string | null; payment_status: string | null; partial_result_notified_at: string | null;
  } | null;
  if (!submission) return { ok: false, error: "접수를 찾을 수 없습니다." };

  const recordEvent = (message: string) => db.from("submission_events").insert({
    submission_id: submissionId, actor_user_id: input.actorUserId, event_type: "ADMIN_STATUS", message,
  });

  if (!input.closed) {
    if (!submission.partial_result_notified_at) return { ok: true, changed: false };
    const { data, error } = await db.from("submissions").update({ partial_result_notified_at: null })
      .eq("id", submissionId).select("id").maybeSingle();
    if (error || !data) return { ok: false, error: saveFailed };
    await recordEvent("결과 통보 완료 처리를 취소하고 심의 진행 중으로 되돌렸습니다.");
    return { ok: true, changed: true };
  }

  if (submission.type !== "ALBUM") return { ok: false, error: "음반 심의 접수만 옮길 수 있습니다." };
  if (submission.payment_status !== "PAID" || submission.status !== "IN_PROGRESS") {
    return { ok: false, error: "결제 완료 후 심의 진행 중인 접수만 옮길 수 있습니다. 모든 방송사 결과가 저장된 접수는 결과 이메일을 보내면 통보 완료가 됩니다." };
  }
  const reviews = (reviewsResult.data ?? []) as ReviewRow[];
  const isFinal = (review: ReviewRow) => FINAL_STATION_STATUSES.has(review.status ?? "");
  if (!reviews.some(isFinal)) return { ok: false, error: "방송사 결과(적격·부적격)를 1곳 이상 저장한 뒤 옮길 수 있습니다." };
  if (submission.partial_result_notified_at) return { ok: true, changed: false };

  // The status guard keeps a result saved for the last station in the
  // meantime in charge: that album is no longer a partial one.
  const { data, error } = await db.from("submissions")
    .update({ partial_result_notified_at: (input.now ?? new Date()).toISOString() })
    .eq("id", submissionId).eq("status", "IN_PROGRESS").select("id").maybeSingle();
  if (error || !data) return { ok: false, error: saveFailed };

  const pending = reviews.filter((review) => !isFinal(review)).map((review) => {
    const station = Array.isArray(review.station) ? review.station[0] : review.station;
    return station?.name || station?.code || "방송사";
  });
  await recordEvent(`일부 방송사 결과를 기다리는 채로 결과 통보 완료로 옮겼습니다.${pending.length ? ` 결과 대기: ${pending.join(", ")}` : ""}`);
  return { ok: true, changed: true };
}

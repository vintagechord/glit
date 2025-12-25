import { notFound } from "next/navigation";

import {
  updatePaymentStatusFormAction,
  updateStationReviewFormAction,
  updateSubmissionStatusFormAction,
} from "@/features/admin/actions";
import { formatDateTime } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = {
  title: "접수 상세 관리",
};

const submissionStatuses = [
  "DRAFT",
  "SUBMITTED",
  "PRE_REVIEW",
  "WAITING_PAYMENT",
  "IN_PROGRESS",
  "RESULT_READY",
  "COMPLETED",
];

const paymentStatuses = ["UNPAID", "PAYMENT_PENDING", "PAID", "REFUNDED"];

const stationStatuses = [
  "NOT_SENT",
  "SENT",
  "RECEIVED",
  "APPROVED",
  "REJECTED",
  "NEEDS_FIX",
];

export default async function AdminSubmissionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createServerSupabase();
  const { data: submission } = await supabase
    .from("submissions")
    .select(
      "id, title, artist_name, status, payment_status, pre_review_requested, karaoke_requested, bank_depositor_name, admin_memo, created_at, updated_at, type, package:packages ( name )",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!submission) {
    notFound();
  }

  const { data: stationReviews } = await supabase
    .from("station_reviews")
    .select(
      "id, status, result_note, updated_at, station:stations ( id, name, code )",
    )
    .eq("submission_id", params.id)
    .order("updated_at", { ascending: false });

  const { data: events } = await supabase
    .from("submission_events")
    .select("id, event_type, message, created_at")
    .eq("submission_id", params.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Admin
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            {submission.title || "제목 미입력"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {submission.artist_name || "아티스트 미입력"}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          접수일 {formatDateTime(submission.created_at)}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-border/60 bg-background/80 p-6 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              접수 요약
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">유형</p>
                <p className="mt-1 font-semibold text-foreground">
                  {submission.type}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">패키지</p>
                <p className="mt-1 font-semibold text-foreground">
                  {submission.package?.name ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">사전검토</p>
                <p className="mt-1 font-semibold text-foreground">
                  {submission.pre_review_requested ? "요청" : "미요청"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">노래방 등록</p>
                <p className="mt-1 font-semibold text-foreground">
                  {submission.karaoke_requested ? "요청" : "미요청"}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              결제 상태
            </p>
            <form action={updatePaymentStatusFormAction} className="mt-4 space-y-4">
              <input type="hidden" name="submissionId" value={submission.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    입금자명
                  </label>
                  <input
                    value={submission.bank_depositor_name ?? ""}
                    readOnly
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    결제 상태
                  </label>
                  <select
                    name="paymentStatus"
                    defaultValue={submission.payment_status}
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                  >
                    {paymentStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  관리자 메모
                </label>
                <textarea
                  name="adminMemo"
                  defaultValue={submission.admin_memo ?? ""}
                  className="h-24 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
              >
                결제 상태 저장
              </button>
            </form>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              접수 상태 변경
            </p>
            <form action={updateSubmissionStatusFormAction} className="mt-4 space-y-4">
              <input type="hidden" name="submissionId" value={submission.id} />
              <select
                name="status"
                defaultValue={submission.status}
                className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
              >
                {submissionStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <textarea
                name="adminMemo"
                defaultValue={submission.admin_memo ?? ""}
                className="h-24 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                placeholder="관리자 메모"
              />
              <button
                type="submit"
                className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
              >
                상태 저장
              </button>
            </form>
          </div>
        </div>

        <div className="rounded-[28px] border border-border/60 bg-background/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            이벤트 로그
          </p>
          <div className="mt-4 space-y-3 text-xs">
            {events && events.length > 0 ? (
              events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-border/60 bg-card/80 px-4 py-3"
                >
                  <div className="flex items-center justify-between text-foreground">
                    <span className="font-semibold">{event.event_type}</span>
                    <span className="text-muted-foreground">
                      {formatDateTime(event.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-muted-foreground">{event.message}</p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
                아직 이벤트가 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          방송국별 진행 관리
        </p>
        <div className="mt-4 space-y-4">
          {stationReviews && stationReviews.length > 0 ? (
            stationReviews.map((review) => (
              <form
                key={review.id}
                action={updateStationReviewFormAction}
                className="grid gap-4 rounded-2xl border border-border/60 bg-background/80 p-4 md:grid-cols-[1.2fr_1fr_1.2fr_auto]"
              >
                <input type="hidden" name="reviewId" value={review.id} />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {review.station?.name ?? "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {review.station?.code ?? ""}
                  </p>
                </div>
                <select
                  name="status"
                  defaultValue={review.status}
                  className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                >
                  {stationStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <input
                  name="resultNote"
                  defaultValue={review.result_note ?? ""}
                  placeholder="결과 메모"
                  className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                />
                <button
                  type="submit"
                  className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                >
                  저장
                </button>
              </form>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
              방송국 진행 정보가 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

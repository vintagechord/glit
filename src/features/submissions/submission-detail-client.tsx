"use client";

import * as React from "react";

import { formatCurrency, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type Submission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  status: string;
  payment_status: string;
  created_at: string;
  updated_at: string;
  package?: {
    name: string | null;
    station_count: number | null;
    price_krw: number | null;
  } | null;
};

type SubmissionEvent = {
  id: string;
  event_type: string;
  message: string | null;
  created_at: string;
};

type StationReview = {
  id: string;
  status: string;
  result_note: string | null;
  updated_at: string;
  station?: {
    id: string;
    name: string | null;
    code: string | null;
  } | null;
};

const statusLabels: Record<string, string> = {
  DRAFT: "임시 저장",
  SUBMITTED: "접수 완료",
  PRE_REVIEW: "사전 검토",
  WAITING_PAYMENT: "결제 대기",
  IN_PROGRESS: "심의 진행",
  RESULT_READY: "결과 확인",
  COMPLETED: "완료",
};

export function SubmissionDetailClient({
  submissionId,
  initialSubmission,
  initialEvents,
  initialStationReviews,
}: {
  submissionId: string;
  initialSubmission: Submission;
  initialEvents: SubmissionEvent[];
  initialStationReviews: StationReview[];
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [submission, setSubmission] =
    React.useState<Submission>(initialSubmission);
  const [events, setEvents] = React.useState<SubmissionEvent[]>(
    initialEvents ?? [],
  );
  const [stationReviews, setStationReviews] = React.useState<StationReview[]>(
    initialStationReviews ?? [],
  );

  const fetchLatest = React.useCallback(async () => {
    const { data: submissionData } = await supabase
      .from("submissions")
      .select(
        "id, title, artist_name, status, payment_status, created_at, updated_at, package:packages ( name, station_count, price_krw )",
      )
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionData) {
      setSubmission(submissionData);
    }

    const { data: eventsData } = await supabase
      .from("submission_events")
      .select("id, event_type, message, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false });

    if (eventsData) {
      setEvents(eventsData);
    }

    const { data: stationData } = await supabase
      .from("station_reviews")
      .select(
        "id, status, result_note, updated_at, station:stations ( id, name, code )",
      )
      .eq("submission_id", submissionId)
      .order("updated_at", { ascending: false });

    if (stationData) {
      setStationReviews(stationData);
    }
  }, [submissionId, supabase]);

  React.useEffect(() => {
    const channel = supabase
      .channel(`submission-${submissionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submissions",
          filter: `id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "station_reviews",
          filter: `submission_id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submission_events",
          filter: `submission_id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchLatest, submissionId, supabase]);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Submission Detail
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            {submission.title || "제목 미입력"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {submission.artist_name || "아티스트 미입력"}
          </p>
        </div>
        <div className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground">
          {statusLabels[submission.status] ?? submission.status}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            접수 정보
          </p>
          <div className="mt-4 grid gap-4 text-sm text-foreground md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">패키지</p>
              <p className="mt-1 font-semibold">
                {submission.package?.name ?? "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">방송국 수</p>
              <p className="mt-1 font-semibold">
                {submission.package?.station_count ?? "-"}곳
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">금액</p>
              <p className="mt-1 font-semibold">
                {submission.package?.price_krw
                  ? `${formatCurrency(submission.package.price_krw)}원`
                  : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">결제 상태</p>
              <p className="mt-1 font-semibold">
                {submission.payment_status}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">접수 일시</p>
              <p className="mt-1 font-semibold">
                {formatDateTime(submission.created_at)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">최근 업데이트</p>
              <p className="mt-1 font-semibold">
                {formatDateTime(submission.updated_at)}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-[28px] border border-border/60 bg-background/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            타임라인
          </p>
          <div className="mt-4 space-y-3">
            {events && events.length > 0 ? (
              events.map((event) => (
                <div
                  key={event.id}
                  className="rounded-2xl border border-border/60 bg-card/80 px-4 py-3 text-xs"
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
                아직 등록된 이벤트가 없습니다.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            방송국별 진행표
          </p>
          <span className="text-xs text-muted-foreground">
            업데이트: {formatDateTime(submission.updated_at)}
          </span>
        </div>
        <div className="mt-5 space-y-3">
          {stationReviews && stationReviews.length > 0 ? (
            stationReviews.map((review) => (
              <div
                key={review.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-foreground">
                    {review.station?.name ?? "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {review.station?.code ?? ""}
                  </p>
                  {review.result_note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {review.result_note}
                    </p>
                  )}
                </div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {review.status}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDateTime(review.updated_at)}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
              아직 방송국 진행 정보가 없습니다. 접수 제출 후 자동 생성됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

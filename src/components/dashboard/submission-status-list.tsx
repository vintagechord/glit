"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { formatDate, formatDateTime } from "@/lib/format";
import { summarizeTrackResults } from "@/lib/track-results";

type StationReview = {
  id: string;
  status: string;
  updated_at: string | null;
  track_results?: unknown;
  result_note?: string | null;
  station?: { name?: string | null } | null;
};

type SubmissionItem = {
  id: string;
  title: string | null;
  artist_name: string | null;
  status: string;
  payment_status: string;
  created_at: string | null;
  updated_at: string | null;
  type: string;
  amount_krw: number | null;
  is_oneclick: boolean | null;
  station_reviews: StationReview[];
};

const statusLabels: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "임시저장", tone: "bg-slate-500/10 text-slate-600" },
  SUBMITTED: { label: "접수", tone: "bg-sky-500/10 text-sky-600" },
  PRE_REVIEW: { label: "사전검토", tone: "bg-violet-500/10 text-violet-600" },
  WAITING_PAYMENT: {
    label: "결제대기",
    tone: "bg-amber-500/10 text-amber-700",
  },
  IN_PROGRESS: { label: "진행중", tone: "bg-indigo-500/10 text-indigo-600" },
  RESULT_READY: { label: "결과", tone: "bg-emerald-500/10 text-emerald-600" },
  COMPLETED: { label: "완료", tone: "bg-emerald-500/15 text-emerald-700" },
};

const paymentLabels: Record<string, { label: string; tone: string }> = {
  UNPAID: { label: "미결제", tone: "bg-slate-500/10 text-slate-600" },
  PAYMENT_PENDING: {
    label: "결제대기",
    tone: "bg-amber-500/10 text-amber-700",
  },
  PAID: { label: "결제완료", tone: "bg-emerald-500/10 text-emerald-600" },
  REFUNDED: { label: "환불", tone: "bg-rose-500/10 text-rose-600" },
};

const typeLabels: Record<string, string> = {
  ALBUM: "음반 심의",
  MV_DISTRIBUTION: "뮤직비디오 심의 (유통/온라인)",
  MV_BROADCAST: "뮤직비디오 심의 (TV 송출)",
};

const completionStatuses = ["APPROVED", "REJECTED", "NEEDS_FIX"];

const receptionStatusMap: Record<string, { label: string; tone: string }> = {
  NOT_SENT: {
    label: "접수대기",
    tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  },
  SENT: {
    label: "접수완료",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  },
  RECEIVED: {
    label: "심의진행중",
    tone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-200",
  },
  APPROVED: {
    label: "결과통보",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "결과통보",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
  NEEDS_FIX: {
    label: "수정요청",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  },
};

const resultStatusMap: Record<string, { label: string; tone: string }> = {
  NOT_SENT: {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  },
  SENT: {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  },
  RECEIVED: {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  },
  APPROVED: {
    label: "통과",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "불통과",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
  NEEDS_FIX: {
    label: "수정요청",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  },
};

const getReceptionStatus = (status: string) =>
  receptionStatusMap[status] ?? {
    label: "접수",
    tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  };

const getResultStatus = (status: string) =>
  resultStatusMap[status] ?? {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  };

const resolveResultStatus = (review: StationReview) => {
  const summary = summarizeTrackResults(review.track_results);
  const base =
    summary.outcome === "APPROVED"
      ? resultStatusMap.APPROVED
      : summary.outcome === "REJECTED"
        ? resultStatusMap.REJECTED
        : summary.outcome === "PARTIAL"
          ? {
              label: "부분 통과",
              tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
            }
          : getResultStatus(review.status);

  const total = summary.counts.total;
  const summaryText =
    total > 1
      ? `${summary.counts.approved}곡 통과 / ${summary.counts.rejected}곡 불통과${
          summary.counts.pending > 0 ? ` / ${summary.counts.pending}곡 대기` : ""
        }`
      : null;

  return { ...base, summaryText };
};

const isStationCompleted = (review: StationReview) => {
  const summary = summarizeTrackResults(review.track_results);
  if (summary.outcome && summary.outcome !== "PENDING") {
    return true;
  }
  return completionStatuses.includes(review.status);
};

export function SubmissionStatusList({
  submissions,
}: {
  submissions: SubmissionItem[];
}) {
  const router = useRouter();
  const [activeSubmission, setActiveSubmission] =
    React.useState<SubmissionItem | null>(null);
  const [trackResultModal, setTrackResultModal] = React.useState<{
    stationName: string;
    summary: ReturnType<typeof summarizeTrackResults>;
  } | null>(null);
  const [activeResultNote, setActiveResultNote] = React.useState<{
    stationName: string;
    note: string;
  } | null>(null);

  if (submissions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
        아직 접수된 내역이 없습니다.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {submissions.map((submission) => {
          const statusInfo =
            statusLabels[submission.status] ?? statusLabels.DRAFT;
          const paymentInfo =
            paymentLabels[submission.payment_status] ?? paymentLabels.UNPAID;
          const shouldShowPaymentChip = !(
            submission.status === "WAITING_PAYMENT" &&
            submission.payment_status === "PAYMENT_PENDING"
          );
          const typeLabel =
            typeLabels[submission.type] ?? submission.type ?? "심의";
          const stationReviews = [...(submission.station_reviews ?? [])].sort(
            (a, b) =>
              new Date(b.updated_at ?? 0).getTime() -
              new Date(a.updated_at ?? 0).getTime(),
          );
          const totalStations = stationReviews.length;
          const completedStations = stationReviews.filter((review) =>
            isStationCompleted(review),
          ).length;
          const progressPercent =
            totalStations > 0
              ? Math.round((completedStations / totalStations) * 100)
              : 0;
          const stageLabel = (() => {
            if (
              submission.status === "COMPLETED" ||
              submission.status === "RESULT_READY"
            ) {
              return "전체 심의 완료";
            }
            if (submission.status === "IN_PROGRESS") {
              return "심의 진행중";
            }
            if (
              submission.status === "SUBMITTED" ||
              submission.status === "PRE_REVIEW"
            ) {
              return "심의 접수완료";
            }
            if (submission.payment_status === "PAID") {
              return "결제완료";
            }
            return "결제대기";
          })();

          return (
            <div
              key={submission.id}
              className="rounded-[28px] border border-border/60 bg-card/80 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    {typeLabel}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-foreground">
                    {submission.title || "제목 미입력"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {submission.artist_name || "아티스트 미입력"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    접수일 {formatDateTime(submission.created_at)} · 최근
                    업데이트 {formatDateTime(submission.updated_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${statusInfo.tone}`}
                  >
                    {statusInfo.label}
                  </span>
                  {shouldShowPaymentChip && (
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${paymentInfo.tone}`}
                    >
                      {paymentInfo.label}
                    </span>
                  )}
                  {submission.payment_status !== "PAID" && (
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/pay/${submission.id}`)}
                      className="rounded-full border border-amber-500/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700 transition hover:border-amber-600 hover:text-amber-800"
                    >
                      결제하기
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveSubmission(submission)}
                    className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                  >
                    상세 보기
                  </button>
                </div>
              </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      진행률 {progressPercent}% · {completedStations}/
                      {totalStations}
                    </span>
                    <span>{stageLabel}</span>
                  </div>
                <div className="mt-2 h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-foreground transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {activeSubmission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setActiveSubmission(null);
            setTrackResultModal(null);
            setActiveResultNote(null);
          }}
        >
          <div
            className="w-full max-w-3xl rounded-[32px] border border-border/60 bg-background/95 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  심의 진행 상황
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-foreground">
                  {activeSubmission.title || "제목 미입력"}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeSubmission.artist_name || "아티스트 미입력"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveSubmission(null);
                  setTrackResultModal(null);
                  setActiveResultNote(null);
                }}
                className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-foreground"
              >
                닫기
              </button>
            </div>

            {activeSubmission.is_oneclick && (
              <div className="mt-4 rounded-2xl border border-border/60 bg-card/80 px-4 py-3 text-lg font-semibold text-foreground">
                {(activeSubmission.artist_name || "아티스트 미입력") +
                  " - " +
                  (activeSubmission.title || "제목 미입력")}
              </div>
            )}

            <div className="mt-4 grid gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 text-xs text-muted-foreground md:grid-cols-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em]">
                  유형
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {typeLabels[activeSubmission.type] ??
                    activeSubmission.type}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em]">
                  결제 금액
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {activeSubmission.amount_krw
                    ? `${activeSubmission.amount_krw.toLocaleString()}원`
                    : "-"}
                </p>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-border/60 bg-background/80">
              <div className="grid grid-cols-[1.1fr_0.9fr_0.9fr_1fr] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <span>방송국</span>
                <span className="justify-self-center text-center">접수 상태</span>
                <span className="justify-self-center text-center">트랙 결과</span>
                <span className="text-right">접수 날짜</span>
              </div>
              {activeSubmission.station_reviews.length > 0 ? (
                <div className="space-y-2 px-3 py-3 text-xs">
                  {[...activeSubmission.station_reviews]
                    .sort(
                      (a, b) =>
                        new Date(b.updated_at ?? 0).getTime() -
                        new Date(a.updated_at ?? 0).getTime(),
                    )
                    .map((station, index) => {
                    const reception = getReceptionStatus(station.status);
                    const result = resolveResultStatus(station);
                    const summary = summarizeTrackResults(station.track_results);
                    const canOpenTracks = summary.counts.total > 0;
                    const note = station.result_note?.trim() ?? "";
                    const hasRejection = summary.counts.rejected > 0;
                    const showNote = note.length > 0 && hasRejection;
                    const notePreview =
                      note.length > 28 ? `${note.slice(0, 28)}…` : note;
                    return (
                      <div
                        key={`${station.id}-${index}`}
                        className="grid grid-cols-[1.1fr_0.9fr_0.9fr_1fr] items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-[11px]"
                      >
                        <span className="truncate font-semibold text-foreground">
                          {station.station?.name ?? "-"}
                        </span>
                        <span
                          className={`inline-flex items-center justify-center justify-self-center rounded-full px-2 py-1 text-[10px] font-semibold ${reception.tone}`}
                        >
                          {reception.label}
                        </span>
                        <div className="flex flex-col items-center justify-center gap-1 justify-self-center">
                          {canOpenTracks ? (
                            <button
                              type="button"
                              onClick={() =>
                                setTrackResultModal({
                                  stationName: station.station?.name ?? "-",
                                  summary,
                                })
                              }
                              className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[10px] font-semibold transition hover:opacity-90 ${result.tone}`}
                            >
                              {result.label}
                            </button>
                          ) : (
                            <span
                              className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[10px] font-semibold ${result.tone}`}
                            >
                              {result.label}
                            </span>
                          )}
                          {result.summaryText ? (
                            <span className="text-[9px] leading-tight text-muted-foreground text-center">
                              {result.summaryText}
                            </span>
                          ) : null}
                          {showNote ? (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveResultNote({
                                  stationName: station.station?.name ?? "-",
                                  note,
                                })
                              }
                              className="rounded-full border border-border/60 px-2 py-0.5 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground"
                            >
                              <span className="block max-w-[120px] truncate">
                                {notePreview || "사유 보기"}
                              </span>
                            </button>
                          ) : null}
                        </div>
                        <span className="text-right text-[10px] text-muted-foreground">
                          {formatDate(station.updated_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                  접수 후 방송국 진행 정보를 확인할 수 있습니다.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeResultNote ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
            <p className="text-sm font-semibold text-foreground">불통과 사유</p>
            {activeResultNote.stationName ? (
              <p className="mt-2 text-xs font-semibold text-foreground">
                {activeResultNote.stationName}
              </p>
            ) : null}
            <textarea
              readOnly
              value={activeResultNote.note}
              className="mt-3 h-40 w-full resize-none rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setActiveResultNote(null)}
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {trackResultModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              트랙별 결과
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {trackResultModal.stationName}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {trackResultModal.summary.counts.approved}곡 통과 ·{" "}
              {trackResultModal.summary.counts.rejected}곡 불통과
              {trackResultModal.summary.counts.pending > 0
                ? ` · ${trackResultModal.summary.counts.pending}곡 대기`
                : ""}
            </p>
            <div className="mt-4 max-h-80 space-y-2 overflow-auto">
              {trackResultModal.summary.results.map((track, index) => {
                const status =
                  track.status === "APPROVED"
                    ? {
                        label: "통과",
                        tone:
                          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
                      }
                    : track.status === "REJECTED"
                      ? {
                          label: "불통과",
                          tone:
                            "bg-rose-500/15 text-rose-700 dark:text-rose-200",
                        }
                      : {
                          label: "대기",
                          tone:
                            "bg-slate-500/10 text-slate-600 dark:text-slate-300",
                        };
                const trackLabel =
                  track.title ||
                  (typeof track.track_no === "number"
                    ? `트랙 ${track.track_no}`
                    : "트랙");
                return (
                  <div
                    key={`${track.track_id ?? index}-${track.track_no ?? index}`}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">
                        {track.track_no ? `${track.track_no}. ` : ""}
                        {trackLabel}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-[11px] font-semibold ${status.tone}`}
                    >
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setTrackResultModal(null)}
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

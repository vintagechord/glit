"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { formatDate, formatDateTime, formatShortDate } from "@/lib/format";
import {
  buildStationTrackSummaryText,
  getStationReviewDisplayStatus,
} from "@/lib/station-review-display";
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
  DRAFT: { label: "임시저장", tone: "bauhaus-status-chip--neutral" },
  SUBMITTED: { label: "접수", tone: "bauhaus-status-chip--info" },
  PRE_REVIEW: { label: "사전검토", tone: "bauhaus-status-chip--waiting" },
  WAITING_PAYMENT: {
    label: "결제 대기",
    tone: "bauhaus-status-chip--waiting",
  },
  IN_PROGRESS: { label: "진행중", tone: "bauhaus-status-chip--progress" },
  RESULT_READY: { label: "결과", tone: "bauhaus-status-chip--success" },
  COMPLETED: { label: "완료", tone: "bauhaus-status-chip--success" },
};

const paymentLabels: Record<string, { label: string; tone: string }> = {
  UNPAID: { label: "미결제", tone: "bauhaus-status-chip--neutral" },
  PAYMENT_PENDING: {
    label: "결제 대기",
    tone: "bauhaus-status-chip--waiting",
  },
  PAID: { label: "결제완료", tone: "bauhaus-status-chip--success" },
  REFUNDED: { label: "환불", tone: "bauhaus-status-chip--danger" },
};

const typeLabels: Record<string, string> = {
  ALBUM: "음반 심의",
  MV_DISTRIBUTION: "뮤직비디오 심의 (유통/온라인)",
  MV_BROADCAST: "뮤직비디오 심의 (TV 송출)",
};

const buildTrackSummaryText = (
  counts: { approved: number; rejected: number; pending: number },
  separator: string,
) => {
  return buildStationTrackSummaryText(counts, separator);
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
    resultNote: string | null;
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
          const rawDisplayStatus =
            submission.payment_status !== "PAID" &&
            submission.status !== "DRAFT" &&
            submission.status !== "PRE_REVIEW"
              ? "WAITING_PAYMENT"
              : submission.status;
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
          const stationDisplayStatuses = stationReviews.map((review) =>
            getStationReviewDisplayStatus(review),
          );
          const totalStations = stationReviews.length;
          const completedStations = stationDisplayStatuses.filter(
            (status) => status.isComplete,
          ).length;
          const hasAttentionStatus = stationDisplayStatuses.some(
            (status) => status.needsAttention,
          );
          const isAlbumSubmission = submission.type === "ALBUM";
          const hasAllStationResults =
            totalStations > 0 && completedStations >= totalStations;
          const displayStatus =
            isAlbumSubmission &&
            totalStations > 0 &&
            submission.payment_status === "PAID"
              ? hasAllStationResults
                ? "COMPLETED"
                : "SUBMITTED"
              : rawDisplayStatus;
          const statusInfo =
            isAlbumSubmission &&
            totalStations > 0 &&
            submission.payment_status === "PAID" &&
            !hasAllStationResults
              ? { ...statusLabels.SUBMITTED, label: "접수완료" }
              : statusLabels[displayStatus] ?? statusLabels.DRAFT;
          const progressPercent =
            totalStations > 0
              ? Math.round((completedStations / totalStations) * 100)
              : 0;
          const stageLabel = (() => {
            if (submission.payment_status !== "PAID") {
              return "입금 확인 대기";
            }
            if (isAlbumSubmission && totalStations > 0) {
              return hasAllStationResults ? "완료" : "접수완료";
            }
            if (
              submission.status === "COMPLETED" ||
              submission.status === "RESULT_READY"
            ) {
              return hasAttentionStatus ? "확인 필요" : "완료";
            }
            if (submission.status === "IN_PROGRESS") {
              return hasAttentionStatus ? "확인 필요" : "진행중";
            }
            if (
              submission.status === "SUBMITTED" ||
              submission.status === "PRE_REVIEW"
            ) {
              return "접수완료";
            }
            return hasAttentionStatus ? "확인 필요" : "진행중";
          })();

          return (
            <div
              key={submission.id}
              className="overflow-hidden rounded-[28px] border border-border/60 bg-card/80 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    {typeLabel}
                  </p>
                  <h2 className="mt-2 truncate text-xl font-semibold text-foreground">
                    {submission.title || "제목 미입력"}
                  </h2>
                  <p className="mt-2 truncate text-sm text-muted-foreground">
                    {submission.artist_name || "아티스트 미입력"}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    접수일 {formatDateTime(submission.created_at)} · Updated{" "}
                    {formatDateTime(submission.updated_at)}
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                  <span
                    className={`bauhaus-status-chip ${statusInfo.tone}`}
                  >
                    {statusInfo.label}
                  </span>
                  {shouldShowPaymentChip && (
                    <span
                      className={`bauhaus-status-chip ${paymentInfo.tone}`}
                    >
                      {paymentInfo.label}
                    </span>
                  )}
                  {submission.payment_status !== "PAID" && (
                    <button
                      type="button"
                      onClick={() => router.push(`/mypage/cart?focus=${submission.id}`)}
                      className="rounded-full border-2 border-[#111111] bg-[var(--bauhaus-red)] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-white shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#b92d25] dark:border-[#f2cf27] dark:text-[#06111f] dark:shadow-[2px_2px_0_#f2cf27] dark:hover:bg-[#ff7a72]"
                    >
                      결제하기
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveSubmission(submission)}
                    className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                  >
                    상세 보기
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{totalStations}곳 중 {completedStations}곳 완료 · {progressPercent}%</span>
                  <span>{stageLabel}</span>
                </div>
                <div
                  className="mt-2 h-2 w-full rounded-full bg-muted"
                  role="progressbar"
                  aria-label="심의 완료율"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                >
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
          }}
        >
          <div
            className="w-full max-w-3xl rounded-[32px] border border-border/60 bg-background/95 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  방송국별 현황
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
                }}
                className="rounded-full border border-border/70 px-3 py-1 text-sm font-semibold uppercase tracking-[0.2em] text-foreground"
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

            <div className="mt-4 grid gap-4 rounded-2xl border border-border/60 bg-card/80 p-4 text-sm text-muted-foreground md:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em]">
                  유형
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {typeLabels[activeSubmission.type] ??
                    activeSubmission.type}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em]">
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
              <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(110px,0.8fr)_96px] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <span>방송국</span>
                <span className="justify-self-center text-center">현재 상태</span>
                <span className="text-right">Updated</span>
              </div>
              {activeSubmission.station_reviews.length > 0 ? (
                <div className="space-y-2 px-3 py-3 text-sm">
                  {[...activeSubmission.station_reviews]
                    .sort(
                      (a, b) =>
                        new Date(b.updated_at ?? 0).getTime() -
                        new Date(a.updated_at ?? 0).getTime(),
                    )
                    .map((station, index) => {
                    const currentStatus = getStationReviewDisplayStatus(station, {
                      showPartialTrackBreakdown: true,
                    });
                    const summary = currentStatus.summary;
                    const canOpenTracks = summary.counts.rejected > 0;
                    return (
                      <div
                        key={`${station.id}-${index}`}
                        className="grid grid-cols-[minmax(0,1.4fr)_minmax(110px,0.8fr)_96px] items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-sm"
                      >
                        <span className="truncate font-semibold text-foreground">
                          {station.station?.name ?? "-"}
                        </span>
                        <div className="flex flex-col items-center justify-center gap-1 justify-self-center">
                          {canOpenTracks ? (
                            <button
                              type="button"
                              onClick={() =>
                                setTrackResultModal({
                                  stationName: station.station?.name ?? "-",
                                  summary,
                                  resultNote: station.result_note?.trim() || null,
                                })
                              }
                              className={`bauhaus-status-chip bauhaus-status-chip--compact min-h-[34px] min-w-[100px] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 ${currentStatus.tone}`}
                            >
                              {currentStatus.label}
                            </button>
                          ) : (
                            <span
                              className={`bauhaus-status-chip bauhaus-status-chip--compact min-h-[34px] min-w-[100px] ${currentStatus.tone}`}
                            >
                              {currentStatus.label}
                            </span>
                          )}
                          {currentStatus.summaryText ? (
                            <span className="text-[11px] leading-tight text-muted-foreground text-center">
                              {currentStatus.summaryText}
                            </span>
                          ) : null}
                        </div>
                        <span
                          className="text-right text-xs text-muted-foreground"
                          title={formatDate(station.updated_at)}
                          aria-label={`Updated ${formatDate(station.updated_at)}`}
                        >
                          {formatShortDate(station.updated_at)}
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

      {trackResultModal ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
          onClick={() => setTrackResultModal(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              트랙별 결과
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {trackResultModal.stationName}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {buildTrackSummaryText(trackResultModal.summary.counts, " · ")}
            </p>
            <div className="mt-4 max-h-80 space-y-2 overflow-auto">
              {trackResultModal.summary.results.map((track, index) => {
                const status =
                  track.status === "APPROVED"
                    ? {
                        label: "적격",
                        tone: "bauhaus-status-chip--success",
                      }
                    : track.status === "REJECTED"
                      ? {
                          label: "부적격",
                          tone: "bauhaus-status-chip--danger",
                        }
                      : {
                          label: "대기",
                          tone: "bauhaus-status-chip--neutral",
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
                      {track.status === "REJECTED" &&
                      trackResultModal.resultNote ? (
                        <p className="mt-1 break-words text-xs text-[#1556a4]/90 dark:text-[#b9d8ff]">
                          사유: {trackResultModal.resultNote}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`bauhaus-status-chip bauhaus-status-chip--compact ${status.tone}`}
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
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-[#f6d64a] hover:text-black"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

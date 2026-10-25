"use client";

import * as React from "react";
import { ConfirmSubmitButton } from "./confirm-submit-button";

type TrackResultInput = {
  id?: string | null;
  track_no?: number | null;
  title: string;
  status?: string | null;
  composer?: string | null;
  lyricist?: string | null;
  arranger?: string | null;
};

type StationReviewFormProps = {
  submissionId: string;
  reviewId?: string | null;
  stationId: string | null;
  stationCode?: string | null;
  stationName?: string | null;
  initialStatus: string;
  initialMemo: string;
  expectedUpdatedAt: string | null;
  showAgeRating?: boolean;
  initialAgeRating?: string | null;
  trackResults: TrackResultInput[];
  statusOptions: Array<{ value: string; label: string }>;
  action: (formData: FormData) => Promise<void>;
  returnTo?: string;
  maxDecidedTracks?: number;
};

export function StationReviewForm({
  submissionId,
  reviewId,
  stationId,
  stationCode,
  stationName,
  initialStatus,
  initialMemo,
  expectedUpdatedAt,
  showAgeRating,
  initialAgeRating,
  trackResults,
  statusOptions,
  action,
  returnTo,
  maxDecidedTracks,
}: StationReviewFormProps) {
  const formId = React.useId();
  const normalizedInitialStatus = maxDecidedTracks && initialStatus !== "NEEDS_FIX" ? "SENT" : statusOptions.some(
    (option) => option.value === initialStatus,
  )
    ? initialStatus
    : "SENT";
  const [stationStatus, setStationStatus] = React.useState(normalizedInitialStatus);
  const [stationMemo, setStationMemo] = React.useState(initialMemo ?? "");
  const [trackStates, setTrackStates] = React.useState(
    trackResults.map((track) => ({
      id: track.id ?? null,
      track_no: track.track_no ?? null,
      title: track.title,
      status: track.status ?? "PENDING",
    })),
  );

  const trackResultsJson = React.useMemo(
    () =>
      JSON.stringify(
        trackStates.map((t) => ({
          track_id: t.id,
          track_no: t.track_no,
          title: t.title,
          status: t.status,
        })),
      ),
    [trackStates],
  );

  return (
    <form
      action={action}
      method="post"
      className="grid min-w-0 gap-4 rounded-2xl border border-border/60 bg-background/80 p-3 [overflow-wrap:anywhere] sm:p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)]"
    >
      <input type="hidden" name="submission_id" value={submissionId} />
      <input type="hidden" name="station_id" value={stationId ?? ""} />
      <input type="hidden" name="review_id" value={reviewId ?? ""} />
      <input type="hidden" name="track_results_json" value={trackResultsJson} />
      <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt ?? ""} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <div className="min-w-0 self-center">
        <p className="text-sm font-semibold text-foreground">
          {stationName ?? stationCode ?? "-"}
        </p>
        <p className="text-xs text-muted-foreground">{stationCode ?? ""}</p>
      </div>

      <div className="min-w-0 space-y-1.5">
        <label htmlFor={`${formId}-status`} className="block text-xs font-semibold text-muted-foreground">방송국 심의 상태</label>
        <select
          id={`${formId}-status`}
          name="station_status"
          aria-label={`${stationName ?? stationCode ?? "방송국"} 심의 상태`}
          value={stationStatus}
          onChange={(e) => {
            const status = e.target.value;
            setStationStatus(status);
            if (["APPROVED", "REJECTED", "SENT", "NOT_SENT", "RECEIVED"].includes(status)) {
              setTrackStates((prev) => prev.map((track) => ({
                ...track,
                status: ["APPROVED", "REJECTED"].includes(status) ? status : "PENDING",
              })));
            }
          }}
          className="min-h-11 w-full min-w-0 rounded-xl border border-border/70 bg-background px-3 py-2 text-base md:text-sm"
        >
          {statusOptions.map((status) => (
            <option key={status.value} value={status.value} disabled={Boolean(maxDecidedTracks && ["APPROVED", "REJECTED"].includes(status.value))}>
              {status.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0 space-y-1.5">
        <label htmlFor={`${formId}-memo`} className="block text-xs font-semibold text-muted-foreground">의뢰자에게 전달할 메모</label>
        <input
          id={`${formId}-memo`}
          name="station_memo"
          aria-label={`${stationName ?? stationCode ?? "방송국"} 의뢰자에게 전달할 메모`}
          value={stationMemo}
          onChange={(e) => setStationMemo(e.target.value)}
          placeholder="의뢰자에게 전달할 메모"
          className="min-h-11 w-full min-w-0 rounded-xl border border-border/70 bg-background px-3 py-2 text-base md:text-sm"
        />
      </div>

      {showAgeRating ? (
        <label className="min-w-0 space-y-1.5 md:col-span-3">
          <span className="block text-xs font-semibold text-muted-foreground">이 방송사의 연령 등급</span>
          <select name="age_rating" defaultValue={initialAgeRating ?? ""} aria-label={`${stationName ?? stationCode ?? "방송국"} 연령 등급`} required={stationStatus === "APPROVED"} className="min-h-11 w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-base md:text-sm">
            <option value="">등급 선택</option>
            <option value="ALL">전체 시청가</option><option value="12">12세 이상 시청가</option><option value="15">15세 이상 시청가</option><option value="19">19세 이상 시청가</option>
          </select>
          <span className="block text-xs text-muted-foreground">선택한 방송사의 결과를 저장합니다. 모든 결과를 확인한 뒤 결과 안내에서 이메일을 따로 발송해주세요.</span>
        </label>
      ) : null}
      {trackStates.length > 0 ? (
        <div className="min-w-0 md:col-span-3">
          {maxDecidedTracks ? <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">원음방송 심의 대상이 확인되지 않았습니다. 실제 심의한 3곡의 결과를 입력해주세요. 나머지 곡은 대기로 두세요.</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              트랙별 결과
            </p>
            <p className="text-[11px] text-muted-foreground">
              {trackStates.filter((t) => t.status === "APPROVED").length}곡 적격 ·{" "}
              {trackStates.filter((t) => t.status === "REJECTED").length}곡 부적격 ·{" "}
              {trackStates.filter((t) => t.status === "PENDING").length}곡 대기
            </p>
          </div>
          <div className="mt-2 space-y-2 rounded-2xl border border-border/60 bg-background/60 p-2 sm:p-3">
            {trackStates.map((track, index) => {
              return (
                <div
                  key={`${track.id ?? track.track_no ?? index}`}
                  className="grid min-w-0 items-center gap-2 rounded-xl border border-border/50 bg-background/80 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_120px] sm:gap-3 md:grid-cols-[minmax(0,1fr)_180px]"
                >
                  <div className="min-w-0">
                    <p className="font-semibold leading-relaxed text-foreground">
                      {track.track_no ? `${track.track_no}. ` : ""}
                      {track.title}
                    </p>
                  </div>
                  <select
                    aria-label={`${track.title} 심의 결과`}
                    value={track.status}
                    onChange={(e) => {
                      const next = trackStates.map((t, i) =>
                        i === index ? { ...t, status: e.target.value } : t,
                      );
                      setTrackStates(next);
                      if (stationStatus !== "NEEDS_FIX") {
                        setStationStatus(next.some((track) => track.status === "PENDING")
                          ? "SENT"
                          : next.every((track) => track.status === "REJECTED") ? "REJECTED" : "APPROVED");
                      }
                    }}
                    className="min-h-11 w-full min-w-0 rounded-xl border border-border/70 bg-background px-3 py-2 text-base md:text-sm"
                  >
                    <option value="PENDING">대기</option>
                    <option value="APPROVED" disabled={Boolean(maxDecidedTracks && track.status === "PENDING" && trackStates.filter((item) => item.status !== "PENDING").length >= maxDecidedTracks)}>적격</option>
                    <option value="REJECTED" disabled={Boolean(maxDecidedTracks && track.status === "PENDING" && trackStates.filter((item) => item.status !== "PENDING").length >= maxDecidedTracks)}>부적격</option>
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex justify-end md:col-span-3">
        <ConfirmSubmitButton className="min-h-11 w-full rounded-full bg-foreground px-6 py-2.5 text-sm font-semibold text-background sm:w-auto">
          저장
        </ConfirmSubmitButton>
      </div>
    </form>
  );
}

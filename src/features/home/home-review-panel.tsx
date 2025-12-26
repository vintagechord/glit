"use client";

import * as React from "react";
import Link from "next/link";

import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type StationItem = {
  id: string;
  status: string;
  updated_at: string;
  station?: {
    name?: string | null;
  } | null;
};

type SubmissionSummary = {
  id: string;
  title: string | null;
  status: string;
  updated_at: string;
};

type TabKey = "album" | "mv";

const steps = [
  "패키지 선택",
  "신청서 업로드",
  "옵션 선택",
  "결제하기",
  "접수 완료",
];

const statusToStep: Record<string, number> = {
  DRAFT: 2,
  SUBMITTED: 5,
  PRE_REVIEW: 5,
  WAITING_PAYMENT: 4,
  IN_PROGRESS: 5,
  RESULT_READY: 5,
  COMPLETED: 5,
};

const statusLabelMap: Record<string, { label: string; tone: string }> = {
  NOT_SENT: {
    label: "접수예정",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  },
  SENT: {
    label: "접수",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  },
  RECEIVED: {
    label: "접수",
    tone: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
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
    label: "불통과",
    tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200",
  },
};

function getStatusLabel(status: string) {
  return (
    statusLabelMap[status] ?? {
      label: "접수",
      tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
    }
  );
}

export function HomeReviewPanel({
  isLoggedIn,
  albumSubmission,
  mvSubmission,
  albumStations,
  mvStations,
  albumDetailHref,
  mvDetailHref,
}: {
  isLoggedIn: boolean;
  albumSubmission: SubmissionSummary | null;
  mvSubmission: SubmissionSummary | null;
  albumStations: StationItem[];
  mvStations: StationItem[];
  albumDetailHref: string;
  mvDetailHref: string;
}) {
  const supabase = React.useMemo(
    () => (isLoggedIn ? createClient() : null),
    [isLoggedIn],
  );
  const [tab, setTab] = React.useState<TabKey>("album");
  const [albumState, setAlbumState] = React.useState({
    submission: albumSubmission,
    stations: albumStations,
  });
  const [mvState, setMvState] = React.useState({
    submission: mvSubmission,
    stations: mvStations,
  });

  const active = tab === "album" ? albumState : mvState;
  const activeSubmission = active.submission;
  const activeStations = active.stations;
  const activeHref = tab === "album" ? albumDetailHref : mvDetailHref;
  const isLive =
    isLoggedIn &&
    [albumState.submission, mvState.submission].some(
      (submission) =>
        submission && !["DRAFT", "COMPLETED"].includes(submission.status),
    );

  React.useEffect(() => {
    if (!supabase || !activeSubmission?.id) return;
    const channel = supabase
      .channel(`home-submission-${activeSubmission.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submissions",
          filter: `id=eq.${activeSubmission.id}`,
        },
        async () => {
          const { data } = await supabase
            .from("submissions")
            .select("id, title, status, updated_at")
            .eq("id", activeSubmission.id)
            .maybeSingle();
          if (!data) return;
          if (tab === "album") {
            setAlbumState((prev) => ({ ...prev, submission: data }));
          } else {
            setMvState((prev) => ({ ...prev, submission: data }));
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "station_reviews",
          filter: `submission_id=eq.${activeSubmission.id}`,
        },
        async () => {
          const { data } = await supabase
            .from("station_reviews")
            .select("id, status, updated_at, station:stations ( name )")
            .eq("submission_id", activeSubmission.id)
            .order("updated_at", { ascending: false });
          if (!data) return;
          if (tab === "album") {
            setAlbumState((prev) => ({ ...prev, stations: data }));
          } else {
            setMvState((prev) => ({ ...prev, stations: data }));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeSubmission?.id, supabase, tab]);

  const activeStep = activeSubmission
    ? statusToStep[activeSubmission.status] ?? 3
    : 1;
  const totalCount = activeStations.length;
  const completedCount = activeStations.filter((review) =>
    ["APPROVED", "REJECTED", "NEEDS_FIX"].includes(review.status),
  ).length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const stationsToShow = activeStations.slice(0, 5);

  return (
    <div className="rounded-[28px] border border-border/60 bg-card/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>나의 심의</span>
        <span className="inline-flex items-center gap-2">
          {isLoggedIn ? (
            isLive ? (
              <>
                <span className="h-2 w-2 rounded-full bg-rose-500 live-blink" />
                Live
              </>
            ) : (
              "Idle"
            )
          ) : (
            "Sample"
          )}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-full bg-muted/60 p-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <button
          type="button"
          onClick={() => setTab("album")}
          className={`flex-1 rounded-full px-3 py-2 transition ${
            tab === "album"
              ? "bg-background text-foreground shadow-sm"
              : "hover:text-foreground"
          }`}
        >
          앨범
        </button>
        <button
          type="button"
          onClick={() => setTab("mv")}
          className={`flex-1 rounded-full px-3 py-2 transition ${
            tab === "mv"
              ? "bg-background text-foreground shadow-sm"
              : "hover:text-foreground"
          }`}
        >
          뮤직비디오
        </button>
      </div>

      <div className="mt-6 space-y-5">
        <div className="rounded-2xl border border-dashed border-border/80 bg-background/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            {isLoggedIn ? "나의 접수 현황" : "접수 현황 예시"}
          </p>
          {activeSubmission ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-semibold text-foreground">
                {activeSubmission.title || "제목 미입력"}
              </p>
              <div className="grid gap-2 md:grid-cols-5">
                {steps.map((label, index) => {
                  const activeStepLabel = index + 1 <= activeStep;
                  return (
                    <div
                      key={label}
                      className={`rounded-xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                        activeStepLabel
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/60 bg-background text-muted-foreground"
                      }`}
                    >
                      STEP {String(index + 1).padStart(2, "0")}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm font-semibold text-foreground">
              아직 접수된 내역이 없습니다.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              심의 진행 상황
            </p>
            {activeStations.length > 5 && (
              <Link
                href={activeHref}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                더보기 →
              </Link>
            )}
          </div>
          <div className="mt-3 space-y-2 text-xs">
            {stationsToShow.length > 0 ? (
              stationsToShow.map((station) => {
                const status = getStatusLabel(station.status);
                return (
                  <div
                    key={station.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2"
                  >
                    <span className="font-semibold text-foreground">
                      {station.station?.name ?? "-"}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold ${status.tone}`}
                      >
                        {status.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(station.updated_at)}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-3 py-5 text-center text-xs text-muted-foreground">
                접수 후 방송국 진행 정보를 확인할 수 있습니다.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
          <div className="flex items-center justify-between text-sm font-semibold text-foreground">
            <span>전체 진행률</span>
            <span>{progressPercent}%</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {totalCount > 0
              ? `총 ${totalCount}곳 중 ${completedCount}곳 완료`
              : "방송국 결과가 등록되면 진행률이 표시됩니다."}
          </p>
          <div className="mt-3 h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-foreground transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

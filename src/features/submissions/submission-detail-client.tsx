"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { contributeKaraokePromotionAction } from "@/features/karaoke/actions";
import { getMvRatingFileUrlAction } from "@/features/submissions/actions";
import {
  SubmissionFilesPanel,
  type SubmissionFile,
} from "@/features/submissions/submission-files-panel";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type Submission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  type: string;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  amount_krw: number | null;
  created_at: string;
  updated_at: string;
  mv_rating_file_path?: string | null;
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

type PromotionInfo = {
  id: string;
  status: string;
  credits_balance: number;
  credits_required: number;
  tj_enabled: boolean;
  ky_enabled: boolean;
  reference_url: string | null;
};

const statusLabels: Record<string, string> = {
  DRAFT: "임시 저장",
  SUBMITTED: "접수 완료",
  PRE_REVIEW: "사전 검토",
  WAITING_PAYMENT: "결제 확인 중",
  IN_PROGRESS: "심의 진행",
  RESULT_READY: "결과 확인",
  COMPLETED: "완료",
};

const paymentMethodLabels: Record<string, string> = {
  BANK: "무통장",
  CARD: "카드",
};

const reviewReceptionMap: Record<string, { label: string; tone: string }> = {
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
    label: "접수완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  REJECTED: {
    label: "접수완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
  NEEDS_FIX: {
    label: "접수완료",
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  },
};

const reviewResultMap: Record<string, { label: string; tone: string }> = {
  APPROVED: {
    label: "적격",
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

const rejectedReviewStatuses = new Set(["REJECTED", "NEEDS_FIX"]);

const flowSteps = [
  "접수 완료",
  "결제 확인",
  "심의 진행",
  "결과 확인",
];

const submissionTypeLabels: Record<string, string> = {
  ALBUM: "음반 심의",
  MV_DISTRIBUTION: "M/V 심의 (유통/온라인)",
  MV_BROADCAST: "M/V 심의 (TV 송출)",
};

const radioSubmissionLinks: Array<{ name: string; url: string }> = [
  { name: "KBS Cool FM 신청곡/사연 접수", url: "https://program.kbs.co.kr/pc/fm" },
  { name: "MBC 라디오 미니(사연/신청곡)", url: "https://mini.imbc.com/" },
  {
    name: "SBS 파워FM 청취자 게시판",
    url: "https://programs.sbs.co.kr/radio",
  },
  { name: "TBS FM 신청곡/사연", url: "https://tbs.seoul.kr/" },
  { name: "CBS 음악FM 신청곡", url: "https://www.cbs.co.kr/radio" },
];

const getReviewReception = (status: string) =>
  reviewReceptionMap[status] ?? {
    label: "접수",
    tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  };

const getReviewResult = (status: string) =>
  reviewResultMap[status] ?? {
    label: "대기",
    tone: "bg-slate-500/10 text-slate-500 dark:text-slate-300",
  };

export function SubmissionDetailClient({
  submissionId,
  initialSubmission,
  initialFiles,
  initialEvents,
  initialStationReviews,
  promotion,
  creditBalance = 0,
  canManagePromotion = false,
  enableRealtime = true,
  guestToken,
}: {
  submissionId: string;
  initialSubmission: Submission;
  initialFiles: SubmissionFile[];
  initialEvents: SubmissionEvent[];
  initialStationReviews: StationReview[];
  promotion?: PromotionInfo | null;
  creditBalance?: number;
  canManagePromotion?: boolean;
  enableRealtime?: boolean;
  guestToken?: string;
}) {
  const supabase = React.useMemo(
    () => (enableRealtime ? createClient() : null),
    [enableRealtime],
  );
  const router = useRouter();
  const [submission, setSubmission] =
    React.useState<Submission>(initialSubmission);
  const [events, setEvents] = React.useState<SubmissionEvent[]>(
    initialEvents ?? [],
  );
  const [stationReviews, setStationReviews] = React.useState<StationReview[]>(
    initialStationReviews ?? [],
  );
  const [files, setFiles] = React.useState<SubmissionFile[]>(
    initialFiles ?? [],
  );
  const [promotionCredits, setPromotionCredits] = React.useState(1);
  const [tjEnabled, setTjEnabled] = React.useState(
    promotion?.tj_enabled ?? true,
  );
  const [kyEnabled, setKyEnabled] = React.useState(
    promotion?.ky_enabled ?? true,
  );
  const [referenceUrl, setReferenceUrl] = React.useState(
    promotion?.reference_url ?? "",
  );
  const [promotionNotice, setPromotionNotice] = React.useState<{
    error?: string;
    message?: string;
  }>({});
  const [ratingFileNotice, setRatingFileNotice] = React.useState<{
    error?: string;
  }>({});
  const [isRatingDownloading, setIsRatingDownloading] =
    React.useState(false);
  const [activeResultNote, setActiveResultNote] = React.useState<{
    stationName?: string | null;
    note: string;
  } | null>(null);
  const [radioLinksModal, setRadioLinksModal] = React.useState<{
    stationName?: string;
  } | null>(null);
  const [isPromotionSubmitting, setIsPromotionSubmitting] =
    React.useState(false);
  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const isMvSubmission =
    submission.type === "MV_BROADCAST" || submission.type === "MV_DISTRIBUTION";
  const isResultReady =
    submission.status === "RESULT_READY" || submission.status === "COMPLETED";
  const isPaymentDone = submission.payment_status === "PAID";
  const flowIndex = (() => {
    if (submission.status === "DRAFT") return 0;
    if (!isPaymentDone) return 0;
    if (submission.status === "IN_PROGRESS") return 2;
    if (submission.status === "RESULT_READY" || submission.status === "COMPLETED")
      return 3;
    return 1;
  })();

  React.useEffect(() => {
    if (!promotion) return;
    setTjEnabled(promotion.tj_enabled);
    setKyEnabled(promotion.ky_enabled);
    setReferenceUrl(promotion.reference_url ?? "");
  }, [promotion]);

  const openRadioLinks = (stationName?: string) => {
    setRadioLinksModal({ stationName });
  };

  const closeRadioLinks = () => setRadioLinksModal(null);

  const fetchLatest = React.useCallback(async () => {
    if (!supabase) return;
    const { data: submissionData } = await supabase
      .from("submissions")
      .select(
        "id, title, artist_name, type, status, payment_status, payment_method, amount_krw, mv_rating_file_path, created_at, updated_at, package:packages ( name, station_count, price_krw )",
      )
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionData) {
      const nextPackage = Array.isArray(submissionData.package)
        ? submissionData.package[0]
        : submissionData.package;
      setSubmission({ ...submissionData, package: nextPackage ?? null });
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
      setStationReviews(
        stationData.map((review) => ({
          ...review,
          station: Array.isArray(review.station)
            ? review.station[0]
            : review.station,
        })),
      );
    }

    const { data: fileData } = await supabase
      .from("submission_files")
      .select("id, kind, file_path, original_name, mime, size, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false });

    if (fileData) {
      setFiles(fileData);
    }
  }, [submissionId, supabase]);

  React.useEffect(() => {
    if (!enableRealtime || !supabase) return;
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "submission_files",
          filter: `submission_id=eq.${submissionId}`,
        },
        fetchLatest,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enableRealtime, fetchLatest, submissionId, supabase]);

  const handlePromotionSubmit = async () => {
    if (promotionCredits <= 0) {
      setPromotionNotice({ error: "사용할 크레딧을 입력해주세요." });
      return;
    }
    if (creditBalance < promotionCredits) {
      setPromotionNotice({ error: "보유한 크레딧이 부족합니다." });
      return;
    }
    if (!tjEnabled && !kyEnabled) {
      setPromotionNotice({ error: "노출 대상(태진/금영)을 선택해주세요." });
      return;
    }

    setIsPromotionSubmitting(true);
    setPromotionNotice({});
    const result = await contributeKaraokePromotionAction({
      submissionId,
      credits: promotionCredits,
      tjEnabled,
      kyEnabled,
      referenceUrl: referenceUrl.trim() || undefined,
    });

    if (result.error) {
      setPromotionNotice({ error: result.error });
      setIsPromotionSubmitting(false);
      return;
    }

    setPromotionNotice({ message: result.message });
    setPromotionCredits(1);
    setIsPromotionSubmitting(false);
    router.refresh();
  };

  const handleRatingFileDownload = async () => {
    setRatingFileNotice({});
    setIsRatingDownloading(true);
    const result = await getMvRatingFileUrlAction({
      submissionId,
      guestToken: guestToken ?? undefined,
    });
    if (result.error) {
      setRatingFileNotice({ error: result.error });
      setIsRatingDownloading(false);
      return;
    }
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
    setIsRatingDownloading(false);
  };

  const buildSubmissionText = () => {
    const lines: string[] = [];
    lines.push("GLIT 신청 내역");
    lines.push("=".repeat(40));
    lines.push(`제목: ${submission.title || "제목 미입력"}`);
    lines.push(`아티스트: ${submission.artist_name || "아티스트 미입력"}`);
    lines.push(`접수 ID: ${submission.id}`);
    lines.push(`접수 유형: ${submissionTypeLabels[submission.type] ?? submission.type}`);
    lines.push(`패키지: ${packageInfo?.name ?? "-"}`);
    lines.push(`방송국 수: ${packageInfo?.station_count ?? "-"}`);
    lines.push(
      `금액: ${
        submission.amount_krw
          ? `${formatCurrency(submission.amount_krw)}원`
          : packageInfo?.price_krw
            ? `${formatCurrency(packageInfo.price_krw)}원`
            : "-"
      }`,
    );
    lines.push(`결제 상태: ${submission.payment_status || "-"}`);
    lines.push(`결제 방식: ${submission.payment_method ? paymentMethodLabels[submission.payment_method] ?? submission.payment_method : "-"}`);
    lines.push(`접수 일시: ${formatDateTime(submission.created_at)}`);
    lines.push(`최근 업데이트: ${formatDateTime(submission.updated_at)}`);
    lines.push("");
    lines.push("방송국별 진행");
    lines.push("-".repeat(24));
    if (stationReviews.length > 0) {
      stationReviews.forEach((review) => {
        const reception = getReviewReception(review.status);
        const result = getReviewResult(review.status);
        lines.push(
          `- ${review.station?.name ?? "-"} | 접수: ${reception.label} | 결과: ${result.label} | 업데이트: ${formatDateTime(review.updated_at)}`,
        );
      });
    } else {
      lines.push("- 방송국 진행 정보가 없습니다.");
    }
    lines.push("");
    lines.push("타임라인");
    lines.push("-".repeat(16));
    if (events.length > 0) {
      events.forEach((event) => {
        lines.push(`- [${formatDateTime(event.created_at)}] ${event.event_type}${event.message ? `: ${event.message}` : ""}`);
      });
    } else {
      lines.push("- 등록된 이벤트가 없습니다.");
    }
    return lines.join("\n");
  };

  const handleDownloadText = () => {
    const content = buildSubmissionText();
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `submission-${submission.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleDownloadText}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
        >
          신청 내역 TXT 다운로드
        </button>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              접수 정보
            </p>
            <div className="mt-4 grid gap-4 text-sm text-foreground md:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">패키지</p>
                <p className="mt-1 font-semibold">
                  {packageInfo?.name ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">방송국 수</p>
                <p className="mt-1 font-semibold">
                  {packageInfo?.station_count ?? "-"}곳
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">금액</p>
                <p className="mt-1 font-semibold">
                  {submission.amount_krw
                    ? `${formatCurrency(submission.amount_krw)}원`
                    : packageInfo?.price_krw
                      ? `${formatCurrency(packageInfo.price_krw)}원`
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
                <p className="text-xs text-muted-foreground">결제 방식</p>
                <p className="mt-1 font-semibold">
                  {submission.payment_method
                    ? paymentMethodLabels[submission.payment_method] ??
                      submission.payment_method
                    : "-"}
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
              {isMvSubmission && (
                <div className="md:col-span-2">
                  <p className="text-xs text-muted-foreground">등급분류 파일</p>
                  {isResultReady && submission.mv_rating_file_path ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={handleRatingFileDownload}
                        disabled={isRatingDownloading}
                        className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        등급분류 파일 다운로드
                      </button>
                      {ratingFileNotice.error && (
                        <span className="text-xs text-red-500">
                          {ratingFileNotice.error}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isResultReady
                        ? "등급분류 파일이 아직 등록되지 않았습니다."
                        : "심의 완료 후 다운로드 가능합니다."}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              첨부 파일
            </p>
            <div className="mt-4">
              <SubmissionFilesPanel
                submissionId={submissionId}
                files={files}
                guestToken={guestToken}
              />
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="rounded-[28px] border border-border/60 bg-background/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              주문 진행 상태
            </p>
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-4">
                {flowSteps.map((label, index) => {
                  const isActive = index <= flowIndex;
                  return (
                    <div
                      key={label}
                      className={`rounded-2xl border px-3 py-3 text-center font-semibold ${
                        isActive
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/70 bg-background text-muted-foreground"
                      }`}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/80 px-4 py-3 text-xs text-muted-foreground">
                {isPaymentDone
                  ? "결제가 확인되었고 심의 절차가 진행됩니다."
                  : "현재 결제 대기 상태입니다. 결제 확인 후 심의가 시작됩니다."}
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
      </div>

      {canManagePromotion && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              노래방 추천 노출
            </p>
            <h2 className="mt-3 text-xl font-semibold text-foreground">
              크레딧으로 추천 노출을 활성화하세요.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              추천 인증이 완료되면 크레딧이 소진되고 추천자가 크레딧을 받습니다.
            </p>
            <div className="mt-4 grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  내 크레딧
                </p>
                <p className="mt-2 text-xl font-semibold text-foreground">
                  {creditBalance} 크레딧
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  노출 크레딧
                </p>
                <p className="mt-2 text-xl font-semibold text-foreground">
                  {promotion?.credits_balance ?? 0} 크레딧
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  최소 {promotion?.credits_required ?? 10} 크레딧 필요
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-background/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              크레딧 사용
            </p>
            <div className="mt-4 space-y-4 text-sm text-muted-foreground">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  사용 크레딧
                </label>
                <input
                  type="number"
                  min={1}
                  value={promotionCredits}
                  onChange={(event) =>
                    setPromotionCredits(Number(event.target.value))
                  }
                  className="mt-2 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  음원 링크
                </label>
                <input
                  value={referenceUrl}
                  onChange={(event) => setReferenceUrl(event.target.value)}
                  placeholder="https://"
                  className="mt-2 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  추천 참여자가 확인할 음원 링크를 입력하세요.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 rounded-full border border-border/70 px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={tjEnabled}
                    onChange={() => setTjEnabled((prev) => !prev)}
                    className="h-4 w-4 rounded border-border"
                  />
                  태진
                </label>
                <label className="flex items-center gap-2 rounded-full border border-border/70 px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={kyEnabled}
                    onChange={() => setKyEnabled((prev) => !prev)}
                    className="h-4 w-4 rounded border-border"
                  />
                  금영
                </label>
              </div>
              {promotionNotice.error && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-600">
                  {promotionNotice.error}
                </div>
              )}
              {promotionNotice.message && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-600">
                  {promotionNotice.message}
                </div>
              )}
              <button
                type="button"
                onClick={handlePromotionSubmit}
                disabled={isPromotionSubmitting}
                className="w-full rounded-full bg-foreground px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-muted"
              >
                크레딧 사용하기
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            방송국별 진행표
          </p>
          <span className="text-xs text-muted-foreground">
            업데이트: {formatDateTime(submission.updated_at)}
          </span>
        </div>
        <div className="mt-5">
          {stationReviews && stationReviews.length > 0 ? (
            <div className="rounded-2xl border border-border/60 bg-background/70">
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_1fr_0.6fr] items-center gap-3 border-b border-border/60 bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <span>방송국</span>
                    <span>접수 상태</span>
                    <span>통과 여부</span>
                    <span className="text-right">접수 날짜</span>
                    <span className="text-center">사유</span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {stationReviews.map((review) => {
                      const reception = getReviewReception(review.status);
                      const result = getReviewResult(review.status);
                      const note = review.result_note?.trim();
                      const showNote =
                        Boolean(note) && rejectedReviewStatuses.has(review.status);
                      const isApproved = review.status === "APPROVED";
                      return (
                        <div
                          key={review.id}
                          className="grid grid-cols-[1.2fr_0.9fr_0.9fr_1fr_0.6fr] items-center gap-3 px-4 py-3 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-foreground">
                              {review.station?.name ?? "-"}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {review.station?.code ?? ""}
                            </p>
                          </div>
                          <span
                            className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[10px] font-semibold ${reception.tone}`}
                          >
                            {reception.label}
                          </span>
                          {isApproved ? (
                            <button
                              type="button"
                              onClick={() => openRadioLinks(review.station?.name ?? undefined)}
                              className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[10px] font-semibold underline decoration-transparent transition hover:decoration-current ${result.tone}`}
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
                          <span className="text-right text-[11px] text-muted-foreground">
                            {formatDateTime(review.updated_at)}
                          </span>
                          {showNote ? (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveResultNote({
                                  stationName: review.station?.name ?? "-",
                                  note: note ?? "",
                                })
                              }
                              className="justify-self-center rounded-full border border-border/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition hover:text-foreground"
                            >
                              사유 보기
                            </button>
                          ) : (
                            <span className="text-center text-[10px] text-muted-foreground">
                              -
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
              아직 방송국 진행 정보가 없습니다. 접수 제출 후 자동 생성됩니다.
            </div>
          )}
        </div>
      </div>

      {activeResultNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
            <p className="text-sm font-semibold text-foreground">불통과 사유</p>
            {activeResultNote.stationName ? (
              <p className="mt-2 text-xs font-semibold text-foreground">
                {activeResultNote.stationName}
              </p>
            ) : null}
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
              {activeResultNote.note}
            </p>
            <button
              type="button"
              onClick={() => setActiveResultNote(null)}
              className="mt-6 w-full rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {radioLinksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              라디오 신청 링크
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {radioLinksModal.stationName
                ? `${radioLinksModal.stationName} 적격 · 라디오 신청곡 올리기`
                : "적격 · 라디오 신청곡 올리기"}
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">
              방송사별 라디오 신청곡/사연 접수 페이지로 이동합니다.
            </p>
            <ul className="mt-4 space-y-2">
              {radioSubmissionLinks.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-foreground"
                  >
                    <span>{link.name}</span>
                    <span className="text-xs text-muted-foreground">새 창에서 열기 ↗</span>
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={closeRadioLinks}
                className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import Image from "next/image";
import * as React from "react";
import {
  getMvRatingFileUrlAction,
  getSubmissionFileUrlAction,
} from "@/features/submissions/actions";
import {
  SubmissionFilesPanel,
  type SubmissionFile,
} from "@/features/submissions/submission-files-panel";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  summarizeTrackResults,
  type TrackReviewResult,
} from "@/lib/track-results";
import { createClient } from "@/lib/supabase/client";
import { APP_CONFIG } from "@/lib/config";

type Submission = {
  id: string;
  title: string | null;
  artist_name: string | null;
  artist_name_kr?: string | null;
  artist_name_en?: string | null;
  type: string;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  amount_krw: number | null;
  created_at: string;
  updated_at: string;
  mv_rating_file_path?: string | null;
  release_date?: string | null;
  genre?: string | null;
  distributor?: string | null;
  production_company?: string | null;
  previous_release?: string | null;
  artist_type?: string | null;
  artist_gender?: string | null;
  artist_members?: string | null;
  melon_url?: string | null;
  mv_runtime?: string | null;
  mv_format?: string | null;
  mv_director?: string | null;
  mv_lead_actor?: string | null;
  mv_storyline?: string | null;
  mv_production_company?: string | null;
  mv_agency?: string | null;
  mv_album_title?: string | null;
  mv_production_date?: string | null;
  mv_distribution_company?: string | null;
  mv_business_reg_no?: string | null;
  mv_usage?: string | null;
  mv_desired_rating?: string | null;
  mv_memo?: string | null;
  mv_song_title?: string | null;
  mv_song_title_kr?: string | null;
  mv_song_title_en?: string | null;
  mv_song_title_official?: string | null;
  mv_composer?: string | null;
  mv_lyricist?: string | null;
  mv_arranger?: string | null;
  mv_song_memo?: string | null;
  mv_lyrics?: string | null;
  applicant_name?: string | null;
  applicant_email?: string | null;
  applicant_phone?: string | null;
  package?: {
    name: string | null;
    station_count: number | null;
    price_krw: number | null;
  } | null;
  album_tracks?: Array<{
    id?: string | null;
    track_no?: number | null;
    track_title?: string | null;
    track_title_kr?: string | null;
    track_title_en?: string | null;
    composer?: string | null;
    lyricist?: string | null;
    arranger?: string | null;
    lyrics?: string | null;
    is_title?: boolean | null;
    title_role?: string | null;
    broadcast_selected?: boolean | null;
  }> | null;
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
  track_results?: TrackReviewResult[] | null;
  updated_at: string;
  station?: {
    id: string;
    name: string | null;
    code: string | null;
    logo_url?: string | null;
  } | null;
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
  enableRealtime = true,
  guestToken,
  isAdmin = false,
}: {
  submissionId: string;
  initialSubmission: Submission;
  initialFiles: SubmissionFile[];
  initialEvents: SubmissionEvent[];
  initialStationReviews: StationReview[];
  enableRealtime?: boolean;
  guestToken?: string;
  isAdmin?: boolean;
}) {
  const supabase = React.useMemo(
    () => (enableRealtime ? createClient() : null),
    [enableRealtime],
  );
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
  const [ratingFileNotice, setRatingFileNotice] = React.useState<{
    error?: string;
  }>({});
  const [isRatingDownloading, setIsRatingDownloading] =
    React.useState(false);
  const [activeResultNote, setActiveResultNote] = React.useState<{
    stationName?: string | null;
    note: string;
  } | null>(null);
  const [isResultFileDownloading, setIsResultFileDownloading] =
    React.useState(false);
  const [resultNotice, setResultNotice] = React.useState<string | null>(null);
  const [radioLinksModal, setRadioLinksModal] = React.useState<{
    stationName?: string;
  } | null>(null);
  const [trackResultModal, setTrackResultModal] = React.useState<{
    stationName?: string;
    summary: ReturnType<typeof summarizeTrackResults>;
  } | null>(null);
  const [showPaymentInfo, setShowPaymentInfo] = React.useState(false);
  const showAdminTools = isAdmin === true && !guestToken;
  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const isMvSubmission =
    submission.type === "MV_BROADCAST" || submission.type === "MV_DISTRIBUTION";
  const isResultReady =
    submission.status === "RESULT_READY" || submission.status === "COMPLETED";
  const isPaymentDone =
    submission.payment_status === "PAID" || submission.status === "COMPLETED";
  const isPaymentPending =
    submission.payment_status === "WAITING_PAYMENT" ||
    submission.payment_status === "PAYMENT_PENDING" ||
    (!isPaymentDone &&
      (submission.status === "WAITING_PAYMENT" ||
        submission.status === "PRE_REVIEW"));
  const albumTracks = React.useMemo(
    () => submission.album_tracks ?? [],
    [submission.album_tracks],
  );
  const artistTypeLabel =
    submission.artist_type === "GROUP"
      ? "그룹"
      : submission.artist_type === "SOLO"
        ? "솔로"
        : submission.artist_type ?? "-";
  const artistGenderLabel =
    submission.artist_gender === "MALE"
      ? "남"
      : submission.artist_gender === "FEMALE"
        ? "여"
        : submission.artist_gender || "-";
  const flowIndex = (() => {
    if (submission.status === "DRAFT") return 0;
    if (!isPaymentDone) return 0;
    if (submission.status === "IN_PROGRESS") return 2;
    if (submission.status === "RESULT_READY" || submission.status === "COMPLETED")
      return 3;
    return 1;
  })();

  const ratingFile =
    files.find((file) => file.kind === "MV_RATING_FILE") ?? null;
  const resultFile =
    files.find((file) => file.kind === "MV_RESULT_FILE") ?? null;
  const labelGuideFile =
    files.find((file) => file.kind === "MV_LABEL_GUIDE_FILE") ?? null;

  const stationNames = React.useMemo(() => {
    const names = stationReviews
      .map((review) => review.station?.name?.trim() || "")
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [stationReviews]);

  const mvOptions = React.useMemo(() => {
    if (!isMvSubmission) return null;
    if (submission.type === "MV_DISTRIBUTION") {
      // 온라인 유통 심의 기본 옵션은 영상물등급위원회로 표기
      return ["영상물등급위원회", ...stationNames];
    }
    return stationNames;
  }, [isMvSubmission, stationNames, submission.type]);

  const renderStationReviews =
    stationReviews.length > 0
      ? stationReviews
      : submission.type === "MV_DISTRIBUTION"
        ? [
            {
              id: `fallback-${submission.id}`,
              status: submission.status,
              result_note: null,
              track_results: null,
              updated_at: submission.updated_at,
              station: { name: "영상물등급위원회" },
            },
          ]
        : stationReviews;

  const buildTrackSummary = React.useCallback(
    (trackResults?: TrackReviewResult[] | null) => {
      const base = summarizeTrackResults(trackResults, albumTracks);
      if (!albumTracks.length) {
        return base;
      }
      const mergedResults = albumTracks.map((track, index) => {
        const matched =
          base.results.find(
            (item) =>
              (item.track_id && track.id && item.track_id === track.id) ||
              (typeof item.track_no === "number" &&
                typeof track.track_no === "number" &&
                item.track_no === track.track_no),
          ) ?? null;
        return {
          track_id: track.id ?? matched?.track_id ?? null,
          track_no: track.track_no ?? matched?.track_no ?? index + 1,
          title:
            track.track_title ||
            track.track_title_kr ||
            track.track_title_en ||
            matched?.title ||
            "트랙",
          status: (matched?.status as string) ?? "PENDING",
        };
      });
      const merged = summarizeTrackResults(mergedResults, albumTracks);
      return { ...merged, results: mergedResults };
    },
    [albumTracks],
  );

  const openRadioLinks = (stationName?: string) => {
    setRadioLinksModal({ stationName });
  };

  const closeRadioLinks = () => setRadioLinksModal(null);
  const [isTimelineOpen, setIsTimelineOpen] = React.useState(false);

  const fetchLatest = React.useCallback(async () => {
    if (!supabase) return;
    const { data: submissionData } = await supabase
      .from("submissions")
      .select(
        "id, title, artist_name, artist_name_kr, artist_name_en, type, status, payment_status, payment_method, amount_krw, mv_rating_file_path, created_at, updated_at, release_date, genre, distributor, production_company, previous_release, artist_type, artist_gender, artist_members, melon_url, mv_runtime, mv_format, mv_director, mv_lead_actor, mv_storyline, mv_production_company, mv_agency, mv_album_title, mv_production_date, mv_distribution_company, mv_business_reg_no, mv_usage, mv_desired_rating, mv_memo, mv_song_title, mv_song_title_kr, mv_song_title_en, mv_song_title_official, mv_composer, mv_lyricist, mv_arranger, mv_song_memo, mv_lyrics, applicant_name, applicant_email, applicant_phone, package:packages ( name, station_count, price_krw ), album_tracks ( id, track_no, track_title, track_title_kr, track_title_en, composer, lyricist, arranger, lyrics, is_title, title_role, broadcast_selected )",
      )
      .eq("id", submissionId)
      .maybeSingle();

    if (submissionData) {
      const nextPackage = Array.isArray(submissionData.package)
        ? submissionData.package[0]
        : submissionData.package;
      const nextTracks = Array.isArray(submissionData.album_tracks)
        ? submissionData.album_tracks
        : [];
      setSubmission({
        ...submissionData,
        package: nextPackage ?? null,
        album_tracks: nextTracks,
      });
    }

    const { data: eventsData } = await supabase
      .from("submission_events")
      .select("id, event_type, message, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false });

    if (eventsData) {
      setEvents(eventsData);
    }

    const stationSelectWithLogo =
      "id, status, result_note, track_results, updated_at, station:stations ( id, name, code, logo_url )";
    const stationSelectBasic =
      "id, status, result_note, track_results, updated_at, station:stations ( id, name, code )";

    const runStationFetch = (select: string) =>
      supabase
        .from("station_reviews")
        .select(select)
        .eq("submission_id", submissionId)
        .order("updated_at", { ascending: false });

    const stationResult = await runStationFetch(stationSelectWithLogo);
    let stationData = stationResult.data ?? null;
    let stationError = stationResult.error ?? null;

    if (
      stationError &&
      (stationError.code === "42703" ||
        stationError.message?.toLowerCase().includes("logo_url"))
    ) {
      const fallback = await runStationFetch(stationSelectBasic);
      stationData = fallback.data ?? null;
      stationError = fallback.error ?? null;
    }

    if (stationData) {
      const normalizedStations = (Array.isArray(stationData) ? stationData : []).map(
        (review) => {
          const base =
            review && typeof review === "object"
              ? (review as {
                  station?: StationReview["station"] | StationReview["station"][];
                  [key: string]: unknown;
                })
              : {};
          const station = Array.isArray(base.station) ? base.station[0] : base.station;
          return { ...base, station };
        },
      );
      setStationReviews(normalizedStations as StationReview[]);
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
    void fetchLatest();
  }, [fetchLatest]);

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

  const handleResultFileDownload = async (fileId?: string | null) => {
    if (!fileId) {
      setResultNotice("등록된 파일이 없습니다.");
      return;
    }
    setIsResultFileDownloading(true);
    setResultNotice(null);
    const result = await getSubmissionFileUrlAction({
      submissionId,
      fileId,
      guestToken: guestToken ?? undefined,
    });
    if (result.error) {
      setResultNotice(result.error);
      setIsResultFileDownloading(false);
      return;
    }
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
    setIsResultFileDownloading(false);
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
      {showAdminTools && isPaymentPending ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setShowPaymentInfo(true)}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-foreground transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5"
          >
            결제 안내 보기
          </button>
        </div>
      ) : null}
      {showPaymentInfo ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
          <button
            type="button"
            onClick={() => setShowPaymentInfo(false)}
            className="absolute inset-0 bg-black/50"
            aria-label="결제 안내 닫기"
          />
          <div className="relative z-10 w-full max-w-xl rounded-3xl border border-border/80 bg-card/95 p-6 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                  결제 안내
                </p>
                <h2 className="mt-2 text-lg font-semibold text-foreground">
                  {packageInfo?.name ?? submission.title ?? "신청 상품"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  결제 대기 상태입니다. 아래 계좌로 입금 후 알려주세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentInfo(false)}
                className="rounded-full border border-border/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-foreground hover:border-foreground hover:bg-foreground/5"
              >
                닫기
              </button>
            </div>
            <div className="mt-4 grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  결제 금액
                </span>
                <span className="text-base font-semibold text-foreground">
                  {submission.amount_krw
                    ? `${formatCurrency(submission.amount_krw)}원`
                    : packageInfo?.price_krw
                      ? `${formatCurrency(packageInfo.price_krw)}원`
                      : "-"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  결제 방식
                </span>
                <span className="text-sm text-foreground">
                  {submission.payment_method
                    ? paymentMethodLabels[submission.payment_method] ??
                      submission.payment_method
                    : "무통장"}
                </span>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-border/70 bg-background/80 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                무통장 입금 안내
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    은행
                  </p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankName}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    계좌번호
                  </p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankAccount}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    예금주
                  </p>
                  <p className="mt-1 font-semibold">{APP_CONFIG.bankHolder}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                입금 후 문의하기로 알려주시면 확인을 빠르게 도와드립니다.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      {/* 사용자 노출 방지를 위해 숨김: 신청 내역 TXT 다운로드 */}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              접수 정보
            </p>
            <div className="mt-4 grid gap-4 text-base text-foreground md:grid-cols-2">
              {isMvSubmission ? (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">신청 옵션</p>
                    <p className="mt-1 font-semibold">
                      {mvOptions && mvOptions.length > 0
                        ? mvOptions.join(", ")
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">옵션 수</p>
                    <p className="mt-1 font-semibold">
                      {mvOptions && mvOptions.length > 0
                        ? `${mvOptions.length}곳`
                        : "-"}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-sm text-muted-foreground">패키지</p>
                    <p className="mt-1 font-semibold">
                      {packageInfo?.name ?? "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">방송국 수</p>
                    <p className="mt-1 font-semibold">
                      {packageInfo?.station_count ?? "-"}곳
                    </p>
                  </div>
                </>
              )}
              <div>
                <p className="text-sm text-muted-foreground">금액</p>
                <p className="mt-1 font-semibold">
                  {submission.amount_krw
                    ? `${formatCurrency(submission.amount_krw)}원`
                    : packageInfo?.price_krw
                      ? `${formatCurrency(packageInfo.price_krw)}원`
                      : "-"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">결제 상태</p>
                <p className="mt-1 font-semibold">
                  {submission.payment_status}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">결제 방식</p>
                <p className="mt-1 font-semibold">
                  {submission.payment_method
                    ? paymentMethodLabels[submission.payment_method] ??
                      submission.payment_method
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">접수 일시</p>
                <p className="mt-1 font-semibold">
                  {formatDateTime(submission.created_at)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">최근 업데이트</p>
                <p className="mt-1 font-semibold">
                  {formatDateTime(submission.updated_at)}
                </p>
              </div>
              {isMvSubmission && (
                <div className="md:col-span-2">
                  <p className="text-sm text-muted-foreground">등급분류 파일</p>
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
        </div>
        <div className="space-y-6">
          <div className="rounded-[28px] border border-border/60 bg-background/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              심의 진행 상태
            </p>
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-4">
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
          {isMvSubmission && isResultReady ? (
            <div className="rounded-[28px] border border-border/60 bg-background/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                심의 결과 파일
              </p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-32 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    등급분류
                  </span>
                  <button
                    type="button"
                    onClick={handleRatingFileDownload}
                    disabled={isRatingDownloading && !ratingFile}
                    className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {ratingFile ? ratingFile.original_name : "등급분류 파일 다운로드"}
                  </button>
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {ratingFile
                      ? null
                      : [
                          { kind: "MV_RATING_FILE_ALL", label: "전체관람가" },
                          { kind: "MV_RATING_FILE_12", label: "12세" },
                          { kind: "MV_RATING_FILE_15", label: "15세" },
                          { kind: "MV_RATING_FILE_18", label: "18세" },
                          { kind: "MV_RATING_FILE_REJECT", label: "심의불가" },
                        ]
                          .map((entry) => {
                            const file = files.find((f) => f.kind === entry.kind);
                            if (!file) return null;
                            return (
                              <button
                                key={entry.kind}
                                type="button"
                                onClick={() => handleResultFileDownload(file.id)}
                                className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold text-foreground transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5"
                              >
                                {entry.label}
                              </button>
                            );
                          })
                          .filter(Boolean)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-32 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    심의 결과
                  </span>
                  <button
                    type="button"
                    onClick={() => handleResultFileDownload(resultFile?.id)}
                    disabled={!resultFile || isResultFileDownloading}
                    className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resultFile ? resultFile.original_name : "심의 결과 파일 미등록"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-32 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    표기 가이드
                  </span>
                  <button
                    type="button"
                    onClick={() => handleResultFileDownload(labelGuideFile?.id)}
                    disabled={!labelGuideFile || isResultFileDownloading}
                    className="rounded-full border border-border/70 bg-background px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {labelGuideFile ? labelGuideFile.original_name : "표기 가이드 미등록"}
                  </button>
                </div>
                {resultNotice ? (
                  <p className="text-xs text-red-500">{resultNotice}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

    <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        작성 신청서
      </p>
      <div className="mt-4 grid gap-4 text-base text-foreground md:grid-cols-2">
        <div>
          <p className="text-sm text-muted-foreground">
            {submission.type === "ALBUM" ? "앨범 제목" : "영상 제목"}
          </p>
          <p className="mt-1 font-semibold">{submission.title || "-"}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">아티스트명</p>
          <p className="mt-1 font-semibold">
            {submission.artist_name || "-"}
            {submission.artist_name_kr ? ` / ${submission.artist_name_kr}` : ""}
            {submission.artist_name_en ? ` / ${submission.artist_name_en}` : ""}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">신청자</p>
          <p className="mt-1 font-semibold">
            {submission.applicant_name || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">신청자 연락처</p>
          <p className="mt-1 font-semibold">
            {submission.applicant_phone || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">신청자 이메일</p>
          <p className="mt-1 font-semibold">
            {submission.applicant_email || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">유통사</p>
          <p className="mt-1 font-semibold">
            {submission.distributor || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">제작사</p>
          <p className="mt-1 font-semibold">
            {submission.production_company || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">발매일</p>
          <p className="mt-1 font-semibold">
            {submission.release_date ? formatDateTime(submission.release_date) : "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">장르</p>
          <p className="mt-1 font-semibold">
            {submission.genre || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">이전 발매</p>
          <p className="mt-1 font-semibold">
            {submission.previous_release || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">그룹/솔로</p>
          <p className="mt-1 font-semibold">{artistTypeLabel}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">성별</p>
          <p className="mt-1 font-semibold">{artistGenderLabel}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">멤버</p>
          <p className="mt-1 font-semibold">
            {submission.artist_members || "-"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">멜론 링크</p>
          <p className="mt-1 font-semibold">
            {submission.melon_url || "-"}
          </p>
        </div>
        {isMvSubmission ? (
          <>
            <div>
              <p className="text-xs text-muted-foreground">러닝타임</p>
              <p className="mt-1 font-semibold">{submission.mv_runtime || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">포맷</p>
              <p className="mt-1 font-semibold">{submission.mv_format || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">감독</p>
              <p className="mt-1 font-semibold">{submission.mv_director || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">주연</p>
              <p className="mt-1 font-semibold">{submission.mv_lead_actor || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">스토리라인</p>
              <p className="mt-1 font-semibold">{submission.mv_storyline || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">제작사</p>
              <p className="mt-1 font-semibold">{submission.mv_production_company || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">에이전시</p>
              <p className="mt-1 font-semibold">{submission.mv_agency || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">앨범 제목</p>
              <p className="mt-1 font-semibold">{submission.mv_album_title || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">제작일</p>
              <p className="mt-1 font-semibold">
                {submission.mv_production_date ? formatDateTime(submission.mv_production_date) : "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">배급사</p>
              <p className="mt-1 font-semibold">{submission.mv_distribution_company || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">사업자등록번호</p>
              <p className="mt-1 font-semibold">{submission.mv_business_reg_no || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">용도</p>
              <p className="mt-1 font-semibold">{submission.mv_usage || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">희망 등급</p>
              <p className="mt-1 font-semibold">{submission.mv_desired_rating || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">곡 제목</p>
              <p className="mt-1 font-semibold">
                {submission.mv_song_title ||
                  submission.mv_song_title_kr ||
                  submission.mv_song_title_en ||
                  "-"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">작곡/작사/편곡</p>
              <p className="mt-1 font-semibold">
                {submission.mv_composer || "-"} / {submission.mv_lyricist || "-"} /{" "}
                {submission.mv_arranger || "-"}
              </p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs text-muted-foreground">메모</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {submission.mv_memo || "-"}
              </p>
            </div>
            {submission.mv_lyrics ? (
              <div className="md:col-span-2">
                <p className="text-xs text-muted-foreground">가사</p>
                <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-border/60 bg-background/70 p-3 text-sm text-foreground">
                  {submission.mv_lyrics}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground">아티스트 유형</p>
              <p className="mt-1 font-semibold">{artistTypeLabel}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">이전 발매</p>
              <p className="mt-1 font-semibold">
                {submission.previous_release || "-"}
              </p>
            </div>
          </>
        )}
      </div>
      {!isMvSubmission && albumTracks.length > 0 ? (
        <div className="mt-5 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            트랙 리스트
          </p>
          <div className="rounded-2xl border border-border/60 bg-background/70 p-3 text-sm">
            <div className="divide-y divide-border/60">
              {albumTracks.map((track, index) => (
                <div key={`${track.track_no ?? index}-${track.track_title ?? index}`} className="py-2">
                  <p className="font-semibold text-foreground">
                    {track.track_no ?? index + 1}.{" "}
                    {track.track_title || track.track_title_kr || track.track_title_en || "제목 미입력"}
                    {track.is_title ? " · 타이틀" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    작곡 {track.composer || "-"} / 작사 {track.lyricist || "-"} / 편곡{" "}
                    {track.arranger || "-"}
                  </p>
                  {track.lyrics ? (
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">가사 보기</summary>
                      <div className="mt-1 whitespace-pre-wrap text-foreground">
                        {track.lyrics}
                      </div>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>

    <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        첨부 파일
      </p>
      <div className="mt-4">
        <SubmissionFilesPanel
          submissionId={submissionId}
          files={files}
          guestToken={guestToken}
          canDownload={false}
        />
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
        <div className="mt-5">
          {renderStationReviews && renderStationReviews.length > 0 ? (
            <div className="rounded-2xl border border-border/60 bg-background/70">
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className="grid grid-cols-[1.2fr_0.9fr_0.9fr_1fr_0.6fr] items-center gap-3 border-b border-border/60 bg-muted/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <span>방송국</span>
                    <span className="text-center">접수 상태</span>
                    <span className="text-center">통과 여부</span>
                    <span className="text-right">접수 날짜</span>
                    <span className="text-center">사유</span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {renderStationReviews.map((review) => {
                      const reception = getReviewReception(review.status);
                      const trackInfo = buildTrackSummary(review.track_results);
                      const note = review.result_note?.trim();
                      const showNote =
                        Boolean(note) && rejectedReviewStatuses.has(review.status);
                      const isApproved = review.status === "APPROVED";
                      const totalTracksForDisplay =
                        albumTracks.length > 1
                          ? albumTracks.length
                          : trackInfo.counts.total;
                      const pendingGap = Math.max(
                        totalTracksForDisplay -
                          (trackInfo.counts.approved +
                            trackInfo.counts.rejected +
                            trackInfo.counts.pending),
                        0,
                      );
                      const pendingCount = trackInfo.counts.pending + pendingGap;
                      const hasTrackDetails = totalTracksForDisplay > 1;
                      const resultTone =
                        trackInfo.outcome === "APPROVED"
                          ? reviewResultMap.APPROVED
                          : trackInfo.outcome === "REJECTED"
                            ? reviewResultMap.REJECTED
                            : trackInfo.outcome === "PARTIAL"
                              ? {
                                  label: "부분 통과",
                                  tone:
                                    "bg-amber-500/15 text-amber-700 dark:text-amber-200",
                                }
                              : getReviewResult(review.status);
                      const trackSummaryLine = hasTrackDetails
                        ? `${trackInfo.counts.approved}곡 통과 · ${trackInfo.counts.rejected}곡 불통과${
                            pendingCount > 0 ? ` · ${pendingCount}곡 대기` : ""
                          }`
                        : null;

                      const handleResultClick = () => {
                        if (hasTrackDetails) {
                          setTrackResultModal({
                            stationName: review.station?.name ?? "-",
                            summary: trackInfo,
                          });
                          return;
                        }
                        if (isApproved) {
                          openRadioLinks(review.station?.name ?? undefined);
                        }
                      };

                      return (
                        <div
                          key={review.id}
                          className="grid grid-cols-[1.2fr_0.9fr_0.9fr_1fr_0.6fr] items-center gap-3 px-4 py-3 text-xs"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-background/60">
                              {review.station && "logo_url" in review.station && review.station.logo_url ? (
                                <Image
                                  src={review.station.logo_url}
                                  alt={review.station.name ?? "station logo"}
                                  width={36}
                                  height={36}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="text-sm font-semibold text-foreground">
                                  {(review.station?.name || "S").charAt(0)}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">
                                {review.station?.name ?? "-"}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {review.station?.code ?? ""}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center justify-center justify-self-center rounded-full px-2 py-1 text-[10px] font-semibold ${reception.tone}`}
                          >
                            {reception.label}
                          </span>
                          <button
                            type="button"
                            onClick={handleResultClick}
                            className={`inline-flex min-h-[36px] min-w-[90px] flex-col items-center justify-center justify-self-center rounded-full px-2 py-1 text-[10px] font-semibold transition ${
                              resultTone.tone
                            } ${hasTrackDetails ? "hover:opacity-90" : ""}`}
                          >
                            <span>{resultTone.label}</span>
                            {trackSummaryLine ? (
                              <span className="mt-0.5 text-[9px] font-normal leading-tight text-current/80">
                                {trackSummaryLine}
                              </span>
                            ) : null}
                          </button>
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

      <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            타임라인
          </p>
          <button
            type="button"
            onClick={() => setIsTimelineOpen((prev) => !prev)}
            className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            {isTimelineOpen ? "접기" : "펼치기"}
          </button>
        </div>
        {isTimelineOpen ? (
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
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            심의 진행 중 발생한 이벤트를 확인하려면 펼치기를 눌러주세요.
          </p>
        )}
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

      {trackResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              트랙별 결과
            </p>
            <h3 className="mt-2 text-lg font-semibold text-foreground">
              {trackResultModal.stationName ?? "-"}
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
                    ? { label: "통과", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200" }
                    : track.status === "REJECTED"
                      ? { label: "불통과", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200" }
                      : { label: "대기", tone: "bg-slate-500/10 text-slate-600 dark:text-slate-300" };
                const trackLabel =
                  track.title ||
                  albumTracks.find(
                    (base) =>
                      (track.track_id && base.id === track.track_id) ||
                      (typeof track.track_no === "number" &&
                        base.track_no === track.track_no),
                  )?.track_title ||
                  "트랙";
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
            <div className="mt-5 flex items-center justify-between gap-3">
              {trackResultModal.summary.outcome === "APPROVED" ? (
                <button
                  type="button"
                  onClick={() => {
                    openRadioLinks(trackResultModal.stationName);
                    setTrackResultModal(null);
                  }}
                  className="rounded-full border border-border/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                >
                  라디오 신청 링크
                </button>
              ) : (
                <div />
              )}
              <button
                type="button"
                onClick={() => setTrackResultModal(null)}
                className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-amber-200 hover:text-slate-900"
              >
                닫기
              </button>
            </div>
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

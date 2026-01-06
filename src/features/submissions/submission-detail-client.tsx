"use client";

import * as React from "react";
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
  enableRealtime = true,
  guestToken,
}: {
  submissionId: string;
  initialSubmission: Submission;
  initialFiles: SubmissionFile[];
  initialEvents: SubmissionEvent[];
  initialStationReviews: StationReview[];
  enableRealtime?: boolean;
  guestToken?: string;
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
  const [radioLinksModal, setRadioLinksModal] = React.useState<{
    stationName?: string;
  } | null>(null);
  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const isMvSubmission =
    submission.type === "MV_BROADCAST" || submission.type === "MV_DISTRIBUTION";
  const isResultReady =
    submission.status === "RESULT_READY" || submission.status === "COMPLETED";
  const isPaymentDone = submission.payment_status === "PAID";
  const albumTracks = submission.album_tracks ?? [];
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
        "id, title, artist_name, artist_name_kr, artist_name_en, type, status, payment_status, payment_method, amount_krw, mv_rating_file_path, created_at, updated_at, release_date, genre, distributor, production_company, previous_release, artist_type, artist_gender, artist_members, melon_url, mv_runtime, mv_format, mv_director, mv_lead_actor, mv_storyline, mv_production_company, mv_agency, mv_album_title, mv_production_date, mv_distribution_company, mv_business_reg_no, mv_usage, mv_desired_rating, mv_memo, mv_song_title, mv_song_title_kr, mv_song_title_en, mv_song_title_official, mv_composer, mv_lyricist, mv_arranger, mv_song_memo, mv_lyrics, applicant_name, applicant_email, applicant_phone, package:packages ( name, station_count, price_krw ), album_tracks ( track_no, track_title, track_title_kr, track_title_en, composer, lyricist, arranger, lyrics, is_title, title_role, broadcast_selected )",
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
      "id, status, result_note, updated_at, station:stations ( id, name, code, logo_url )";
    const stationSelectBasic =
      "id, status, result_note, updated_at, station:stations ( id, name, code )";

    const runStationFetch = (select: string) =>
      supabase
        .from("station_reviews")
        .select(select)
        .eq("submission_id", submissionId)
        .order("updated_at", { ascending: false });

    let stationResult = await runStationFetch(stationSelectWithLogo);
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
        (review) => ({
          ...review,
          station: Array.isArray(review.station)
            ? review.station[0]
            : review.station,
        }),
      );
      setStationReviews(normalizedStations);
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
    lines.push(
      `결제 방식: ${
        submission.payment_method
          ? paymentMethodLabels[submission.payment_method] ?? submission.payment_method
          : "-"
      }`,
    );
    lines.push(`접수 일시: ${formatDateTime(submission.created_at)}`);
    lines.push(`최근 업데이트: ${formatDateTime(submission.updated_at)}`);
    lines.push("");
    lines.push("작성 신청서");
    lines.push("-".repeat(24));
    lines.push(
      `${submission.type === "ALBUM" ? "앨범 제목" : "영상 제목"}: ${submission.title || "-"}`,
    );
    lines.push(
      `아티스트명: ${submission.artist_name || "-"}${submission.artist_name_kr ? ` / ${submission.artist_name_kr}` : ""}${submission.artist_name_en ? ` / ${submission.artist_name_en}` : ""}`,
    );
    lines.push(`신청자: ${submission.applicant_name || "-"}`);
    lines.push(`신청자 연락처: ${submission.applicant_phone || "-"}`);
    lines.push(`신청자 이메일: ${submission.applicant_email || "-"}`);
    lines.push(`유통사: ${submission.distributor || "-"}`);
    lines.push(`제작사: ${submission.production_company || "-"}`);
    lines.push(
      `발매일: ${submission.release_date ? formatDateTime(submission.release_date) : "-"}`,
    );
    lines.push(`장르: ${submission.genre || "-"}`);
    lines.push(`이전 발매: ${submission.previous_release || "-"}`);
    lines.push(`그룹/솔로: ${artistTypeLabel}`);
    lines.push(`성별: ${artistGenderLabel}`);
    lines.push(`멤버: ${submission.artist_members || "-"}`);
    lines.push(`멜론 링크: ${submission.melon_url || "-"}`);
    if (isMvSubmission) {
      lines.push(`러닝타임: ${submission.mv_runtime || "-"}`);
      lines.push(`포맷: ${submission.mv_format || "-"}`);
      lines.push(`감독: ${submission.mv_director || "-"}`);
      lines.push(`주연: ${submission.mv_lead_actor || "-"}`);
      lines.push(`스토리라인: ${submission.mv_storyline || "-"}`);
      lines.push(`제작사: ${submission.mv_production_company || "-"}`);
      lines.push(`에이전시: ${submission.mv_agency || "-"}`);
      lines.push(`앨범 제목: ${submission.mv_album_title || "-"}`);
      lines.push(
        `제작일: ${submission.mv_production_date ? formatDateTime(submission.mv_production_date) : "-"}`,
      );
      lines.push(`배급사: ${submission.mv_distribution_company || "-"}`);
      lines.push(`사업자등록번호: ${submission.mv_business_reg_no || "-"}`);
      lines.push(`용도: ${submission.mv_usage || "-"}`);
      lines.push(`희망 등급: ${submission.mv_desired_rating || "-"}`);
      lines.push(
        `곡 제목: ${submission.mv_song_title || submission.mv_song_title_kr || submission.mv_song_title_en || "-"}`,
      );
      lines.push(
        `작곡/작사/편곡: ${submission.mv_composer || "-"} / ${submission.mv_lyricist || "-"} / ${submission.mv_arranger || "-"}`,
      );
      lines.push(`메모: ${submission.mv_memo || "-"}`);
      lines.push(`가사: ${submission.mv_lyrics || "-"}`);
    } else {
      lines.push(`아티스트 유형: ${artistTypeLabel}`);
      lines.push(`이전 발매: ${submission.previous_release || "-"}`);
    }
    if (!isMvSubmission && albumTracks.length > 0) {
      lines.push("");
      lines.push("트랙 리스트");
      lines.push("-".repeat(16));
      albumTracks.forEach((track, index) => {
        lines.push(
          `${track.track_no ?? index + 1}. ${track.track_title || track.track_title_kr || track.track_title_en || "제목 미입력"}${track.is_title ? " · 타이틀" : ""}`,
        );
        lines.push(
          `   작곡 ${track.composer || "-"} / 작사 ${track.lyricist || "-"} / 편곡 ${track.arranger || "-"}`,
        );
        if (track.lyrics) {
          lines.push(`   가사: ${track.lyrics}`);
        }
      });
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
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
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
            <div className="mt-4 grid gap-4 text-base text-foreground md:grid-cols-2">
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
              주문 진행 상태
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
                          <div className="min-w-0 flex items-center gap-2">
                            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-background/60">
                              {review.station?.logo_url ? (
                                // 로고 이미지가 있으면 표시
                                <img
                                  src={review.station.logo_url}
                                  alt={review.station.name ?? "station logo"}
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

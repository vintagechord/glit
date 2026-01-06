import Link from "next/link";
import { cookies, headers } from "next/headers";

import {
  paymentStatusLabelMap,
  paymentStatusOptions,
  resultStatusLabelMap,
  reviewStatusLabelMap,
  reviewStatusOptions,
  stationReviewStatusOptions,
  type PaymentStatus,
  type ResultStatus,
  type ReviewStatus,
} from "@/constants/review-status";
import {
  updateSubmissionBasicInfoFormAction,
  updatePaymentStatusFormAction,
  updateStationReviewFormAction,
  updateSubmissionStatusFormAction,
} from "@/features/admin/actions";
import { SubmissionFilesPanel } from "@/features/submissions/submission-files-panel";
import { formatDateTime } from "@/lib/format";
import { ensureAlbumStationReviews } from "@/lib/station-reviews";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "접수 상세 관리",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const typeLabels: Record<string, string> = {
  ALBUM: "음반 심의",
  MV_DISTRIBUTION: "M/V 심의 (유통/온라인)",
  MV_BROADCAST: "M/V 심의 (TV 송출)",
};

type SubmissionRow = {
  id: string;
  user_id?: string | null;
  title: string | null;
  artist_name: string | null;
  release_date?: string | null;
  genre?: string | null;
  distributor?: string | null;
  production_company?: string | null;
  previous_release?: string | null;
  artist_type?: string | null;
  artist_gender?: string | null;
  artist_members?: string | null;
  melon_url?: string | null;
  mv_distribution_company?: string | null;
  mv_production_company?: string | null;
  mv_runtime?: string | null;
  mv_format?: string | null;
  mv_director?: string | null;
  mv_lead_actor?: string | null;
  mv_storyline?: string | null;
  mv_agency?: string | null;
  mv_album_title?: string | null;
  mv_production_date?: string | null;
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
  album_tracks?: Array<{
    id?: string;
    track_no?: number;
    track_title?: string | null;
    track_title_kr?: string | null;
    track_title_en?: string | null;
    track_title_official?: string | null;
    featuring?: string | null;
    composer?: string | null;
    lyricist?: string | null;
    arranger?: string | null;
    lyrics?: string | null;
    notes?: string | null;
    is_title?: boolean | null;
    title_role?: string | null;
    broadcast_selected?: boolean | null;
  }> | null;
  status: ReviewStatus;
  payment_status: PaymentStatus | null;
  payment_method: string | null;
  amount_krw: number | null;
  mv_base_selected: boolean | null;
  pre_review_requested: boolean | null;
  karaoke_requested: boolean | null;
  bank_depositor_name: string | null;
  admin_memo: string | null;
  mv_rating_file_path: string | null;
  result_status?: ResultStatus | null;
  result_memo?: string | null;
  result_notified_at?: string | null;
  applicant_email?: string | null;
  applicant_name?: string | null;
  applicant_phone?: string | null;
  created_at: string;
  updated_at: string;
  type: string;
  package?:
    | Array<{ name?: string | null; station_count?: number | null }>
    | { name?: string | null; station_count?: number | null }
    | null;
  guest_name?: string | null;
  guest_company?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
};

const paymentMethodLabels: Record<string, string> = {
  BANK: "무통장",
  CARD: "카드",
};

export default async function AdminSubmissionDetailPage({
  searchParams,
  params,
}: {
  searchParams?: { id?: string | string[] };
  params?: { id?: string };
}) {
  const paramId = params?.id;
  const searchId = searchParams?.id;
  const urlId = Array.isArray(searchId)
    ? searchId.find((v) => typeof v === "string" && uuidPattern.test(v)) ?? ""
    : typeof searchId === "string"
      ? searchId
      : paramId && uuidPattern.test(paramId)
        ? paramId
        : "";

  // Fallback: grab id from referer (e.g., when query is dropped during navigation) or cookie
  const headerList = await headers();
  const referer = headerList?.get?.("referer") ?? "";
  const refererId = (() => {
    if (!referer) return "";
    try {
      const id = new URL(referer).searchParams.get("id");
      return id && uuidPattern.test(id) ? id : "";
    } catch {
      return "";
    }
  })();
  const cookieStore = await cookies();
  const cookieId =
    cookieStore && typeof cookieStore.get === "function"
      ? cookieStore.get("admin_submission_id")?.value ?? ""
      : "";
  const cookieUuid = uuidPattern.test(cookieId) ? cookieId : "";

  const rawSubmissionId = urlId || refererId || cookieUuid;

  if (!rawSubmissionId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          관리자
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">접수 상세</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          접수 ID가 전달되지 않았습니다. (비어 있음)
        </p>
        <div className="mt-3 flex gap-3">
          <Link
            href="/admin/submissions"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            목록으로 돌아가기
          </Link>
        </div>
        <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          디버그 - searchParams.id: {Array.isArray(searchId) ? searchId.join(",") : searchId ?? "없음"}
        </div>
      </div>
    );
  }
  if (!uuidPattern.test(rawSubmissionId)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          관리자
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">접수 상세</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          접수 ID가 유효한 UUID 형식이 아닙니다. (전달된 값: {rawSubmissionId})
        </p>
        <div className="mt-3 flex gap-3">
          <Link
            href="/admin/submissions"
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }
  const submissionId = rawSubmissionId;

  const renderSubmissionNotFound = (reason?: string | null) => (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
        관리자
      </p>
      <h1 className="font-display mt-2 text-2xl text-foreground">접수 상세</h1>
      <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
        해당 ID의 접수를 찾을 수 없습니다.
      </p>
      <div className="mt-3 flex gap-3">
        <Link
          href="/admin/submissions"
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          목록으로 돌아가기
        </Link>
      </div>
      <div className="mt-3 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
        요청 ID: {submissionId}
      </div>
      {reason ? (
        <div className="mt-2 rounded-2xl border border-border/60 bg-background px-4 py-3 text-xs text-muted-foreground">
          상세: {reason}
        </div>
      ) : null}
    </div>
  );

  const supabase = createAdminClient();
  const baseSelectCore =
    "id, user_id, title, artist_name, artist_name_kr, artist_name_en, status, payment_status, payment_method, amount_krw, mv_base_selected, pre_review_requested, karaoke_requested, bank_depositor_name, admin_memo, mv_rating_file_path, result_status, result_memo, result_notified_at, applicant_email, applicant_name, applicant_phone, created_at, updated_at, type, package:packages ( name, station_count )";
  const albumExtra =
    "release_date, genre, distributor, production_company, previous_release, artist_type, artist_gender, artist_members, is_oneclick, melon_url";
  const mvExtra =
    "mv_runtime, mv_format, mv_director, mv_lead_actor, mv_storyline, mv_production_company, mv_agency, mv_album_title, mv_production_date, mv_distribution_company, mv_business_reg_no, mv_usage, mv_desired_rating, mv_memo, mv_song_title, mv_song_title_kr, mv_song_title_en, mv_song_title_official, mv_composer, mv_lyricist, mv_arranger, mv_song_memo, mv_lyrics";
  const trackRelation =
    "album_tracks ( track_no, track_title, track_title_kr, track_title_en, track_title_official, featuring, composer, lyricist, arranger, lyrics, notes, is_title, title_role, broadcast_selected )";

  const baseSelectWithResult = `${baseSelectCore}, ${albumExtra}, ${mvExtra}, ${trackRelation}`;
  const baseSelectWithoutResult = `${baseSelectCore.replace(
    ", result_status, result_memo, result_notified_at",
    "",
  )}, ${albumExtra}, ${mvExtra}, ${trackRelation}`;
  const guestSelectWithResult = `${baseSelectWithResult}, guest_name, guest_company, guest_email, guest_phone`;
  const guestSelectWithoutResult = `${baseSelectWithoutResult}, guest_name, guest_company, guest_email, guest_phone`;

  let hasGuestColumns = true;
  let hasResultColumns = true;
  let submission: SubmissionRow | null = null;
  let submissionError: { message?: string; code?: string } | null = null;

  const isColumnMissing = (
    error: { message?: string; code?: string } | null,
    column: string,
  ) =>
    error?.code === "42703" ||
    error?.message?.toLowerCase().includes(column.toLowerCase());

  const isNotFoundError = (error: { message?: string; code?: string } | null) =>
    error?.code === "PGRST116" ||
    error?.message?.toLowerCase().includes("row not found") ||
    error?.message?.toLowerCase().includes("results contain 0 rows");

  const runFetch = async (select: string) =>
    supabase.from("submissions").select(select).eq("id", submissionId).single();

  let result = await runFetch(guestSelectWithResult);
  submission = (result.data ?? null) as SubmissionRow | null;
  submissionError = result.error ?? null;

  if (isNotFoundError(submissionError)) {
    return renderSubmissionNotFound(submissionError?.message);
  }

  if (isColumnMissing(submissionError, "guest_name")) {
    hasGuestColumns = false;
    result = await runFetch(
      hasResultColumns ? baseSelectWithResult : baseSelectWithoutResult,
    );
    submission = (result.data ?? null) as SubmissionRow | null;
    submissionError = result.error ?? null;
  }

  if (isNotFoundError(submissionError)) {
    return renderSubmissionNotFound(submissionError?.message);
  }

  if (isColumnMissing(submissionError, "result_status")) {
    hasResultColumns = false;
    result = await runFetch(
      hasGuestColumns ? guestSelectWithoutResult : baseSelectWithoutResult,
    );
    submission = (result.data ?? null) as SubmissionRow | null;
    submissionError = result.error ?? null;
  }

  if (isNotFoundError(submissionError)) {
    return renderSubmissionNotFound(submissionError?.message);
  }

  if (isColumnMissing(submissionError, "applicant_email")) {
    const select = hasResultColumns
      ? baseSelectWithResult.replace(", applicant_email", "")
      : baseSelectWithoutResult.replace(", applicant_email", "");
    const guestSelect = hasGuestColumns
      ? `${select}, guest_name, guest_company, guest_email, guest_phone`
      : select;
    result = await runFetch(guestSelect);
    submission = (result.data ?? null) as SubmissionRow | null;
    submissionError = result.error ?? null;
  }

  if (isNotFoundError(submissionError) || !submission) {
    return renderSubmissionNotFound(submissionError?.message);
  }

  if (submissionError) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          관리자
        </p>
        <h1 className="font-display mt-2 text-2xl text-foreground">접수 상세</h1>
        <p className="mt-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          접수 정보를 불러오지 못했습니다. ({submissionError.message ?? "알 수 없는 오류"})
        </p>
      </div>
    );
  }

  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const isMvSubmission =
    submission.type === "MV_BROADCAST" || submission.type === "MV_DISTRIBUTION";
  const statusLabel = reviewStatusLabelMap[submission.status] ?? submission.status;
  const paymentLabel =
    submission.payment_status && paymentStatusLabelMap[submission.payment_status]
      ? paymentStatusLabelMap[submission.payment_status]
      : submission.payment_status ?? "미결제";
  const resultStatusLabel =
    submission.result_status && resultStatusLabelMap[submission.result_status]
      ? resultStatusLabelMap[submission.result_status]
      : submission.result_status ?? "미입력";

  const memberProfile =
    submission.user_id && !submission.guest_name
      ? (
          await supabase
            .from("profiles")
            .select("name, company, phone, email")
            .eq("user_id", submission.user_id)
            .maybeSingle()
        ).data ?? null
      : null;

  let memberEmail: string | null = memberProfile?.email ?? null;
  if (!memberEmail && submission.user_id && !submission.guest_name) {
    const { data: userData } = await supabase.auth.admin.getUserById(
      submission.user_id,
    );
    memberEmail = userData?.user?.email ?? null;
  }

  const applicantEmail = submission.applicant_email ?? submission.guest_email ?? null;

  if (submission.type === "ALBUM") {
    await ensureAlbumStationReviews(
      supabase,
      submission.id,
      packageInfo?.station_count ?? null,
      packageInfo?.name ?? null,
    );
  }

  const { data: stationReviews } = await supabase
    .from("station_reviews")
    .select(
      "id, status, result_note, updated_at, station_id, station:stations ( id, name, code )",
    )
    .eq("submission_id", submissionId)
    .order("station_id", { ascending: true });

  const { data: events } = await supabase
    .from("submission_events")
    .select("id, event_type, message, created_at")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false });

  const { data: submissionFiles } = await supabase
    .from("submission_files")
    .select("id, kind, file_path, original_name, mime, size, created_at")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 text-[15px] leading-relaxed sm:text-base [&_input]:text-base [&_textarea]:text-base [&_select]:text-base [&_label]:text-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            관리자
          </p>
          <h1 className="font-display mt-2 text-3xl text-foreground">
            {submission.title || "제목 미입력"}
          </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {submission.artist_name || "아티스트 미입력"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="rounded-full border border-border/60 bg-background px-3 py-1 uppercase tracking-[0.2em] text-foreground">
                {statusLabel}
              </span>
              <span className="rounded-full border border-border/60 bg-background px-3 py-1 uppercase tracking-[0.2em] text-foreground">
                결제: {paymentLabel}
              </span>
              <span className="rounded-full border border-border/60 bg-background px-3 py-1 uppercase tracking-[0.2em] text-foreground">
                결과: {resultStatusLabel}
              </span>
              <span className="rounded-full border border-border/60 bg-background px-3 py-1 uppercase tracking-[0.2em] text-muted-foreground">
                ID: {submission.id.slice(0, 8)}
              </span>
            </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Updated {formatDateTime(submission.updated_at ?? submission.created_at)}
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
                  {typeLabels[submission.type] ?? submission.type}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">패키지</p>
                <p className="mt-1 font-semibold text-foreground">
                  {packageInfo?.name ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">금액</p>
                <p className="mt-1 font-semibold text-foreground">
                  {submission.amount_krw
                    ? `${submission.amount_krw.toLocaleString()}원`
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">결제 방식</p>
                <p className="mt-1 font-semibold text-foreground">
                  {submission.payment_method
                    ? paymentMethodLabels[submission.payment_method] ??
                      submission.payment_method
                    : "-"}
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
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              아티스트/앨범 정보
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              원클릭 접수 등에서 누락된 정보를 관리자가 직접 입력합니다.
            </p>
            <form
              action={updateSubmissionBasicInfoFormAction}
              className="mt-4 grid gap-4 md:grid-cols-2"
            >
              <input type="hidden" name="submissionId" value={submission.id} />
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  아티스트명
                </label>
                <input
                  name="artistName"
                  defaultValue={submission.artist_name ?? ""}
                  placeholder="아티스트명을 입력해주세요."
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  앨범 제목
                </label>
                <input
                  name="title"
                  defaultValue={submission.title ?? ""}
                  placeholder="앨범 제목을 입력해주세요."
                  className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
                />
              </div>
              <div className="md:col-span-2 flex justify-end">
                <button
                  type="submit"
                  className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900"
                >
                  저장
                </button>
              </div>
            </form>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                결제 상태
              </p>
              <form action={updatePaymentStatusFormAction} className="mt-4 space-y-4">
                <input type="hidden" name="submissionId" value={submission.id} />
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      결제 방식
                    </label>
                    <input
                      value={
                        submission.payment_method
                          ? paymentMethodLabels[submission.payment_method] ??
                            submission.payment_method
                          : "-"
                      }
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
                      defaultValue={submission.payment_status ?? "UNPAID"}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                    >
                      {paymentStatusOptions.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      입금자명
                    </label>
                    <input
                      value={
                        submission.payment_method === "BANK"
                          ? submission.bank_depositor_name ?? ""
                          : "카드 결제"
                      }
                      readOnly
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                    />
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
                  {reviewStatusOptions.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
                {isMvSubmission && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      등급분류 파일 경로
                    </label>
                    <input
                      name="mvRatingFilePath"
                      defaultValue={submission.mv_rating_file_path ?? ""}
                      placeholder="submissions/ratings/..."
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      스토리지 submissions 버킷에 업로드한 파일 경로를 입력하세요.
                    </p>
                  </div>
                )}
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

        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-border/60 bg-background/80 p-5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              상태 요약
            </p>
            <div className="mt-3 space-y-2 text-[13px] text-foreground">
              <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <span className="text-muted-foreground">심의 상태</span>
                <span className="font-semibold">{statusLabel}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <span className="text-muted-foreground">결제 상태</span>
                <span className="font-semibold">{paymentLabel}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <span className="text-muted-foreground">결과</span>
                <span className="font-semibold">{resultStatusLabel}</span>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-background/80 p-5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              신청자 정보
            </p>
            {hasGuestColumns && submission.guest_name ? (
              <div className="mt-3 space-y-1 text-sm text-foreground">
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>구분</span>
                  <span className="text-foreground">비회원</span>
                </p>
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>담당자</span>
                  <span className="text-foreground">{submission.guest_name}</span>
                </p>
                {submission.guest_company && (
                  <p className="flex justify-between text-[13px] text-muted-foreground">
                    <span>회사</span>
                    <span className="text-foreground">{submission.guest_company}</span>
                  </p>
                )}
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>연락처</span>
                  <span className="text-foreground">{submission.guest_phone ?? "-"}</span>
                </p>
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>이메일</span>
                  <span className="text-foreground">
                    {submission.guest_email ?? submission.applicant_email ?? "-"}
                  </span>
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-1 text-sm text-foreground">
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>구분</span>
                  <span className="text-foreground">회원</span>
                </p>
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>이름</span>
                  <span className="text-foreground">{memberProfile?.name ?? "회원 정보 미입력"}</span>
                </p>
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>회사</span>
                  <span className="text-foreground">{memberProfile?.company ?? "-"}</span>
                </p>
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>연락처</span>
                  <span className="text-foreground">{memberProfile?.phone ?? "-"}</span>
                </p>
                <p className="flex justify-between text-[13px] text-muted-foreground">
                  <span>로그인 이메일</span>
                  <span className="text-foreground">{memberEmail ?? applicantEmail ?? "-"}</span>
                </p>
                {applicantEmail && (
                  <p className="flex justify-between text-[12px] text-muted-foreground">
                    <span>신청서 이메일</span>
                    <span className="text-foreground">{applicantEmail}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-border/60 bg-background/80 p-5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              파일
            </p>
            <div className="mt-3">
              <SubmissionFilesPanel
                submissionId={submission.id}
                files={submissionFiles ?? []}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-[28px] border border-border/60 bg-card/80 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          방송국별 진행 관리
        </p>
        <div className="mt-4 space-y-4">
          {stationReviews && stationReviews.length > 0 ? (
            stationReviews.map((review) => {
              const stationInfo = Array.isArray(review.station)
                ? review.station[0]
                : review.station;
              return (
                <form
                  key={review.id}
                  action={updateStationReviewFormAction}
                  className="grid gap-4 rounded-2xl border border-border/60 bg-background/80 p-4 md:grid-cols-[1.2fr_1fr_1.2fr_auto]"
                >
                  <input type="hidden" name="reviewId" value={review.id} />
                  <input type="hidden" name="submissionId" value={submission.id} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {stationInfo?.name ?? "-"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {stationInfo?.code ?? ""}
                    </p>
                  </div>
                  <select
                    name="status"
                    defaultValue={review.status}
                    className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-xs"
                  >
                    {stationReviewStatusOptions.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
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
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
              방송국 진행 정보가 없습니다.
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              신청 상세
            </p>
            <Link
              href={`/api/admin/submissions/${submission.id}/export`}
              className="rounded-full border border-border/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              전체 내역 다운로드
            </Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <DetailRow label="발매일" value={submission.release_date || "-"} />
            <DetailRow label="장르" value={submission.genre || "-"} />
            <DetailRow
              label="유통사"
              value={submission.distributor || submission.mv_distribution_company || "-"}
            />
            <DetailRow
              label="제작사"
              value={submission.production_company || submission.mv_production_company || "-"}
            />
            <DetailRow
              label="신청자"
              value={submission.applicant_name || memberProfile?.name || "-"}
            />
            <DetailRow
              label="신청자 연락처"
              value={submission.applicant_phone || memberProfile?.phone || "-"}
            />
            <DetailRow
              label="신청자 이메일"
              value={submission.applicant_email || memberEmail || "-"}
            />
            {isMvSubmission ? (
              <>
                <DetailRow label="러닝타임" value={submission.mv_runtime || "-"} />
                <DetailRow label="포맷" value={submission.mv_format || "-"} />
                <DetailRow label="감독" value={submission.mv_director || "-"} />
                <DetailRow label="주연" value={submission.mv_lead_actor || "-"} />
                <DetailRow label="제작사" value={submission.mv_production_company || "-"} />
                <DetailRow label="배급사" value={submission.mv_distribution_company || "-"} />
                <DetailRow label="용도" value={submission.mv_usage || "-"} />
                <DetailRow label="희망등급" value={submission.mv_desired_rating || "-"} />
                <DetailRow label="곡 제목" value={submission.mv_song_title || "-"} />
                <DetailRow label="작곡" value={submission.mv_composer || "-"} />
                <DetailRow label="작사" value={submission.mv_lyricist || "-"} />
                <DetailRow label="편곡" value={submission.mv_arranger || "-"} />
              </>
            ) : (
              <>
                <DetailRow
                  label="아티스트 유형"
                  value={submission.artist_type || "-"}
                />
                <DetailRow
                  label="구성/멤버"
                  value={submission.artist_members || "-"}
                />
                <DetailRow
                  label="이전 발매"
                  value={submission.previous_release || "-"}
                />
                <DetailRow label="멜론 링크" value={submission.melon_url || "-"} />
              </>
            )}
          </div>
          {!isMvSubmission && submission.album_tracks && submission.album_tracks.length > 0 ? (
            <div className="mt-6 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                트랙 리스트
              </p>
              <div className="rounded-2xl border border-border/60 bg-background/70 p-3 text-sm max-h-[600px] overflow-auto space-y-2">
                {submission.album_tracks.map((track) => (
                  <div
                    key={`${track.track_no}-${track.track_title}-${track.track_title_kr}`}
                    className="border-b border-border/40 py-2 last:border-b-0"
                  >
                    <p className="font-semibold text-foreground">
                      {track.track_no}. {track.track_title || track.track_title_kr || "-"}
                      {track.is_title ? " · 타이틀" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      작곡 {track.composer || "-"} / 작사 {track.lyricist || "-"} / 편곡{" "}
                      {track.arranger || "-"}
                    </p>
                    {track.lyrics ? (
                      <details className="mt-1 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">가사</summary>
                        <pre className="mt-2 whitespace-pre-wrap text-foreground">
{track.lyrics}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {isMvSubmission && submission.mv_lyrics ? (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                가사
              </p>
              <div className="mt-2 rounded-2xl border border-border/60 bg-background/70 p-3 text-sm text-foreground whitespace-pre-wrap">
                {submission.mv_lyrics}
              </div>
            </div>
          ) : null}
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
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-foreground">{value ?? "-"}</p>
    </div>
  );
}

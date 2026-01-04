import Link from "next/link";

import {
  paymentStatusLabelMap,
  paymentStatusOptions,
  resultStatusLabelMap,
  resultStatusOptions,
  reviewStatusLabelMap,
  reviewStatusOptions,
  stationReviewStatusOptions,
} from "@/constants/review-status";
import {
  updateSubmissionBasicInfoFormAction,
  updatePaymentStatusFormAction,
  updateStationReviewFormAction,
  updateSubmissionStatusFormAction,
  updateSubmissionResultFormAction,
  notifySubmissionResultAction,
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
  title: string | null;
  artist_name: string | null;
  status: string;
  payment_status: string | null;
  payment_method: string | null;
  amount_krw: number | null;
  mv_base_selected: boolean | null;
  pre_review_requested: boolean | null;
  karaoke_requested: boolean | null;
  bank_depositor_name: string | null;
  admin_memo: string | null;
  mv_rating_file_path: string | null;
  result_status?: string | null;
  result_memo?: string | null;
  result_notified_at?: string | null;
  applicant_email?: string | null;
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
}: {
  searchParams?: { id?: string | string[] };
}) {
  const searchId = searchParams?.id;
  const rawSubmissionId = Array.isArray(searchId)
    ? searchId.find((v) => typeof v === "string" && uuidPattern.test(v)) ?? ""
    : typeof searchId === "string"
      ? searchId
      : "";

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
  const baseSelectWithResult =
    "id, title, artist_name, status, payment_status, payment_method, amount_krw, mv_base_selected, pre_review_requested, karaoke_requested, bank_depositor_name, admin_memo, mv_rating_file_path, result_status, result_memo, result_notified_at, applicant_email, created_at, updated_at, type, package:packages ( name, station_count )";
  const baseSelectWithoutResult =
    "id, title, artist_name, status, payment_status, payment_method, amount_krw, mv_base_selected, pre_review_requested, karaoke_requested, bank_depositor_name, admin_memo, mv_rating_file_path, created_at, updated_at, type, package:packages ( name, station_count )";
  const guestSelectWithResult = `${baseSelectWithResult}, guest_name, guest_company, guest_email, guest_phone`;
  const guestSelectWithoutResult = `${baseSelectWithoutResult}, guest_name, guest_company, guest_email, guest_phone`;

  let hasGuestColumns = true;
  let hasResultColumns = true;
  let hasApplicantColumns = true;
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
    hasApplicantColumns = false;
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
    submission.result_status &&
    resultStatusLabelMap[
      submission.result_status as keyof typeof resultStatusLabelMap
    ]
      ? resultStatusLabelMap[
          submission.result_status as keyof typeof resultStatusLabelMap
        ]
      : submission.result_status ?? "미입력";

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
      "id, status, result_note, updated_at, station:stations ( id, name, code )",
    )
    .eq("submission_id", submissionId)
    .order("updated_at", { ascending: false });

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
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
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
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              신청자 정보
            </p>
            {hasGuestColumns && submission.guest_name ? (
              <div className="mt-4 space-y-2 text-sm text-foreground">
                <p>
                  <span className="text-xs text-muted-foreground">구분</span>{" "}
                  비회원
                </p>
                <p>
                  <span className="text-xs text-muted-foreground">담당자</span>{" "}
                  {submission.guest_name}
                </p>
                {submission.guest_company && (
                  <p>
                    <span className="text-xs text-muted-foreground">
                      회사
                    </span>{" "}
                    {submission.guest_company}
                  </p>
                )}
                <p>
                  <span className="text-xs text-muted-foreground">연락처</span>{" "}
                  {submission.guest_phone ?? "-"}
                </p>
                <p>
                  <span className="text-xs text-muted-foreground">이메일</span>{" "}
                  {submission.guest_email ?? "-"}
                </p>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
                회원 접수입니다. 마이페이지 프로필 정보를 참고해주세요.
              </div>
            )}
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

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              첨부 파일
            </p>
            <div className="mt-4">
              <SubmissionFilesPanel
                submissionId={submission.id}
                files={submissionFiles ?? []}
              />
            </div>
          </div>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              결과 정보
            </p>
            <div className="mt-4 space-y-4">
              <form action={updateSubmissionResultFormAction} className="space-y-4">
                <input type="hidden" name="submissionId" value={submission.id} />
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      결과 상태
                    </label>
                    <select
                      name="resultStatus"
                      defaultValue={submission.result_status ?? ""}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                    >
                      <option value="">선택</option>
                      {resultStatusOptions.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      통보 시각
                    </label>
                    <input
                      value={
                        submission.result_notified_at
                          ? formatDateTime(submission.result_notified_at)
                          : "미통보"
                      }
                      readOnly
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    결과 메모
                  </label>
                  <textarea
                    name="resultMemo"
                    defaultValue={submission.result_memo ?? ""}
                    className="h-28 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                    placeholder="불통과/수정 요청 시 사유를 적어주세요."
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                  >
                    결과 저장
                  </button>
                </div>
              </form>
              <form
                action={async () => {
                  "use server";
                  await notifySubmissionResultAction(submission.id);
                }}
              >
                <button
                  type="submit"
                  className="rounded-full border border-border/70 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
                >
                  결과 통보 (메일)
                </button>
              </form>
            </div>
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
    </div>
  );
}

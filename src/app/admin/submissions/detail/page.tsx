import * as React from "react";
import Link from "next/link";
import { cookies, headers } from "next/headers";

import {
  normalizeStationReviewStatus,
  paymentStatusLabelMap,
  resultStatusLabelMap,
  stationReviewStatusOptions,
  type PaymentStatus,
  type ReviewStatus,
} from "@/constants/review-status";
import {
  createTrackForSubmissionAction,
  deleteTrackForSubmissionAction,
  saveSubmissionAdminFormAction,
} from "@/features/admin/actions";
import { SubmissionFilesPanel } from "@/features/submissions/submission-files-panel";
import { SubmissionSupplements } from "@/features/submissions/submission-supplements";
import { brandStatusTones } from "@/lib/brand-status-tones";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { getPackageStationCodes } from "@/lib/station-reviews";
import { getStationReviewDisplayStatus } from "@/lib/station-review-display";
import { getStationReviewTracks, isWbsReview, resolveStationTrackResults, summarizeTrackResults } from "@/lib/track-results";
import { isRatingCode, RATING_LABELS, type RatingCode } from "@/lib/mv-assets";
import { requireAdminPage } from "@/lib/admin/page-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUBMISSION_ADMIN_DETAIL_SELECT } from "@/lib/submissions/select-columns";
import { loadSubmissionAdminMemo } from "@/lib/admin/submission-admin-memo";
import { formatDepositDue, isDepositOverdue } from "@/lib/bank-transfer-details";
import { AdminSaveToast } from "@/components/admin/save-toast";
import { ReviewEmailControl } from "@/components/admin/review-email-control";
import { loadSubmissionCustomerEmails } from "@/lib/admin/submission-emails";
import { memberSignInFromAuthUser } from "@/lib/admin/member-sign-in";
import { SignInMethodBadges } from "@/components/admin/sign-in-method-badges";
import { MvRatingControl } from "@/components/admin/mv-rating-control";
import { AdminDeleteButton } from "@/components/admin/delete-button";
import { AdminRefundPanel } from "@/components/admin/refund-panel";
import { CertificateUploader } from "@/components/admin/certificate-uploader";
import { ConfirmForm } from "@/components/admin/confirm-form";
import { StationReviewForm } from "@/components/admin/station-review-form";
import { StationReviewBulkForm } from "@/components/admin/station-review-bulk-form";
import { hydrateReleasedAlbumInfoFormAction, saveWbsTrackSelectionFormAction, updateStationReviewFormAction, updateSubmissionAlbumInfoFormAction, updateSubmissionNotificationEmailFormAction } from "@/features/admin/actions";
import { WbsTrackSelectionForm } from "@/components/admin/wbs-track-selection-form";
import { describeSubmissionRecipient, recipientSourceLabels, type SubmissionRecipientState } from "@/lib/admin/notification-recipient-edit";
import { adminSubmissionStageOf, adminSubmissionStages } from "@/lib/admin/submission-stages";
import { loadSubmissionUploadRecord } from "@/lib/admin/submission-upload-record";
import { loadCustomerViewRecords, viewedAfterNotice } from "@/lib/admin/customer-view-record";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";
import { ReviewDocsSingleDownloadButton } from "@/components/admin/review-docs-download";
import { safeAdminSubmissionsReturnTo } from "@/lib/admin/submission-navigation";
import { parseReleasedAlbumUrl } from "@/lib/released-album-url";
import { buildUrl, getBaseUrl } from "@/lib/url";

export const metadata = {
  title: "접수 상세 관리",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
const uuidPattern =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const typeLabels: Record<string, string> = {
  ALBUM: "음반 심의",
  MV_DISTRIBUTION: "뮤직비디오 심의 (유통/온라인)",
  MV_BROADCAST: "뮤직비디오 심의 (TV 송출)",
};

type SubmissionRow = {
  id: string;
  user_id?: string | null;
  title: string | null;
  artist_name: string | null;
  ai_used?: boolean | null;
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
  is_oneclick?: boolean | null;
  mv_desired_rating?: string | null;
  mv_selected_station_codes?: string[] | null;
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
  certificate_mime?: string | null;
  certificate_size?: number | null;
  certificate_uploaded_at?: string | null;
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
    performer?: string | null;
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
  result_status?: string | null;
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

type PaymentDocumentRow = {
  payment_document_type?: string | null;
  cash_receipt_purpose?: string | null;
  cash_receipt_phone?: string | null;
  cash_receipt_business_number?: string | null;
  tax_invoice_business_number?: string | null;
};

type AdminSubmissionDetailSearchParams = {
  id?: string | string[];
  saved?: string | string[];
  savedError?: string | string[];
  savedWarning?: string | string[];
  returnTo?: string | string[];
};

type AdminSubmissionDetailParams = {
  id?: string;
};

const paymentMethodLabels: Record<string, string> = {
  BANK: "무통장",
  CARD: "카드",
};

const aiUsageLabel = (value?: boolean | null) => {
  if (value === true) return "AI 활용함";
  if (value === false) return "AI 사용 안 함";
  return "미입력";
};

const mvRatingLabel = (code?: string | null) => {
  if (!code) return "등급 미설정";
  return RATING_LABELS[code as RatingCode] ?? code;
};

const paymentDocumentLabels: Record<string, string> = {
  CASH_RECEIPT: "현금 영수증 발급",
  TAX_INVOICE: "세금계산서 발급",
};

const cashReceiptPurposeLabels: Record<string, string> = {
  PERSONAL_INCOME_DEDUCTION: "개인소득공제용",
  BUSINESS_EXPENSE_PROOF: "사업자지출증빙용",
};

const operationalStageOptions = [
  { value: "APPLICATION_RECEIVED", label: "신청접수" },
  { value: "PAYMENT_COMPLETE", label: "결제완료" },
  { value: "REVIEW_IN_PROGRESS", label: "심의진행" },
  { value: "RESULT_NOTIFIED", label: "결과 준비" },
] as const;

export default async function AdminSubmissionDetailPage({
  searchParams,
  params,
}: {
  searchParams?:
    | Promise<AdminSubmissionDetailSearchParams>
    | AdminSubmissionDetailSearchParams;
  params?: Promise<AdminSubmissionDetailParams> | AdminSubmissionDetailParams;
}) {
  await requireAdminPage();
  const resolvedParams = await Promise.resolve(params ?? {});
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const paramId = resolvedParams.id;
  const searchId = resolvedSearchParams.id;
  const savedFlag = Array.isArray(resolvedSearchParams.saved)
    ? resolvedSearchParams.saved[0]
    : resolvedSearchParams.saved;
  const savedErrorParam = Array.isArray(resolvedSearchParams.savedError)
    ? resolvedSearchParams.savedError[0]
    : resolvedSearchParams.savedError;
  const savedWarningParam = Array.isArray(resolvedSearchParams.savedWarning)
    ? resolvedSearchParams.savedWarning[0]
    : resolvedSearchParams.savedWarning;
  const returnToParam = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo;
  const initialAdminSubmissionListHref = safeAdminSubmissionsReturnTo(returnToParam);
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
  const saveMessage = (() => {
    if (!savedFlag) return "";
    switch (savedFlag) {
      case "track":
        return "트랙이 추가되었습니다.";
      case "track_unchanged":
        return "이미 삭제된 트랙입니다. 변경된 내용이 없습니다.";
      case "track_deleted":
        return "트랙을 삭제했습니다.";
      case "station":
      case "station_warning":
        return "저장되었습니다.";
      case "station_error":
        return "방송국 상태 저장 중 오류가 발생했습니다.";
      case "status":
      case "status_warning":
        return "접수/결제 상태가 저장되었습니다.";
      case "result":
      case "result_warning":
        return "심의 결과가 저장되었습니다.";
      case "notification":
      case "notification_warning":
        return "안내 이메일 재발송을 요청했습니다.";
      case "notification_error":
        return "안내 이메일 재발송을 요청하지 못했습니다.";
      case "email_retry":
        return "메일 재발송을 대기열에 등록했습니다. 자동 처리 후 이메일 발송 내역에서 상태를 확인해주세요.";
      case "album_info":
        return "신청서 항목이 저장되었습니다.";
      case "album_info_unchanged":
        return "변경된 신청서 항목이 없습니다.";
      case "album_info_hydrated":
        return "멜론·지니 앨범 정보를 신청서에 반영했습니다.";
      case "album_info_not_released":
        return "발매 음반(URL) 접수가 아니어서 앨범 정보를 불러오지 않았습니다.";
      case "recipient_email":
        return "결과 안내 수신 이메일을 저장했습니다. 결과 이메일 발송에서 미리보기 후 보내주세요.";
      case "recipient_email_unchanged":
        return "이미 같은 수신 이메일이 저장되어 있습니다.";
      case "wbs_tracks":
        return "원음방송 심의곡을 저장했습니다. 원음방송에는 선택한 곡만 표시됩니다.";
      case "wbs_tracks_unchanged":
        return "원음방송 심의곡이 이미 같게 지정되어 있습니다.";
      case "error":
        return "저장 중 오류가 발생했습니다. 다시 시도해주세요.";
      default:
        return "저장이 완료되었습니다.";
    }
  })();
  const isSaveError =
    savedFlag === "error" || savedFlag === "station_error" || savedFlag === "notification_error" || Boolean(savedErrorParam);
  const isSaveWarning =
    savedFlag === "station_warning" ||
    savedFlag === "status_warning" ||
    savedFlag === "result_warning" ||
    savedFlag === "notification_warning" ||
    Boolean(savedWarningParam);
  const errorMessage =
    typeof savedErrorParam === "string" && savedErrorParam.length > 0
      ? `저장 실패: ${savedErrorParam} (상세 로그는 서버 콘솔)`
      : isSaveError
        ? "저장 중 문제가 발생했습니다."
        : "";
  const warningMessage =
    typeof savedWarningParam === "string" && savedWarningParam.length > 0
      ? savedWarningParam
      : isSaveWarning
        ? "일부 후속 처리가 완료되지 않았습니다."
        : "";

  if (!rawSubmissionId) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="font-display text-2xl text-foreground">접수 상세</h1>
        <p className={`mt-4 rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${brandStatusTones.danger}`}>
          접수 ID가 없습니다.
        </p>
        <div className="mt-3 flex gap-3">
          <Link
            href={initialAdminSubmissionListHref}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            목록으로 돌아가기
          </Link>
        </div>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">
            요청 정보
          </summary>
          <p className="mt-2 break-words rounded-2xl border border-border/60 bg-background px-4 py-3">
            검색 ID: {Array.isArray(searchId) ? searchId.join(",") : searchId ?? "없음"}
          </p>
        </details>
      </div>
    );
  }
  if (!uuidPattern.test(rawSubmissionId)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="font-display text-2xl text-foreground">접수 상세</h1>
        <p className={`mt-4 rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${brandStatusTones.danger}`}>
          접수 ID 형식이 올바르지 않습니다.
        </p>
        <div className="mt-3 flex gap-3">
          <Link
            href={initialAdminSubmissionListHref}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            목록으로 돌아가기
          </Link>
        </div>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">
            요청 정보
          </summary>
          <p className="mt-2 break-all rounded-2xl border border-border/60 bg-background px-4 py-3">
            {rawSubmissionId}
          </p>
        </details>
      </div>
    );
  }
  const submissionId = rawSubmissionId;

  const renderSubmissionNotFound = (reason?: string | null) => (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl text-foreground">접수 상세</h1>
      <p className={`mt-4 rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${brandStatusTones.danger}`}>
        해당 ID의 접수를 찾을 수 없습니다.
      </p>
      <div className="mt-3 flex gap-3">
        <Link
          href={initialAdminSubmissionListHref}
          className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          목록으로 돌아가기
        </Link>
      </div>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-semibold text-foreground">
          요청 정보
        </summary>
        <div className="mt-2 space-y-1 rounded-2xl border border-border/60 bg-background px-4 py-3">
          <p className="break-all">ID: {submissionId}</p>
          {reason ? <p className="break-words">{reason}</p> : null}
        </div>
      </details>
    </div>
  );

  const supabase = createAdminClient();
  const extractMissingColumn = (error: { message?: string; code?: string } | null) => {
    const msg = error?.message ?? "";
    const match =
      msg.match(/column\s+\"?([^\s\"']+)\"?\s+does not exist/i) ||
      msg.match(/column\s+'?([^\s\"']+)'?\s+does not exist/i);
    if (!match?.[1]) return null;
    const full = match[1];
    const parts = full.split(".");
    return parts.length > 1 ? parts[parts.length - 1] : full;
  };

  const dropColumnFromSelect = (select: string, column: string) =>
    select
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !s.includes(column))
      .join(", ");

  const isNotFoundError = (error: { message?: string; code?: string } | null) =>
    error?.code === "PGRST116" ||
    error?.message?.toLowerCase().includes("row not found") ||
    error?.message?.toLowerCase().includes("results contain 0 rows");

  let submission: SubmissionRow | null = null;
  let submissionError: { message?: string; code?: string } | null = null;
  let selectClause = SUBMISSION_ADMIN_DETAIL_SELECT;

  const maxAttempts = Math.max(6, selectClause.split(",").length);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await supabase
      .from("submissions")
      .select(selectClause)
      .eq("id", submissionId)
      .maybeSingle();
    submission = (data as SubmissionRow | null) ?? null;
    submissionError = error ?? null;

    if (!submissionError) {
      break;
    }

    if (isNotFoundError(submissionError)) {
      return renderSubmissionNotFound(submissionError?.message);
    }

    const missing = extractMissingColumn(submissionError);
    if (!missing) {
      break;
    }
    const next = dropColumnFromSelect(selectClause, missing);
    if (next === selectClause) {
      break;
    }
    selectClause = next;
  }

  if (isNotFoundError(submissionError) || !submission) {
    return renderSubmissionNotFound(submissionError?.message);
  }

  if (submissionError) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-12">
        <h1 className="font-display text-2xl text-foreground">접수 상세</h1>
        <p className={`mt-4 rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${brandStatusTones.danger}`}>
          서버 오류로 접수 정보를 불러오지 못했습니다.
        </p>
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-foreground">
            오류 상세
          </summary>
          <div className="mt-2 space-y-1 rounded-2xl border border-border/60 bg-background px-4 py-3">
            <p className="break-all">ID: {submissionId}</p>
            <p className="break-words">
              {submissionError.message ?? "알 수 없는 오류"}
            </p>
          </div>
        </details>
        <div className="mt-3 flex gap-3">
          <Link
            href={initialAdminSubmissionListHref}
            className="rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  // Staff notes come from the administrator-only table. The old column is
  // only read as a fallback until 20261103160000 has moved the notes.
  const adminMemoResult = await loadSubmissionAdminMemo(supabase, submission.id);
  const adminMemo = adminMemoResult.memo ?? submission.admin_memo ?? null;
  const adminMemoUnavailable = adminMemoResult.error && !submission.admin_memo;

  // Guest submissions (including admin-registered ones) are followed with a
  // lookup code; the admin may need to pass the code and link on again.
  const guestLookup = submission.user_id
    ? null
    : await supabase.from("submissions").select("guest_token").eq("id", submission.id).maybeSingle()
      .then(({ data }) => {
        const code = typeof data?.guest_token === "string" ? data.guest_token.trim() : "";
        return code.length >= 8 ? { code, url: buildUrl(`/track/${encodeURIComponent(code)}`, getBaseUrl()) } : null;
      }, () => null);

  // What the customer opens: the guest lookup page or the member dashboard
  // page. The admin preview renders the same screen without the customer's
  // session, so staff can check what was delivered before passing the link on.
  const customerPage = {
    url: guestLookup?.url ?? buildUrl(`/dashboard/submissions/${encodeURIComponent(submission.id)}`, getBaseUrl()),
    previewPath: `/admin/submissions/customer-view?id=${encodeURIComponent(submission.id)}`,
    kind: guestLookup ? "비회원 조회 링크" : "회원 로그인 후 열람",
  };

  const hasGuestColumns =
    submission.guest_name !== undefined ||
    submission.guest_company !== undefined ||
    submission.guest_email !== undefined ||
    submission.guest_phone !== undefined;

  const packageInfo = Array.isArray(submission.package)
    ? submission.package[0]
    : submission.package;
  const isMvDistribution = submission.type === "MV_DISTRIBUTION";
  const isMvBroadcast = submission.type === "MV_BROADCAST";
  const isMvSubmission = isMvDistribution || isMvBroadcast;
  const submissionTypeListHref = typeLabels[submission.type]
    ? `/admin/submissions?type=${encodeURIComponent(submission.type)}`
    : "/admin/submissions?type=ALBUM";
  const adminSubmissionListHref = safeAdminSubmissionsReturnTo(
    returnToParam,
    submissionTypeListHref,
  );
  const paymentLabel =
    submission.payment_status && paymentStatusLabelMap[submission.payment_status]
      ? paymentStatusLabelMap[submission.payment_status]
      : submission.payment_status ?? "미결제";
  const stationSelectWithTracks =
    "id, status, result_note, age_rating, track_results:track_results_json, updated_at, station_id, station:stations ( id, name, code )";
  const stationSelectLegacyTracks =
    "id, status, result_note, age_rating, track_results, updated_at, station_id, station:stations ( id, name, code )";
  const stationSelectNoTracks =
    "id, status, result_note, age_rating, updated_at, station_id, station:stations ( id, name, code )";

  const expectedCodes = submission.type === "ALBUM"
    ? getPackageStationCodes(packageInfo?.station_count, packageInfo?.name)
    : submission.type === "MV_BROADCAST" ? (submission.mv_selected_station_codes ?? []).filter(code => !["MV_BROADCAST", "MV_ONLINE"].includes(code)) : [];
  // These sections depend only on the authorized submission, not on one another.
  const [member, paymentDocumentResult, stationResult, expectedStationResult, eventResult, fileResult] = await Promise.all([
    (async () => {
      if (!submission.user_id || submission.guest_name) return { profile: null, email: null, signIn: null };
      const { data: profile } = await supabase
        .from("profiles")
        .select("name, company, phone")
        .eq("user_id", submission.user_id)
        .maybeSingle();
      const { data } = await supabase.auth.admin.getUserById(submission.user_id);
      return { profile, email: data.user?.email ?? null, signIn: data.user ? memberSignInFromAuthUser(data.user) : null };
    })(),
    supabase
      .from("submissions")
      .select("payment_document_type, cash_receipt_purpose, cash_receipt_phone, cash_receipt_business_number, tax_invoice_business_number")
      .eq("id", submission.id)
      .maybeSingle(),
    supabase
      .from("station_reviews")
      .select(stationSelectWithTracks)
      .eq("submission_id", submissionId)
      .order("station_id", { ascending: true }),
    expectedCodes.length
      ? supabase.from("stations").select("id, name, code").in("code", expectedCodes)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("submission_events")
      .select("id, event_type, message, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false }),
    supabase
      .from("submission_files")
      .select("id, kind, file_path, original_name, mime, size, created_at, purged_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: false }),
  ]);
  const memberProfile = member.profile;
  const memberEmail = member.email;
  // Bank-transfer orders carry the depositor name and the promised deposit
  // day; both help match the incoming transfer before confirming payment.
  const currentOrderId = (submission as { current_order_id?: string | null }).current_order_id ?? null;
  const { data: currentOrderRaw } = currentOrderId
    ? await supabase
      .from("submission_orders")
      .select("id, status, payment_method, depositor_name, deposit_due_at, amount_krw, refunded_at")
      .eq("id", currentOrderId)
      .maybeSingle()
    : { data: null };
  const currentOrder = currentOrderRaw as {
    id: string; status: string; payment_method: string; depositor_name: string | null; deposit_due_at: string | null; amount_krw: number | null; refunded_at: string | null;
  } | null;
  // The refund panel lists every application paid in the same order and
  // warns when a cash receipt was issued for it.
  const [orderItemsResult, cashReceiptResult] = currentOrderId && ["PAID", "REFUNDED"].includes(submission.payment_status ?? "")
    ? await Promise.all([
      supabase.from("submission_order_items").select("title, submission_id").eq("order_id", currentOrderId),
      supabase.from("submission_order_cash_receipts").select("status").eq("order_id", currentOrderId).maybeSingle(),
    ])
    : [{ data: null }, { data: null }];
  const orderTitles = ((orderItemsResult.data ?? []) as Array<{ title: string | null; submission_id: string | null }>)
    .filter((item) => item.submission_id)
    .map((item) => item.title?.trim() || "제목 미입력");
  const cashReceiptIssued = (cashReceiptResult.data as { status?: string } | null)?.status === "ISSUED";
  const depositDueDate = formatDepositDue(currentOrder?.deposit_due_at);
  const depositDueLabel = depositDueDate
    ? `${depositDueDate}${currentOrder?.status === "BANK_PENDING" && isDepositOverdue(currentOrder.deposit_due_at) ? " (기한 지남)" : ""}`
    : null;

  const applicantEmail = submission.applicant_email ?? submission.guest_email ?? null;
  const albumTracks = submission.album_tracks ?? [];
  const isOneclick = submission.is_oneclick === true;
  const releasedAlbumUrl = parseReleasedAlbumUrl(submission.melon_url);
  const { data: paymentDocumentRaw, error: paymentDocumentError } = paymentDocumentResult;
  const paymentDocument = paymentDocumentError
    ? null
    : (paymentDocumentRaw as PaymentDocumentRow | null);
  const paymentDocumentTypeLabel = paymentDocument?.payment_document_type
    ? paymentDocumentLabels[paymentDocument.payment_document_type] ??
      paymentDocument.payment_document_type
    : "-";
  const cashReceiptPurposeLabel = paymentDocument?.cash_receipt_purpose
    ? cashReceiptPurposeLabels[paymentDocument.cash_receipt_purpose] ??
      paymentDocument.cash_receipt_purpose
    : "-";
  const paymentDocumentTargetValue =
    paymentDocument?.payment_document_type === "CASH_RECEIPT" &&
    paymentDocument.cash_receipt_purpose === "PERSONAL_INCOME_DEDUCTION"
      ? paymentDocument.cash_receipt_phone ?? "-"
      : paymentDocument?.payment_document_type === "CASH_RECEIPT" &&
          paymentDocument.cash_receipt_purpose === "BUSINESS_EXPENSE_PROOF"
        ? paymentDocument.cash_receipt_business_number ?? "-"
        : paymentDocument?.payment_document_type === "TAX_INVOICE"
          ? paymentDocument.tax_invoice_business_number ?? "-"
          : "-";

  let stationReviews =
    (stationResult.data as
      | Array<{
          id: string;
          status: string;
          result_note: string | null;
          age_rating?: string | null;
          track_results?: unknown;
          updated_at: string;
          station_id: string | null;
          station: Array<{ id: string; name: string | null; code: string | null }>;
        }>
      | null) ?? null;

  if (
    stationResult.error &&
    (stationResult.error.code === "42703" ||
      stationResult.error.message?.toLowerCase().includes("track_results_json") ||
      stationResult.error.message?.toLowerCase().includes("track_results"))
  ) {
    const legacy = await supabase
      .from("station_reviews")
      .select(stationSelectLegacyTracks)
      .eq("submission_id", submissionId)
      .order("station_id", { ascending: true });
    if (legacy.error) {
      const fallback = await supabase
        .from("station_reviews")
        .select(stationSelectNoTracks)
        .eq("submission_id", submissionId)
        .order("station_id", { ascending: true });
      stationReviews = (fallback.data as typeof stationReviews) ?? stationReviews;
    } else {
      stationReviews = (legacy.data as typeof stationReviews) ?? stationReviews;
    }
  }

  if (submission.type === "MV_BROADCAST") {
    stationReviews = (stationReviews ?? []).filter(review => {
      const station = Array.isArray(review.station) ? review.station[0] : review.station;
      return !["MV_BROADCAST", "MV_ONLINE"].includes(station?.code ?? "");
    });
  }

  if (submission.type === "ALBUM" || submission.type === "MV_BROADCAST") {
    // Missing rows are displayed as unsent and created by the explicit save action.
    // Merely viewing an admin page must not create or reset review records.
    if (expectedCodes.length > 0) {
      const expectedStations = expectedStationResult.data;
      const existingStationIds = new Set((stationReviews ?? []).map(review => review.station_id));
      stationReviews = [...(stationReviews ?? []), ...(expectedStations ?? [])
        .filter(station => !existingStationIds.has(station.id))
        .map(station => ({
          id: `pending-${station.id}`, status: "NOT_SENT", result_note: null,
          track_results: null, updated_at: submission.updated_at,
          station_id: station.id, station: [station],
        }))];
    }
  }

  if ((!stationReviews || stationReviews.length === 0) && submission.type === "MV_DISTRIBUTION") {
    const fallbackStationName =
      submission.type === "MV_DISTRIBUTION"
        ? "영상물등급위원회"
        : submission.package && !Array.isArray(submission.package)
          ? submission.package.name || "신청 방송국"
          : "신청 방송국";
    stationReviews = [
      {
        id: `fallback-${submissionId}`,
        status: submission.status ?? "SUBMITTED",
        result_note: null,
        track_results: null,
        updated_at: submission.updated_at,
        station_id: null,
        station: [{ id: null as unknown as string, name: fallbackStationName, code: null }],
      },
    ];
  }

  const hasMvFinalResultForDisplay =
    isMvDistribution &&
    Boolean(submission.mv_desired_rating) &&
    (submission.status === "RESULT_READY" ||
      submission.status === "COMPLETED" ||
      Boolean(submission.result_status));

  if (hasMvFinalResultForDisplay && stationReviews && stationReviews.length > 0) {
    const mvStationFinalStatus =
      submission.result_status === "REJECTED"
        ? "REJECTED"
        : submission.result_status === "NEEDS_FIX"
          ? "NEEDS_FIX"
          : "APPROVED";
    stationReviews = stationReviews.map((review) => ({
      ...review,
      status: mvStationFinalStatus,
      result_note: review.result_note ?? submission.result_memo ?? null,
      updated_at: review.updated_at ?? submission.updated_at,
    }));
  }

  const events = eventResult.data;
  const submissionFiles = fileResult.data;

  const files = submissionFiles ?? [];
  // Progress notices do not stamp result_notified_at; show the newest accepted
  // customer mail so an operator does not resend a notice that already went out.
  const { data: lastCustomerEmail } = await supabase
    .from("email_outbox")
    .select("operation, created_at, accepted_at")
    .eq("submission_id", submission.id)
    .in("operation", ["review result", "submission update", "payment completed"])
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // The detail page lists only this submission's customer mail; the full
  // outbox lives under 메일 발송 내역 in the admin menu.
  const customerEmails = await loadSubmissionCustomerEmails(supabase, submission.id);
  // Who receives result and progress mail, and which column the admin may
  // fill when nobody does. A failed lookup shows a notice instead of a form.
  const [recipientState, uploadRecord, customerViews] = await Promise.all([
    describeSubmissionRecipient(supabase, submission).then(
      (state): SubmissionRecipientState | null => state,
      () => null,
    ),
    loadSubmissionUploadRecord(supabase, submission.id),
    loadCustomerViewRecords(supabase, [submission.id]),
  ]);
  const customerView = customerViews.records.get(submission.id);
  const customerSawResult = viewedAfterNotice(customerView, submission.result_notified_at);
  const adminStage = adminSubmissionStageOf(submission);
  const adminStageInfo = adminStage ? adminSubmissionStages[adminStage] : null;
  const reviews = stationReviews ?? [];
  const isStationSubmittedStatus = (status?: string | null) => {
    const normalized = normalizeStationReviewStatus(status);
    return (
      normalized === "SENT" ||
      normalized === "APPROVED" ||
      normalized === "REJECTED" ||
      normalized === "NEEDS_FIX"
    );
  };
  const stationSubmittedCount = reviews.filter((review) =>
    isStationSubmittedStatus(review.status),
  ).length;
  const completedReviewCount = reviews.filter((review) => {
    return getStationReviewDisplayStatus({ ...review, station: Array.isArray(review.station) ? review.station[0] : review.station }, { albumTracks }).isComplete;
  }).length;
  const hasRequiredBasics = Boolean(submission.title && submission.artist_name);
  const hasPaymentComplete = submission.payment_status === "PAID";
  const hasResultPublished =
    submission.status === "RESULT_READY" ||
    submission.status === "COMPLETED" ||
    Boolean(submission.result_status || submission.result_notified_at);
  const hasAllStationsSubmitted =
    reviews.length > 0 && stationSubmittedCount === reviews.length;
  const hasAllReviewsCompleted =
    reviews.length > 0 && completedReviewCount === reviews.length;
  const hasMvRating = isRatingCode(submission.mv_desired_rating);
  const hasMvCertificate = Boolean(submission.certificate_b2_path);
  const hasMvResultGrade = isMvDistribution && hasMvRating && hasResultPublished;
  // A rejected review hands the customer no files, so it needs no certificate.
  const isMvRejected = hasMvResultGrade && submission.mv_desired_rating === "REJECT";
  const hasMvResultComplete = isMvDistribution
    ? hasMvResultGrade && (hasMvCertificate || isMvRejected)
    : isMvSubmission && hasResultPublished;
  const hasMvReceptionStarted =
    isMvSubmission &&
    hasPaymentComplete &&
    (submission.status === "IN_PROGRESS" ||
      submission.status === "RESULT_READY" ||
      submission.status === "COMPLETED" ||
      stationSubmittedCount > 0 ||
      hasResultPublished);
  const hasAlbumResultNotified = !isMvSubmission && hasAllReviewsCompleted;
  const hasAlbumReviewInProgress =
    !isMvSubmission &&
    hasPaymentComplete &&
    (submission.status === "IN_PROGRESS" ||
      submission.status === "RESULT_READY" ||
      submission.status === "COMPLETED" ||
      stationSubmittedCount > 0 ||
      completedReviewCount > 0);
  const currentOperationalStage =
    (isMvSubmission ? hasResultPublished : hasAlbumResultNotified)
      ? "RESULT_NOTIFIED"
      : isMvSubmission
        ? hasMvReceptionStarted
          ? "REVIEW_IN_PROGRESS"
          : hasPaymentComplete
            ? "PAYMENT_COMPLETE"
            : "APPLICATION_RECEIVED"
        : hasAlbumReviewInProgress
          ? "REVIEW_IN_PROGRESS"
          : hasPaymentComplete
            ? "PAYMENT_COMPLETE"
            : "APPLICATION_RECEIVED";
  const stationResultProgressLabel =
    reviews.length > 0
      ? `${reviews.length}곳 중 ${completedReviewCount}곳 반영`
      : "결과 대기";
  const finalReviewStepLabel = "결과";
  const finalReviewStepValue = isMvSubmission
    ? isMvDistribution
      ? isMvRejected
        ? `${mvRatingLabel(submission.mv_desired_rating)} · 제공 파일 없음`
        : hasMvResultComplete
          ? `${mvRatingLabel(submission.mv_desired_rating)} · 필증 등록`
          : hasMvResultGrade
            ? `${mvRatingLabel(submission.mv_desired_rating)} · 필증 대기`
            : hasMvReceptionStarted
              ? "등급 선택 전"
              : "접수 후 입력"
      : hasResultPublished
        ? resultStatusLabelMap[
            submission.result_status as keyof typeof resultStatusLabelMap
          ] ?? "결과 등록 완료"
        : hasMvReceptionStarted
          ? "입력 전"
          : "접수 후 입력"
    : reviews.length > 0
      ? stationResultProgressLabel
      : "결과 대기";
  const finalReviewStepState = isMvSubmission
    ? hasMvResultComplete
      ? "done"
      : hasMvReceptionStarted
        ? "active"
        : "pending"
    : hasAllReviewsCompleted
      ? "done"
      : hasAllStationsSubmitted || completedReviewCount > 0
        ? "active"
        : "pending";
  const latestEvent = events?.[0] ?? null;
  const workflowSteps: Array<{
    label: string;
    value: string;
    state: "done" | "active" | "pending";
  }> = [
    {
      label: "신청",
      value: hasRequiredBasics ? `${formatDate(submission.created_at)} 접수` : "제목·아티스트 보완 필요",
      state: hasRequiredBasics ? "done" : "active",
    },
    {
      label: "결제",
      value: hasPaymentComplete
        ? [submission.payment_method ? paymentMethodLabels[submission.payment_method] ?? submission.payment_method : null,
          submission.amount_krw ? `${formatCurrency(submission.amount_krw)}원` : null].filter(Boolean).join(" · ") || "확인됨"
        : paymentLabel,
      state: hasPaymentComplete ? "done" : submission.payment_status === "REFUNDED" ? "pending" : "active",
    },
    {
      label: isMvDistribution ? "영등위 접수" : "방송사 접수",
      value: !hasPaymentComplete
        ? "결제 확인 후 시작"
        : isMvDistribution
          ? hasResultPublished
            ? "결과 수신"
            : hasMvReceptionStarted
              ? "심의 중"
              : "접수 준비"
          : reviews.length > 0
            ? `${reviews.length}곳 중 ${stationSubmittedCount}곳`
            : "접수 준비",
      state: isMvDistribution
        ? hasResultPublished
          ? "done"
          : hasPaymentComplete || hasMvReceptionStarted
            ? "active"
            : "pending"
        : hasAllStationsSubmitted || hasAlbumResultNotified || (isMvSubmission && hasResultPublished)
          ? "done"
          : hasPaymentComplete || hasAlbumReviewInProgress || hasMvReceptionStarted
            ? "active"
            : "pending",
    },
    {
      label: finalReviewStepLabel,
      value: finalReviewStepValue,
      state: finalReviewStepState,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 text-[15px] leading-relaxed sm:text-base [&_input]:text-base [&_textarea]:text-base [&_select]:text-base [&_label]:text-sm">
      {!isSaveError && saveMessage ? <AdminSaveToast message={saveMessage} /> : null}
      {isSaveError && errorMessage ? (
        <div className={`mb-4 rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${brandStatusTones.danger}`}>
          {errorMessage}
        </div>
      ) : null}
      {isSaveWarning && warningMessage ? (
        <div className={`mb-4 rounded-2xl border-2 px-4 py-3 text-sm font-semibold ${brandStatusTones.warning}`}>
          저장 경고: {warningMessage}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground">
            {submission.title || (isOneclick ? "발매된 음반 · URL 접수" : "제목 미입력")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {submission.artist_name || (isOneclick ? "앨범 링크 확인 대기" : "아티스트 미입력")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-full border border-border/60 bg-background px-3 py-1 uppercase tracking-[0.2em] text-muted-foreground">
              ID: {submission.id.slice(0, 8)}
            </span>
            {adminStageInfo ? (
              <span className={`rounded-[6px] border-2 px-2.5 py-1 font-black ${adminStageInfo.tone}`}>
                {adminStageInfo.label}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="text-muted-foreground">
            Updated {formatDateTime(submission.updated_at ?? submission.created_at)}
          </span>
          {submission.type === "ALBUM" ? (
            <ReviewDocsSingleDownloadButton
              id={submission.id}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-[#111111] bg-[#111111] px-3 py-1 text-[11px] font-semibold uppercase tracking-normal text-white transition hover:bg-[#1556a4] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]"
            />
          ) : null}
          <AdminDeleteButton ids={[submission.id]} redirectTo={adminSubmissionListHref} />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border-2 border-[#111111] bg-[#fffaf0] p-5 text-sm shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:shadow-[4px_4px_0_#f2cf27]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-muted-foreground">고객 결과 페이지</p>
            <p className="mt-1 text-xs text-muted-foreground">
              고객이 보는 결과 화면과 작성 신청서를 관리자가 그대로 확인합니다. ({customerPage.kind})
            </p>
          </div>
          <Link
            href={customerPage.previewPath}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-4 py-2 text-xs font-black text-[#111111] transition hover:bg-[#111111] hover:text-white dark:border-[#f2cf27]"
          >
            고객 화면으로 보기 ↗
          </Link>
        </div>
        <div className="mt-3 grid gap-2 text-xs md:grid-cols-[120px_1fr]">
          <span className="font-semibold text-muted-foreground">고객 주소</span>
          <a href={customerPage.url} target="_blank" rel="noreferrer" className="select-all break-all font-mono font-semibold text-[#1556a4] underline underline-offset-4 dark:text-sky-300">
            {customerPage.url}
          </a>
          {guestLookup ? (
            <>
              <span className="font-semibold text-muted-foreground">조회 코드</span>
              <span className="select-all break-all font-mono font-semibold text-foreground">{guestLookup.code}</span>
            </>
          ) : null}
          <span className="font-semibold text-muted-foreground">고객 확인 기록</span>
          <span className="font-semibold text-foreground">
            {customerViews.error ? "기록을 불러오지 못했습니다." : customerView ? (
              <>
                결과 페이지 마지막 확인 {formatDateTime(customerView.lastViewedAt)} · 첫 확인 {formatDateTime(customerView.firstViewedAt)} · 방문 {customerView.viewCount}회
                {customerView.downloadCount ? ` · 결과 파일 다운로드 ${customerView.downloadCount}회 (마지막 ${formatDateTime(customerView.lastDownloadAt)})` : ""}
              </>
            ) : "고객이 결과 페이지를 연 기록이 없습니다."}
            {submission.result_notified_at && !customerViews.error ? (
              <span className={`ml-2 inline-flex rounded-[6px] border-2 px-2 py-0.5 text-[11px] font-black ${customerSawResult ? brandStatusTones.success : brandStatusTones.warning}`}>
                {customerSawResult ? "결과 안내 후 확인함" : "결과 안내 후 확인 기록 없음"}
              </span>
            ) : null}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          고객(회원 본인·조회 코드 소지자)이 결과 페이지를 열거나 결과 파일을 받은 기록입니다. 관리자 미리보기는 기록하지 않습니다. 2026-11-05 이후부터 기록합니다.
        </p>
      </div>

      {adminStage === "drafting" ? (
        <div className={`mt-6 rounded-2xl border-2 p-5 text-sm ${adminStageInfo?.tone ?? ""}`}>
          <p className="text-base font-black">신청서 작성 중 · 아직 접수되지 않은 신청입니다</p>
          <p className="mt-2 leading-6">
            고객이 파일 업로드 단계에서 멈춘 상태입니다. 결제 수단에 무통장이 선택되어 있어도 주문(입금 요청)이 만들어지지 않았기 때문에
            접수 완료·무통장 입금 안내 메일은 발송되지 않습니다. 고객이 파일을 올리고 신청을 마치면 안내 메일이 자동 발송됩니다.
          </p>
          <p className="mt-2 font-bold">
            업로드 시도: {uploadRecord.error ? "기록을 불러오지 못했습니다." : uploadRecord.attempts === 0 ? "서버에 도착한 업로드 요청이 없습니다." : `${uploadRecord.attempts}건 (완료 ${uploadRecord.completed}건, 미완료·실패 ${uploadRecord.unfinished}건)`}
          </p>
        </div>
      ) : null}

      {submission.payment_status === "PAID" ? <SubmissionSupplements submissionId={submission.id} admin /> : null}
      {!isMvSubmission && isOneclick ? (
        <div className="mt-6 rounded-2xl border-2 border-[var(--bauhaus-ink)] bg-card p-5 text-sm">
          <p className={`inline-flex rounded-md border-2 px-2 py-1 font-semibold ${brandStatusTones.progress}`}>발매된 음반 · URL 접수</p>
          <p className="mt-2 leading-6 text-muted-foreground">
            추가금 없이 접수된 발매 음반입니다. 심의자료 다운로드를 누르면 멜론·지니 링크에서 앨범 정보와 가사를 수집해 신청서 ZIP을 만듭니다.
          </p>
          {releasedAlbumUrl ? (
            <a
              href={releasedAlbumUrl.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block break-all font-semibold text-[#1556a4] underline underline-offset-4 dark:text-sky-300"
            >
              {submission.melon_url}
            </a>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            원본 정보와 가사를 확인한 뒤 사용해주세요. 링크에서 자료를 불러오지 못하면 앨범 링크를 확인하거나 심의자료 도구에서 보완할 수 있습니다.
          </p>
          <form action={hydrateReleasedAlbumInfoFormAction} method="post" className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="submissionId" value={submission.id} />
            <input type="hidden" name="returnTo" value={adminSubmissionListHref} />
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-4 py-2 text-xs font-black text-[#111111] transition hover:bg-[#111111] hover:text-white dark:border-[#f2cf27] dark:bg-[#111111] dark:text-[#f2cf27]"
            >
              멜론·지니 앨범 정보 신청서에 반영
            </button>
            <span className="text-xs text-muted-foreground">
              비어 있는 발매일·장르·유통사·제작사와 트랙·가사를 링크의 앨범 정보로 채웁니다. 이미 입력된 값은 바꾸지 않습니다. 접수·결제 시점과 심의자료 생성 시에도 같은 반영이 자동으로 실행됩니다.
            </span>
          </form>
        </div>
      ) : null}

      <div className="mt-8 rounded-[28px] border border-border/60 bg-background/80 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              심의 흐름
            </p>
          </div>
          <Link
            href={adminSubmissionListHref}
            className="rounded-full border border-border/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            목록으로
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {workflowSteps.map((step, index) => (
            <div
              key={step.label}
              className={[
                "min-h-[116px] rounded-2xl border px-4 py-3 text-sm",
                step.state === "done"
                  ? "border-[#1f5fae] bg-[#1f5fae] text-white"
                  : step.state === "active"
                    ? "border-foreground bg-[#f2cf27] text-foreground"
                    : "border-border/60 bg-card/70 text-muted-foreground",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={[
                    "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                    step.state === "done"
                      ? "bg-white/20 text-white"
                      : step.state === "active"
                        ? "bg-foreground text-background"
                        : "bg-background text-muted-foreground",
                  ].join(" ")}
                >
                  {index + 1}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                  {step.state === "done"
                    ? "완료"
                    : step.state === "active"
                      ? "진행 중"
                      : "대기"}
                </span>
              </div>
              <p className="mt-4 font-semibold">{step.label}</p>
              <p
                className={[
                  "mt-1 text-xs",
                  step.state === "done" ? "text-white/80" : "text-inherit",
                ].join(" ")}
              >
                {step.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              1. 신청서 작성 및 결제
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <DetailRow
                label="유형"
                value={typeLabels[submission.type] ?? submission.type}
              />
              <DetailRow
                label="AI 활용 여부"
                value={aiUsageLabel(submission.ai_used)}
              />
              <DetailRow label="패키지" value={packageInfo?.name ?? "-"} />
              <DetailRow
                label="금액"
                value={
                  submission.amount_krw
                    ? `${submission.amount_krw.toLocaleString()}원`
                    : "-"
                }
              />
              <DetailRow
                label="결제 방식"
                value={
                  submission.payment_method
                    ? paymentMethodLabels[submission.payment_method] ??
                      submission.payment_method
                    : "-"
                }
              />
              <DetailRow
                label="사전검토"
                value={submission.pre_review_requested ? "요청" : "미요청"}
              />
              <DetailRow
                label="노래방 등록"
                value={submission.karaoke_requested ? "요청" : "미요청"}
              />
            </div>
          </div>

          <AdminRefundPanel
            submissionId={submission.id}
            paymentStatus={submission.payment_status}
            paymentMethod={currentOrder?.payment_method ?? submission.payment_method}
            amountKrw={currentOrder?.amount_krw ?? submission.amount_krw}
            orderTitles={orderTitles}
            cashReceiptIssued={cashReceiptIssued}
            refundedAt={currentOrder?.refunded_at ?? null}
          />

          <form
            action={saveSubmissionAdminFormAction}
            method="post"
            className="space-y-6"
            id="admin-save-form"
          >
            <input type="hidden" name="submissionId" value={submission.id} />
            <input type="hidden" name="returnTo" value={adminSubmissionListHref} />

            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                기본 정보 보정
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                누락된 표시 정보를 보완합니다.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
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
              </div>
            </div>

            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                2. 운영 단계
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                    입금자명
                  </label>
                  <input
                    value={
                      submission.payment_method === "BANK"
                        ? currentOrder?.depositor_name ?? submission.bank_depositor_name ?? "-"
                        : "카드 결제"
                    }
                    readOnly
                    className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                  />
                </div>
                {submission.payment_method === "BANK" && depositDueLabel ? (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      입금 예정일
                    </label>
                    <input
                      value={depositDueLabel}
                      readOnly
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                    />
                  </div>
                ) : null}
                {submission.payment_method === "BANK" && (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        결제 서류
                      </label>
                      <input
                        value={paymentDocumentTypeLabel}
                        readOnly
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                      />
                    </div>
                    {paymentDocument?.payment_document_type === "CASH_RECEIPT" && (
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          현금 영수증 용도
                        </label>
                        <input
                          value={cashReceiptPurposeLabel}
                          readOnly
                          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                        />
                      </div>
                    )}
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        발급 정보
                      </label>
                      <input
                        value={paymentDocumentTargetValue}
                        readOnly
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="mt-6 grid gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    운영 단계
                  </label>
                  {isMvSubmission && hasResultPublished ? (
                    <>
                      <input
                        type="hidden"
                        name="operationalStage"
                        value={currentOperationalStage}
                      />
                      <input
                        value="결과 준비"
                        readOnly
                        className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-muted-foreground"
                      />
                    </>
                  ) : (
                    <select
                      name="operationalStage"
                      defaultValue={currentOperationalStage}
                      className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
                    >
                      {operationalStageOptions.map((stage) => (
                        <option key={stage.value} value={stage.value}>
                          {stage.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  관리자 메모
                </label>
                {/* A disabled field is not submitted, so a note that failed to
                    load is left unchanged instead of being cleared. */}
                <textarea
                  name="adminMemo"
                  defaultValue={adminMemo ?? ""}
                  disabled={adminMemoUnavailable}
                  className="h-24 w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm disabled:opacity-60"
                  placeholder={adminMemoUnavailable ? "관리자 메모를 불러오지 못했습니다. 새로고침 후 수정해주세요." : "관리자 메모"}
                />
              </div>
              <div className="mt-5 flex justify-end">
                <ConfirmSubmitButton
                  className="rounded-full bg-foreground px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                  message="저장하시겠습니까?"
                >
                  상태 저장
                </ConfirmSubmitButton>
              </div>
            </div>
          </form>

          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              제출 자료
            </p>
            <div className="mt-4">
              <SubmissionFilesPanel submissionId={submission.id} files={files} />
            </div>
            <details className="mt-4 rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold text-foreground">
                업로드 기록 · {uploadRecord.error ? "확인 실패" : uploadRecord.attempts === 0 ? "요청 없음" : `요청 ${uploadRecord.attempts}건 · 완료 ${uploadRecord.completed}건 · 미완료·실패 ${uploadRecord.unfinished}건`}
              </summary>
              <ul className="mt-2 space-y-1">
                {uploadRecord.items.map((item) => (
                  <li key={item.id} className="break-all">
                    {item.name || "파일명 없음"} · {item.sizeLabel} · {item.statusLabel} · {formatDateTime(item.createdAt)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 leading-5">
                고객이 업로드를 시작하면 서버에 요청 기록이 남습니다. 큰 파일(32MB 이상)의 기록은 계속 보관되고, 작은 파일의 요청 기록은 완료 하루 뒤 또는 만료 시 정리됩니다.
                기록이 없으면 업로드가 서버까지 오지 않은 것입니다(파일 선택 전 이탈 또는 브라우저에서 거절).
              </p>
            </details>
          </div>

          <section
            id="notification-recipient"
            aria-label="결과 안내 수신 이메일"
            className={`scroll-mt-24 rounded-[28px] border-2 p-6 text-sm ${recipientState && !recipientState.recipient ? "border-[#d9362c] bg-card" : "border-border/60 bg-card/80"}`}
          >
            <h2 className="text-base font-semibold">결과 안내 수신 이메일</h2>
            {recipientState ? (
              <>
                <p className="mt-2 text-sm">
                  {recipientState.recipient ? (
                    <>
                      <span className="break-all font-black">{recipientState.recipient}</span>
                      <span className="ml-2 text-xs text-muted-foreground">({recipientSourceLabels[recipientState.source]})</span>
                    </>
                  ) : (
                    <span className={`inline-flex rounded-[6px] border-2 px-2 py-0.5 text-xs font-black ${brandStatusTones.danger}`}>
                      수신 이메일이 없어 결과·진행 안내 메일을 보낼 수 없습니다
                    </span>
                  )}
                </p>
                {recipientState.editField ? (
                  <form action={updateSubmissionNotificationEmailFormAction} className="mt-4 space-y-3">
                    <input type="hidden" name="submissionId" value={submission.id} />
                    <input type="hidden" name="returnTo" value={adminSubmissionListHref} />
                    <label className="block text-xs font-semibold text-muted-foreground" htmlFor="notification-email">
                      {recipientState.recipient ? "다른 주소로 바꾸기" : "고객에게 받은 이메일 주소를 입력하세요"}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <input
                        id="notification-email"
                        name="email"
                        type="email"
                        required
                        maxLength={200}
                        defaultValue={recipientState.recipient ? "" : recipientState.suggestions[0] ?? ""}
                        placeholder="name@example.com"
                        className="min-w-0 flex-1 rounded-2xl border border-border/70 bg-background px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-foreground"
                      />
                      <ConfirmSubmitButton
                        className="rounded-full bg-foreground px-5 py-2.5 text-xs font-semibold text-background"
                        message="이 주소를 결과 안내 수신 이메일로 저장할까요? 메일은 저장 후 결과 이메일 발송에서 따로 보냅니다."
                      >
                        수신 이메일 저장
                      </ConfirmSubmitButton>
                    </div>
                    {recipientState.suggestions.length ? (
                      <p className="text-xs text-muted-foreground">
                        같은 회원의 다른 신청서에 적힌 이메일: <span className="break-all font-semibold text-foreground">{recipientState.suggestions.join(", ")}</span>
                      </p>
                    ) : null}
                    <p className="text-xs leading-5 text-muted-foreground">
                      {recipientState.editField === "guest_email"
                        ? "비회원 신청의 이메일로 저장됩니다. 접수 상태·결제·심의 결과는 바뀌지 않습니다."
                        : "이 신청서의 신청자 이메일로 저장됩니다. 회원 계정과 다른 신청서, 결제·심의 결과는 바뀌지 않습니다."}
                      {" "}저장만으로는 메일이 나가지 않습니다.
                    </p>
                  </form>
                ) : recipientState.lockedReason ? (
                  <p className="mt-2 text-xs text-muted-foreground">{recipientState.lockedReason}</p>
                ) : null}
              </>
            ) : (
              <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
                수신 정보를 확인하지 못했습니다. 잠시 후 새로고침해주세요.
              </p>
            )}
          </section>


          <ReviewEmailControl
            key={`${submission.id}-${submission.updated_at}`}
            submissionId={submission.id}
            lastNotifiedAt={submission.result_notified_at}
            lastCustomerEmail={lastCustomerEmail ? { operation: String(lastCustomerEmail.operation), at: String(lastCustomerEmail.accepted_at ?? lastCustomerEmail.created_at) } : null}
            customerEmails={customerEmails.emails}
            customerEmailsUnavailable={customerEmails.error}
            returnTo={adminSubmissionListHref}
          />
          {isMvDistribution ? (
            <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    3. 접수 진행 / 4. 결과 저장
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    등급과 필증을 저장한 뒤 결과 이메일 안내에서 미리보고 발송해주세요.
                  </p>
                </div>
                <span className="rounded-full border border-border/60 bg-background px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                  {finalReviewStepValue}
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    접수 진행
                  </p>
                  <p className="mt-2 font-semibold text-foreground">
                    {hasResultPublished
                      ? "접수 진행 완료"
                      : hasMvReceptionStarted
                        ? "접수 진행 중"
                        : "결제 완료 후 접수 진행"}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    결과 통보
                  </p>
                  <p className="mt-2 font-semibold text-foreground">
                    {finalReviewStepValue}
                  </p>
                </div>
              </div>

                <div className="mt-5 space-y-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                      결과 등급
                    </p>
                    <div className="mt-3">
                      <MvRatingControl
                        submissionId={submission.id}
                        initialRating={submission.mv_desired_rating ?? ""}
                        expectedUpdatedAt={submission.updated_at}
                        isResultNotified={Boolean(submission.result_notified_at)}
                        isResultSaved={hasMvResultGrade}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                      심의 필증
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      사용자에게 제공할 필증을 업로드합니다.
                    </p>
                    <div className="mt-3">
                      <CertificateUploader
                        submissionId={submission.id}
                        currentObjectKey={submission.certificate_b2_path}
                        currentName={submission.certificate_original_name}
                        currentUploadedAt={submission.certificate_uploaded_at}
                        expectedUpdatedAt={submission.updated_at}
                      />
                    </div>
                  </div>
                </div>
            </div>
          ) : (
          <div className="rounded-[28px] border border-border/60 bg-card/80 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                3. 심의진행 / 4. 결과 저장
              </p>
              <span className="rounded-full border border-border/60 bg-background px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                {completedReviewCount}/{reviews.length} 결과
              </span>
            </div>
            <div className="mt-4 space-y-4">
              {reviews.length > 0 ? <StationReviewBulkForm
                key={`bulk-${submission.id}-${reviews.map(review => review.updated_at).join("-")}`}
                submissionId={submission.id}
                broadcast={submission.type === "MV_BROADCAST"}
                stations={reviews.filter(review => review.station_id && uuidPattern.test(review.station_id)).map(review => {
                  const station = Array.isArray(review.station) ? review.station[0] : review.station;
                  const persisted = typeof review.id === "string" && uuidPattern.test(review.id);
                  return { stationId: review.station_id!, reviewId: persisted ? review.id : null, expectedUpdatedAt: persisted ? review.updated_at : null, name: station?.name ?? station?.code ?? "방송사" };
                })}
              /> : null}
              {reviews.length > 0 ? (
                reviews.map((review, reviewIndex) => {
                  const stationInfo = Array.isArray(review.station)
                    ? review.station[0]
                    : review.station;
                  const stationTracks = getStationReviewTracks(albumTracks, stationInfo, review.track_results);
                  const trackSummary = summarizeTrackResults(
                    resolveStationTrackResults(review.track_results, stationTracks, review.status, stationInfo),
                    stationTracks,
                  );
                  const baseTracks =
                    stationTracks.length > 0
                      ? stationTracks.map((track, index) => ({
                          id: track.id ?? null,
                          track_no: track.track_no ?? index + 1,
                          title:
                            track.track_title ??
                            track.track_title_kr ??
                            track.track_title_en ??
                            "트랙",
                          status: "PENDING",
                        }))
                      : [];

                  const trackResults =
                    baseTracks.length > 0
                      ? baseTracks.map((bt) => {
                          const matched =
                            trackSummary.results.find(
                              (item) =>
                                (bt.id && item.track_id === bt.id) ||
                                (typeof bt.track_no === "number" &&
                                  typeof item.track_no === "number" &&
                                  item.track_no === bt.track_no),
                            ) ?? null;
                          return {
                            ...bt,
                            status: matched?.status ?? bt.status,
                          };
                        })
                      : trackSummary.results.map((item, idx) => ({
                          id: item.track_id ?? null,
                          track_no:
                            typeof item.track_no === "number" &&
                            Number.isFinite(item.track_no)
                              ? item.track_no
                              : idx + 1,
                          title: item.title ?? "트랙",
                          status: item.status ?? "PENDING",
                        }));

                  const wbsSelection = submission.type === "ALBUM" && isWbsReview(stationInfo) && albumTracks.length > 3
                    ? albumTracks.filter((track) => typeof track.id === "string" && uuidPattern.test(track.id)).map((track, index) => ({
                        id: track.id as string,
                        trackNo: track.track_no ?? index + 1,
                        title: track.track_title ?? track.track_title_kr ?? track.track_title_en ?? "트랙",
                        isTitle: track.is_title === true,
                        selected: track.broadcast_selected === true,
                      }))
                    : null;

                  return (
                    <React.Fragment key={`${review.id ?? `review-${reviewIndex}`}-${review.updated_at}`}>
                    {wbsSelection ? (
                      <WbsTrackSelectionForm
                        key={`wbs-${wbsSelection.map((track) => `${track.id}:${track.selected}`).join(",")}`}
                        submissionId={submission.id}
                        returnTo={adminSubmissionListHref}
                        tracks={wbsSelection}
                        action={saveWbsTrackSelectionFormAction}
                      />
                    ) : null}
                    <StationReviewForm
                      key={`${review.id ?? `review-${reviewIndex}`}-${review.updated_at}`}
                      submissionId={submission.id}
                      reviewId={
                        typeof review.id === "string" && uuidPattern.test(review.id)
                          ? review.id
                          : undefined
                      }
                      stationId={review.station_id ?? null}
                      stationCode={stationInfo?.code ?? undefined}
                      stationName={stationInfo?.name ?? undefined}
                      initialStatus={normalizeStationReviewStatus(review.status)}
                      initialMemo={review.result_note ?? ""}
                      expectedUpdatedAt={typeof review.id === "string" && uuidPattern.test(review.id) ? review.updated_at : null}
                      showAgeRating={submission.type === "MV_BROADCAST"}
                      initialAgeRating={review.age_rating ?? null}
                      trackResults={submission.type === "ALBUM" ? trackResults : []}
                      maxDecidedTracks={isWbsReview(stationInfo) && stationTracks.length > 3 ? 3 : undefined}
                      statusOptions={stationReviewStatusOptions}
                      action={updateStationReviewFormAction}
                      returnTo={adminSubmissionListHref}
                    />
                    </React.Fragment>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
                  방송국 진행 정보가 없습니다.
                </div>
              )}
            </div>
          </div>
          )}


        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-[28px] border border-border/60 bg-background/80 p-5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              자료 요약
            </p>
            <div className="mt-3 space-y-2 text-[13px] text-foreground">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <span className="text-muted-foreground">파일</span>
                <span className="font-semibold">{files.length}개</span>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/70 px-3 py-2">
                <span className="text-muted-foreground">방송국</span>
                <span className="font-semibold">
                  {completedReviewCount}/{reviews.length}
                </span>
              </div>
            </div>
            {latestEvent ? (
              <div className="mt-4 rounded-2xl border border-border/60 bg-card/70 px-3 py-3 text-xs">
                <p className="font-semibold text-foreground">최근 처리</p>
                <p className="mt-1 text-muted-foreground">
                  {latestEvent.event_type} · {formatDateTime(latestEvent.created_at)}
                </p>
              </div>
            ) : null}
          </div>

          <div className="rounded-[28px] border border-border/60 bg-background/80 p-5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              신청자
            </p>
            {hasGuestColumns && submission.guest_name ? (
              <div className="mt-3 space-y-2 text-[13px] text-muted-foreground">
                <p className="flex justify-between gap-4">
                  <span>구분</span>
                  <span className="text-right text-foreground">비회원</span>
                </p>
                <p className="flex justify-between gap-4">
                  <span>담당자</span>
                  <span className="text-right text-foreground">
                    {submission.guest_name}
                  </span>
                </p>
                {submission.guest_company ? (
                  <p className="flex justify-between gap-4">
                    <span>회사</span>
                    <span className="text-right text-foreground">
                      {submission.guest_company}
                    </span>
                  </p>
                ) : null}
                <p className="flex justify-between gap-4">
                  <span>연락처</span>
                  <span className="text-right text-foreground">
                    {submission.guest_phone ?? "-"}
                  </span>
                </p>
                <p className="flex justify-between gap-4">
                  <span>이메일</span>
                  <span className="break-all text-right text-foreground">
                    {submission.guest_email ?? submission.applicant_email ?? "-"}
                  </span>
                </p>
                {guestLookup ? (
                  <div className="mt-3 space-y-2 rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] p-3 text-[#111111]">
                    <p className="text-[11px] font-black">비회원 결과 조회</p>
                    <p className="text-[11px]">조회 코드</p>
                    <p className="select-all break-all font-mono text-xs font-bold">{guestLookup.code}</p>
                    <p className="text-[11px]">결과 페이지</p>
                    <a href={guestLookup.url} target="_blank" rel="noreferrer" className="block select-all break-all font-mono text-xs font-bold underline underline-offset-2">
                      {guestLookup.url}
                    </a>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-[13px] text-muted-foreground">
                <p className="flex justify-between gap-4">
                  <span>구분</span>
                  <span className="text-right text-foreground">회원</span>
                </p>
                <p className="flex items-center justify-between gap-4">
                  <span>가입 방법</span>
                  <SignInMethodBadges signupProvider={member.signIn?.signupProvider ?? null} providers={member.signIn?.providers ?? []} />
                </p>
                <p className="flex justify-between gap-4">
                  <span>이름</span>
                  <span className="text-right text-foreground">
                    {memberProfile?.name ?? "회원 정보 미입력"}
                  </span>
                </p>
                <p className="flex justify-between gap-4">
                  <span>회사</span>
                  <span className="text-right text-foreground">
                    {memberProfile?.company ?? "-"}
                  </span>
                </p>
                <p className="flex justify-between gap-4">
                  <span>연락처</span>
                  <span className="text-right text-foreground">
                    {memberProfile?.phone ?? "-"}
                  </span>
                </p>
                <p className="flex justify-between gap-4">
                  <span>이메일</span>
                  <span className="break-all text-right text-foreground">
                    {memberEmail ?? applicantEmail ?? "-"}
                  </span>
                </p>
              </div>
            )}
          </div>

          {adminMemo ? (
            <div className="rounded-[28px] border border-border/60 bg-background/80 p-5 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                관리자 메모
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                {adminMemo}
              </p>
            </div>
          ) : null}
        </aside>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <details
          open={!isMvSubmission && isOneclick}
          className="rounded-[28px] border border-border/60 bg-card/80 p-6 text-sm"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              신청 상세 원문
            </span>
            <span className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              펼치기
            </span>
          </summary>
          <div className="mt-4 flex justify-end">
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
              label="AI 활용 여부"
              value={aiUsageLabel(submission.ai_used)}
            />
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
                {isMvDistribution ? (
                  <DetailRow label="심의 등급" value={submission.mv_desired_rating || "-"} />
                ) : null}
                <DetailRow
                  label="곡 제목"
                  value={
                    submission.mv_song_title_official ||
                    submission.mv_song_title ||
                    submission.mv_song_title_kr ||
                    submission.mv_song_title_en ||
                    "-"
                  }
                />
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
                <DetailRow label="멜론·지니 앨범 링크" value={submission.melon_url || "-"} />
              </>
            )}
          </div>
          {!isMvSubmission ? (
            <form
              action={updateSubmissionAlbumInfoFormAction}
              method="post"
              className="mt-6 space-y-3 rounded-2xl border border-border/60 bg-background/70 p-4"
            >
              <input type="hidden" name="submissionId" value={submission.id} />
              <input type="hidden" name="returnTo" value={adminSubmissionListHref} />
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                신청서 항목 보정
              </p>
              <p className="text-xs text-muted-foreground">
                고객 결과 페이지의 작성 신청서와 심의자료에 쓰이는 항목입니다. 대리 접수나 심의 데스크 작업 내용에 맞춰 보완하세요. 고객에게 이메일을 보내지 않습니다.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">발매일</label>
                  <input name="releaseDate" type="date" defaultValue={submission.release_date?.slice(0, 10) ?? ""} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">장르</label>
                  <input name="genre" defaultValue={submission.genre ?? ""} placeholder="예: 발라드" maxLength={100} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">유통사</label>
                  <input name="distributor" defaultValue={submission.distributor ?? ""} maxLength={200} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">제작사</label>
                  <input name="productionCompany" defaultValue={submission.production_company ?? ""} maxLength={200} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">아티스트 유형</label>
                  <select name="artistType" defaultValue={submission.artist_type ?? ""} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm">
                    <option value="">선택 안 함</option>
                    <option value="SOLO">솔로</option>
                    <option value="GROUP">그룹</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">성별</label>
                  <input name="artistGender" defaultValue={submission.artist_gender ?? ""} maxLength={40} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-muted-foreground">구성/멤버</label>
                  <input name="artistMembers" defaultValue={submission.artist_members ?? ""} maxLength={1000} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs text-muted-foreground">이전 발매</label>
                  <textarea name="previousRelease" defaultValue={submission.previous_release ?? ""} rows={3} maxLength={2000} className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="rounded-full border-2 border-[#111111] bg-[#111111] px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-white transition hover:bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]"
                >
                  신청서 항목 저장
                </button>
              </div>
            </form>
          ) : null}
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
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-foreground">
                        {track.track_no}. {track.track_title || track.track_title_kr || "-"}
                        {track.is_title ? " · 타이틀" : ""}
                      </p>
                      {track.id ? (
                        <ConfirmForm
                          action={deleteTrackForSubmissionAction}
                          message="해당 트랙을 삭제하시겠습니까?"
                          className="m-0"
                        >
                          <input type="hidden" name="submissionId" value={submission.id} />
                          <input type="hidden" name="returnTo" value={adminSubmissionListHref} />
                          <input type="hidden" name="trackId" value={track.id} />
                          <button
                            type="submit"
                            className="rounded-full border border-border/60 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-foreground hover:text-foreground"
                          >
                            트랙 삭제
                          </button>
                        </ConfirmForm>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      가수 {track.performer || submission.artist_name || "-"}
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
          {!isMvSubmission && isOneclick ? (
            <div className="mt-6 space-y-3 rounded-2xl border border-border/60 bg-background/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                발매 음반 트랙 추가
              </p>
              <p className="text-xs text-muted-foreground">
                트랙을 추가한 뒤 방송국별 결과를 설정하세요.
              </p>
              <ConfirmForm
                action={createTrackForSubmissionAction}
                className="grid gap-3 md:grid-cols-[90px_1fr] lg:grid-cols-[90px_1fr_1fr_1fr]"
                message="트랙을 추가하시겠습니까?"
              >
                <input type="hidden" name="submissionId" value={submission.id} />
                <input type="hidden" name="returnTo" value={adminSubmissionListHref} />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">트랙 번호</label>
                  <input
                    name="trackNo"
                    type="number"
                    min={1}
                    defaultValue={albumTracks.length > 0 ? albumTracks.length + 1 : 1}
                    className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">트랙명</label>
                  <input
                    name="trackTitle"
                    required
                    placeholder="곡 제목"
                    className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">가수명</label>
                  <input
                    name="performer"
                    defaultValue={submission.artist_name || ""}
                    placeholder="가수명"
                    className="w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">크레딧(선택)</label>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      name="composer"
                      placeholder="작곡"
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm"
                    />
                    <input
                      name="lyricist"
                      placeholder="작사"
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm"
                    />
                    <input
                      name="arranger"
                      placeholder="편곡"
                      className="rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end md:col-span-2 lg:col-span-4">
                  <button
                    type="submit"
                    className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background"
                  >
                    트랙 추가
                  </button>
                </div>
              </ConfirmForm>
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
        </details>

        <details className="rounded-[28px] border border-border/60 bg-background/80 p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              처리 로그
            </span>
            <span className="rounded-full border border-border/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              펼치기
            </span>
          </summary>
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
        </details>
      </div>
    </div>
  );
}

type DetailRowProps = {
  label: string;
  value: string | number | null;
};

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-foreground">{value ?? "-"}</p>
    </div>
  );
}

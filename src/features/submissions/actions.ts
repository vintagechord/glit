"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";

import { getAlbumReviewDiscountPercent } from "@/lib/album-discount-server";
import { getDiscountedAlbumPrice } from "@/lib/album-pricing";
import {
  type AlbumPriceTier,
  getAdditionalAlbumPriceKrw,
} from "@/lib/album-payment-discount";
import { B2ConfigError, getB2Config } from "@/lib/b2";
import {
  sendSubmissionBankRequestEmail,
  sendSubmissionReceiptEmail,
} from "@/lib/email";
import { ensureArtistByName } from "@/lib/artist";
import { APP_CONFIG } from "@/lib/config";
import { clearDashboardStatusCache } from "@/lib/dashboard-status";
import { canEditSubmission } from "@/lib/submission-edit-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { isApplicationFormFile } from "@/lib/submission-files";
import {
  cleanupUnreferencedSubmissionB2Objects,
  loadSubmissionB2ObjectRefs,
  type SubmissionB2ObjectRef,
} from "@/lib/submission-file-cleanup";
import { isSubmissionObjectKeyOwned } from "@/lib/submission-object-key";
import { resolveSubmissionSaveState } from "@/lib/submission-save-staging";
import {
  validateAlbumSubmittedFields,
  validateMvSubmittedFields,
  validateSubmittedFiles,
} from "@/lib/submission-required-fields";
import {
  MV_BASE_ONLINE_PRICE_KRW,
  MV_STATION_PRICE_KRW,
  resolveCanonicalAlbumStationSelection,
  resolveCanonicalMvStationSelection,
} from "@/lib/submission-station-selection";
import { buildUrl, getBaseUrl } from "@/lib/url";

export type SubmissionActionState = {
  error?: string;
  submissionId?: string;
  guestToken?: string;
  emailNotice?: string;
};

export type SubmissionFileUrlActionState = {
  error?: string;
  url?: string;
};

type SupabaseError = {
  code?: string | null;
  message?: string | null;
};

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

type EditableSubmissionRow = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  status: string | null;
  payment_status: string | null;
  updated_at: string | null;
  package_id: string | null;
  amount_krw: number | null;
  album_base_price_krw: number | null;
  album_price_tier: string | null;
  is_oneclick: boolean | null;
};

const albumOneClickPriceMap: Record<number, number> = {
  7: 100000,
  10: 130000,
  13: 150000,
  15: 170000,
};

const albumAdditionalDiscountWindowMs = 30 * 60 * 1000;

const hasRecentBaseAlbumForDiscount = async ({
  db,
  packageId,
  submissionId,
  userId,
  guestToken,
  basePriceKrw,
  isOneClick,
}: {
  db: ReturnType<typeof createAdminClient>;
  packageId: string;
  submissionId: string;
  userId?: string | null;
  guestToken?: string | null;
  basePriceKrw: number;
  isOneClick: boolean;
}) => {
  if (!userId && !guestToken) return false;
  const cutoff = new Date(Date.now() - albumAdditionalDiscountWindowMs).toISOString();
  let query = db
    .from("submissions")
    .select("id")
    .eq("type", "ALBUM")
    .eq("package_id", packageId)
    .eq("is_oneclick", isOneClick)
    .eq("amount_krw", basePriceKrw)
    .eq("album_base_price_krw", basePriceKrw)
    .eq("album_price_tier", "FULL")
    .neq("id", submissionId)
    .gte("created_at", cutoff)
    .in("status", ["WAITING_PAYMENT", "IN_PROGRESS", "COMPLETED", "SUBMITTED"])
    .limit(1);

  query = userId
    ? query.eq("user_id", userId)
    : query.is("user_id", null).eq("guest_token", guestToken);
  const { data, error } = await query.maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
};

const stripColumn = <T extends Record<string, unknown>>(
  payload: T,
  column: string,
) => {
  const next = { ...payload };
  delete next[column];
  return next;
};

const releaseSubmissionSaveLease = async ({
  db,
  submissionId,
  leaseToken,
}: {
  db: SupabaseClient;
  submissionId: string;
  leaseToken: string;
}) => {
  const { data, error } = await db.rpc("release_submission_save_lease", {
    p_submission_id: submissionId,
    p_lease_token: leaseToken,
  });
  if (error || data !== true) {
    console.error("Submission save lease release failed", {
      code: error?.code,
      submissionId,
      released: data === true,
    });
  }
};

const claimSubmissionSaveLease = async ({
  db,
  submissionId,
  expectedUpdatedAt,
  expectedUserId,
  expectedGuestToken,
}: {
  db: SupabaseClient;
  submissionId: string;
  expectedUpdatedAt: string;
  expectedUserId?: string | null;
  expectedGuestToken?: string | null;
}) => {
  const leaseToken = randomUUID();
  const { data, error } = await db.rpc("claim_submission_save_lease_v2", {
    p_submission_id: submissionId,
    p_expected_updated_at: expectedUpdatedAt,
    p_expected_user_id: expectedUserId ?? null,
    p_expected_guest_token: expectedGuestToken ?? null,
    p_lease_token: leaseToken,
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        lease_token?: string;
        staged_updated_at?: string;
        recovery_required?: boolean;
      }
    | null;
  return {
    lease:
      !error && row?.lease_token === leaseToken && row.staged_updated_at
        ? { token: leaseToken, updatedAt: row.staged_updated_at }
        : null,
    recoveryRequired: !error && row?.recovery_required === true,
    error: error as SupabaseError | null,
  };
};

const formatSubmissionLeaseError = (
  error: SupabaseError | null,
  recoveryRequired = false,
) => {
  if (recoveryRequired) {
    return "중단된 저장을 안전하게 복구했습니다. 최신 내용을 다시 불러온 뒤 저장해주세요.";
  }
  const message = error?.message ?? "";
  if (
    message.includes("SUBMISSION_SAVE_IN_PROGRESS") ||
    message.includes("SUBMISSION_SAVE_VERSION_CHANGED")
  ) {
    return "다른 저장 요청이 진행 중입니다. 잠시 후 최신 내용을 확인해주세요.";
  }
  if (message.includes("PAYMENT_IN_PROGRESS")) {
    return "결제가 진행 중인 신청서는 수정할 수 없습니다.";
  }
  return "접수 저장을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.";
};

const loadEditableSubmissionByActor = async ({
  db,
  submissionId,
  userId,
  guestToken,
}: {
  db: ReturnType<typeof createAdminClient>;
  submissionId: string;
  userId?: string | null;
  guestToken?: string | null;
}) => {
  const normalizedUserId = userId?.trim() ?? "";
  const normalizedGuestToken = guestToken?.trim() ?? "";
  const columns =
    "id, user_id, guest_token, status, payment_status, updated_at, package_id, amount_krw, album_base_price_krw, album_price_tier, is_oneclick";

  if (normalizedUserId) {
    const memberResult = await db
      .from("submissions")
      .select(columns)
      .eq("id", submissionId)
      .eq("user_id", normalizedUserId)
      .maybeSingle();
    if (memberResult.error || memberResult.data) {
      return {
        data: memberResult.data as EditableSubmissionRow | null,
        error: memberResult.error as SupabaseError | null,
      };
    }
  }

  if (!normalizedGuestToken) {
    return { data: null, error: null };
  }
  const guestResult = await db
    .from("submissions")
    .select(columns)
    .eq("id", submissionId)
    .is("user_id", null)
    .eq("guest_token", normalizedGuestToken)
    .maybeSingle();
  return {
    data: guestResult.data as EditableSubmissionRow | null,
    error: guestResult.error as SupabaseError | null,
  };
};

const scheduleReplacedSubmissionFileCleanup = (
  db: SupabaseClient,
  refs: SubmissionB2ObjectRef[],
) => {
  if (refs.length === 0) return;
  after(() => cleanupUnreferencedSubmissionB2Objects(db, refs));
};

const validateSubmissionFileObjectKeys = ({
  files,
  submissionId,
  userId,
  guestToken,
  allowClaimedGuestOwner,
}: {
  files?: Array<{ path: string }>;
  submissionId: string;
  userId?: string | null;
  guestToken?: string | null;
  allowClaimedGuestOwner: boolean;
}) => {
  if (!files || files.length === 0) return null;

  try {
    const { prefix } = getB2Config();
    const hasInvalidPath = files.some(
      (file) =>
        !isSubmissionObjectKeyOwned({
          objectKey: file.path,
          prefix,
          submissionId,
          submissionUserId: userId,
          guestToken,
          allowClaimedGuestOwner,
        }),
    );
    return hasInvalidPath ? "업로드 파일 경로를 확인할 수 없습니다." : null;
  } catch (error) {
    if (!(error instanceof B2ConfigError)) {
      console.error("Submission file ownership validation crashed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return "파일 저장소 설정을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }
};

const cancelStaleRequestedSubmissionPayments = async (
  db: ReturnType<typeof createAdminClient>,
  submissionId: string,
) => {
  const result = await db.rpc(
    "cancel_requested_submission_payments_for_edit",
    { p_submission_id: submissionId },
  );

  return { error: result.error ?? null };
};

const isMissingSessionError = (error: SupabaseError | null | undefined) => {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("auth session missing");
};

const isValidEmailFormat = (value: string) =>
  z.string().email().safeParse(value).success;

const normalizeEmailValue = (value?: string | null) =>
  value?.trim().toLowerCase() ?? "";
const adminReviewEmail =
  process.env.ADMIN_REVIEW_EMAIL ??
  process.env.NEXT_PUBLIC_ADMIN_REVIEW_EMAIL ??
  APP_CONFIG.supportEmail;
const isAdminReviewEmail = (value?: string | null) =>
  normalizeEmailValue(value) === normalizeEmailValue(adminReviewEmail);

const collectRecipientEmails = (
  ...values: Array<string | null | undefined>
) => {
  const recipients = new Set<string>();
  for (const value of values) {
    const normalized = normalizeEmailValue(value);
    if (normalized) {
      recipients.add(normalized);
    }
  }
  return Array.from(recipients);
};

const buildSubmissionEmailNotice = ({
  receiptSent,
  bankGuideSent,
}: {
  receiptSent: boolean;
  bankGuideSent: boolean;
}) => {
  if (receiptSent && bankGuideSent) {
    return "접수 완료 안내와 무통장 입금 안내 메일을 발송했습니다.";
  }
  if (receiptSent) {
    return "접수 완료 안내 메일을 발송했습니다.";
  }
  if (bankGuideSent) {
    return "무통장 입금 안내 메일을 발송했습니다.";
  }
  return undefined;
};

const recordEmailDeliveryIssue = async ({
  db,
  submissionId,
  recipientEmail,
  label,
  message,
  skipped,
}: {
  db: SupabaseClient;
  submissionId: string;
  recipientEmail: string;
  label: string;
  message?: string | null;
  skipped?: boolean;
}) => {
  const { error } = await db.from("submission_events").insert({
    submission_id: submissionId,
    actor_user_id: null,
    event_type: skipped ? "EMAIL_SEND_SKIPPED" : "EMAIL_SEND_FAILED",
    message: `${label} 메일 발송 ${skipped ? "건너뜀" : "실패"} · ${recipientEmail}${
      message ? ` · ${message}` : ""
    }`,
  });

  if (error) {
    console.warn("[Email][submission] failed to record delivery issue", {
      submissionId,
      recipientEmail,
      label,
      skipped,
      error,
    });
  }
};

type SubmissionEmailDeliveryJob = {
  recipientEmail: string;
  label: string;
  kind: "receipt" | "bank";
  send: () => Promise<{
    ok: boolean;
    skipped?: boolean;
    message?: string;
  }>;
};

const deliverSubmissionEmails = async ({
  db,
  submissionId,
  jobs,
}: {
  db: SupabaseClient;
  submissionId: string;
  jobs: SubmissionEmailDeliveryJob[];
}) => {
  const results = await Promise.allSettled(jobs.map((job) => job.send()));
  let receiptSent = false;
  let bankGuideSent = false;
  const issueWrites: Array<Promise<void>> = [];

  results.forEach((settled, index) => {
    const job = jobs[index];
    if (!job) return;

    if (settled.status === "fulfilled" && settled.value.ok) {
      if (job.kind === "receipt") receiptSent = true;
      if (job.kind === "bank") bankGuideSent = true;
      return;
    }

    issueWrites.push(
      recordEmailDeliveryIssue({
        db,
        submissionId,
        recipientEmail: job.recipientEmail,
        label: job.label,
        message:
          settled.status === "fulfilled"
            ? settled.value.message
            : "메일 발송 중 예기치 않은 오류가 발생했습니다.",
        skipped:
          settled.status === "fulfilled" ? settled.value.skipped : false,
      }),
    );
  });

  // Delivery failures are audit-only after the submission has committed.
  // Await every event write, but never turn a notification issue into a save error.
  await Promise.allSettled(issueWrites);
  return { receiptSent, bankGuideSent };
};

const loadMemberPhone = async (userId?: string | null) => {
  if (!userId) return null;
  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("phone")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[Kakao][submission] profile phone lookup failed", {
      userId,
      error,
    });
    return null;
  }
  return profile?.phone ?? null;
};

const paymentDocumentTypeValues = ["CASH_RECEIPT", "TAX_INVOICE"] as const;
const cashReceiptPurposeValues = [
  "PERSONAL_INCOME_DEDUCTION",
  "BUSINESS_EXPENSE_PROOF",
] as const;

type PaymentDocumentType = (typeof paymentDocumentTypeValues)[number];
type CashReceiptPurpose = (typeof cashReceiptPurposeValues)[number];

const normalizeDigits = (value?: string | null) =>
  (value ?? "").replace(/[^0-9]/g, "");

const koreanLetterPattern = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
const unicodeLetterPattern = /\p{L}/u;

const hasNonKoreanLyrics = (value?: string | null) => {
  for (const char of value ?? "") {
    if (!unicodeLetterPattern.test(char)) continue;
    if (!koreanLetterPattern.test(char)) return true;
  }
  return false;
};

const validateBankPaymentDocument = (params: {
  isSubmitted: boolean;
  paymentMethod: "BANK" | "CARD";
  paymentDocumentType?: PaymentDocumentType;
  cashReceiptPurpose?: CashReceiptPurpose;
  cashReceiptPhone?: string;
  cashReceiptBusinessNumber?: string;
  taxInvoiceBusinessNumber?: string;
}) => {
  if (!params.isSubmitted || params.paymentMethod !== "BANK") {
    return null;
  }
  if (!params.paymentDocumentType) {
    return null;
  }

  if (params.paymentDocumentType === "CASH_RECEIPT") {
    if (!params.cashReceiptPurpose) {
      return "현금 영수증 발급 용도를 선택해주세요.";
    }
    if (params.cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION") {
      const phone = normalizeDigits(params.cashReceiptPhone);
      if (!phone) {
        return "현금 영수증(개인소득공제용) 휴대폰 번호를 입력해주세요.";
      }
      if (phone.length < 9 || phone.length > 11) {
        return "현금 영수증 휴대폰 번호 형식을 확인해주세요.";
      }
      return null;
    }
    const businessNumber = normalizeDigits(params.cashReceiptBusinessNumber);
    if (!businessNumber) {
      return "현금 영수증(사업자지출증빙용) 사업자번호를 입력해주세요.";
    }
    if (businessNumber.length !== 10) {
      return "사업자번호는 숫자 10자리로 입력해주세요.";
    }
    return null;
  }

  const taxBusinessNumber = normalizeDigits(params.taxInvoiceBusinessNumber);
  if (!taxBusinessNumber) {
    return "세금계산서 발급용 사업자번호를 입력해주세요.";
  }
  if (taxBusinessNumber.length !== 10) {
    return "사업자번호는 숫자 10자리로 입력해주세요.";
  }
  return null;
};

const MAX_SUBMISSION_AMOUNT_KRW = 100_000_000;
const MAX_STATION_SELECTIONS = 20;
const MAX_ALBUM_TRACKS = 100;
const MAX_SUBMISSION_FILES = 100;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const shortTextSchema = z.string().max(500);
const metadataTextSchema = z.string().max(2_000);
const narrativeTextSchema = z.string().max(200_000);
const urlTextSchema = z.string().max(2_048);
const contactTextSchema = z.string().max(320);

const trackSchema = z.object({
  trackTitle: shortTextSchema.optional(),
  trackTitleKr: shortTextSchema.optional(),
  trackTitleEn: shortTextSchema.optional(),
  trackTitleOfficial: z.enum(["KR", "EN"]).optional(),
  performer: metadataTextSchema.optional(),
  featuring: metadataTextSchema.optional(),
  composer: metadataTextSchema.optional(),
  lyricist: metadataTextSchema.optional(),
  arranger: metadataTextSchema.optional(),
  lyrics: narrativeTextSchema.optional(),
  translatedLyrics: narrativeTextSchema.optional(),
  notes: z.string().max(20_000).optional(),
  isTitle: z.boolean().optional(),
  titleRole: z.enum(["MAIN", "SUB"]).optional(),
  broadcastSelected: z.boolean().optional(),
});

const fileSchema = z.object({
  path: z.string().min(1).max(1_024),
  originalName: z.string().min(1).max(500),
  mime: z.string().max(255).optional(),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  checksum: z.string().max(256).optional(),
  durationSeconds: z.number().finite().nonnegative().max(86_400).optional(),
  accessUrl: urlTextSchema.optional(),
});

const albumSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  albumDraftGroupId: z.string().uuid().optional(),
  albumDraftGroupGuestToken: z.string().min(8).max(120).optional(),
  packageId: z.string().uuid().optional(),
  amountKrw: z.number().int().nonnegative().max(MAX_SUBMISSION_AMOUNT_KRW).optional(),
  selectedStationIds: z
    .array(z.string().uuid())
    .max(MAX_STATION_SELECTIONS)
    .optional(),
  title: shortTextSchema.optional(),
  artistName: shortTextSchema.optional(),
  artistNameKr: shortTextSchema.optional(),
  artistNameEn: shortTextSchema.optional(),
  releaseDate: z.string().max(64).optional(),
  genre: shortTextSchema.optional(),
  distributor: shortTextSchema.optional(),
  productionCompany: shortTextSchema.optional(),
  applicantName: shortTextSchema.optional(),
  applicantEmail: contactTextSchema.optional(),
  applicantPhone: z.string().max(64).optional(),
  previousRelease: metadataTextSchema.optional(),
  artistType: z.string().max(64).optional(),
  artistGender: z.string().max(64).optional(),
  artistMembers: metadataTextSchema.optional(),
  isOneClick: z.boolean().optional(),
  melonUrl: urlTextSchema.optional(),
  aiUsed: z.boolean().optional(),
  guestToken: z.string().min(8).max(120).optional(),
  guestName: shortTextSchema.optional(),
  guestCompany: shortTextSchema.optional(),
  guestEmail: contactTextSchema.optional(),
  guestPhone: z.string().max(64).optional(),
  preReviewRequested: z.boolean().optional(),
  karaokeRequested: z.boolean().optional(),
  paymentMethod: z.enum(["CARD", "BANK"]).optional(),
  bankDepositorName: shortTextSchema.optional(),
  paymentDocumentType: z.enum(paymentDocumentTypeValues).optional(),
  cashReceiptPurpose: z.enum(cashReceiptPurposeValues).optional(),
  cashReceiptPhone: z.string().max(64).optional(),
  cashReceiptBusinessNumber: z.string().max(64).optional(),
  taxInvoiceBusinessNumber: z.string().max(64).optional(),
  deferPayment: z.boolean().optional(),
  status: z.enum(["DRAFT", "PRE_REVIEW", "SUBMITTED"]),
  tracks: z.array(trackSchema).max(MAX_ALBUM_TRACKS).optional(),
  files: z.array(fileSchema).max(MAX_SUBMISSION_FILES).optional(),
  filesSubmittedByEmail: z.boolean().optional(),
  applicationFormMode: z.enum(["online", "upload"]).nullable().optional(),
  externalApplicationForm: z.boolean().optional(),
});

const mvSubmissionSchema = z.object({
  submissionId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  amountKrw: z.number().int().nonnegative().max(MAX_SUBMISSION_AMOUNT_KRW).optional(),
  selectedStationIds: z
    .array(z.string().uuid())
    .max(MAX_STATION_SELECTIONS)
    .optional(),
  selectedStationCodes: z
    .array(z.string().max(32))
    .max(MAX_STATION_SELECTIONS)
    .optional(),
  title: shortTextSchema.optional(),
  artistName: shortTextSchema.optional(),
  applicantEmail: contactTextSchema.optional(),
  director: shortTextSchema.optional(),
  leadActor: metadataTextSchema.optional(),
  storyline: narrativeTextSchema.optional(),
  productionCompany: shortTextSchema.optional(),
  agency: shortTextSchema.optional(),
  albumTitle: shortTextSchema.optional(),
  productionDate: z.string().max(64).optional(),
  distributionCompany: shortTextSchema.optional(),
  businessRegNo: z.string().max(64).optional(),
  usage: metadataTextSchema.optional(),
  desiredRating: z.string().max(64).optional(),
  memo: z.string().max(20_000).optional(),
  songTitle: shortTextSchema.optional(),
  songTitleKr: shortTextSchema.optional(),
  songTitleEn: shortTextSchema.optional(),
  songTitleOfficial: shortTextSchema.optional(),
  composer: metadataTextSchema.optional(),
  lyricist: metadataTextSchema.optional(),
  arranger: metadataTextSchema.optional(),
  songMemo: z.string().max(20_000).optional(),
  lyrics: narrativeTextSchema.optional(),
  artistNameOfficial: shortTextSchema.optional(),
  releaseDate: z.string().max(64).optional(),
  genre: shortTextSchema.optional(),
  mvType: z.enum(["MV_DISTRIBUTION", "MV_BROADCAST"]),
  runtime: z.string().max(64).optional(),
  format: z.string().max(128).optional(),
  mvBaseSelected: z.boolean().optional(),
  aiUsed: z.boolean().optional(),
  guestToken: z.string().min(8).max(120).optional(),
  guestName: shortTextSchema.optional(),
  guestCompany: shortTextSchema.optional(),
  guestEmail: contactTextSchema.optional(),
  guestPhone: z.string().max(64).optional(),
  preReviewRequested: z.boolean().optional(),
  karaokeRequested: z.boolean().optional(),
  paymentMethod: z.enum(["CARD", "BANK"]).optional(),
  bankDepositorName: shortTextSchema.optional(),
  paymentDocumentType: z.enum(paymentDocumentTypeValues).optional(),
  cashReceiptPurpose: z.enum(cashReceiptPurposeValues).optional(),
  cashReceiptPhone: z.string().max(64).optional(),
  cashReceiptBusinessNumber: z.string().max(64).optional(),
  taxInvoiceBusinessNumber: z.string().max(64).optional(),
  deferPayment: z.boolean().optional(),
  status: z.enum(["DRAFT", "PRE_REVIEW", "SUBMITTED"]),
  files: z.array(fileSchema).max(MAX_SUBMISSION_FILES).optional(),
  filesSubmittedByEmail: z.boolean().optional(),
  applicationFormMode: z.enum(["online", "upload"]).nullable().optional(),
  externalApplicationForm: z.boolean().optional(),
});

const submissionFileUrlSchema = z.object({
  submissionId: z.string().uuid(),
  fileId: z.string().uuid(),
  guestToken: z.string().min(8).max(120).optional(),
});

export async function getSubmissionFileUrlAction(
  payload: z.infer<typeof submissionFileUrlSchema>,
): Promise<SubmissionFileUrlActionState> {
  const parsed = submissionFileUrlSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "파일 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isMissingSessionError(userError)) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  if (user) {
    const { data: ownedSubmission } = await supabase
      .from("submissions")
      .select("id, user_id, guest_token")
      .eq("id", parsed.data.submissionId)
      .maybeSingle();
    if (!ownedSubmission) {
      return { error: "접근 권한이 없습니다." };
    }

    const { data: fileRow } = await supabase
      .from("submission_files")
      .select("file_path, storage_provider, object_key")
      .eq("id", parsed.data.fileId)
      .eq("submission_id", parsed.data.submissionId)
      .maybeSingle();

    if (!fileRow?.file_path && !fileRow?.object_key) {
      return { error: "파일을 찾을 수 없습니다." };
    }

    if (fileRow.storage_provider === "b2" && fileRow.object_key) {
      try {
        const b2 = await import("@/lib/b2");
        if (
          !isSubmissionObjectKeyOwned({
            objectKey: fileRow.object_key,
            prefix: b2.getB2Config().prefix,
            submissionId: parsed.data.submissionId,
            submissionUserId: ownedSubmission.user_id,
            guestToken: ownedSubmission.guest_token,
            allowClaimedGuestOwner: Boolean(ownedSubmission.user_id),
          })
        ) {
          return { error: "파일 경로에 대한 접근 권한이 없습니다." };
        }
        const url = await b2.presignGetUrl(fileRow.object_key, 300);
        return { url };
      } catch (error) {
        const b2 = await import("@/lib/b2");
        if (error instanceof b2.B2ConfigError) {
          return {
            error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.",
          };
        }
        return { error: "다운로드 링크를 생성할 수 없습니다." };
      }
    }

    const { data, error } = await supabase.storage
      .from("submissions")
      .createSignedUrl(fileRow.file_path, 60 * 10);

    if (error || !data?.signedUrl) {
      return { error: "다운로드 링크를 생성할 수 없습니다." };
    }

    return { url: data.signedUrl };
  }

  if (!parsed.data.guestToken) {
    return { error: "접근 권한이 없습니다." };
  }

  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("submissions")
    .select("id, guest_token")
    .eq("id", parsed.data.submissionId)
    .is("user_id", null)
    .eq("guest_token", parsed.data.guestToken)
    .maybeSingle();

  if (!submission || submission.guest_token !== parsed.data.guestToken) {
    return { error: "접근 권한이 없습니다." };
  }

  const { data: fileRow } = await admin
    .from("submission_files")
    .select("file_path, storage_provider, object_key")
    .eq("id", parsed.data.fileId)
    .eq("submission_id", parsed.data.submissionId)
    .maybeSingle();

  if (!fileRow?.file_path && !fileRow?.object_key) {
    return { error: "파일을 찾을 수 없습니다." };
  }

  if (fileRow.storage_provider === "b2" && fileRow.object_key) {
    try {
      const b2 = await import("@/lib/b2");
      if (
        !isSubmissionObjectKeyOwned({
          objectKey: fileRow.object_key,
          prefix: b2.getB2Config().prefix,
          submissionId: parsed.data.submissionId,
          guestToken: submission.guest_token,
        })
      ) {
        return { error: "파일 경로에 대한 접근 권한이 없습니다." };
      }
      const url = await b2.presignGetUrl(fileRow.object_key, 300);
      return { url };
    } catch (error) {
      const b2 = await import("@/lib/b2");
      if (error instanceof b2.B2ConfigError) {
        return {
          error: "파일 저장소가 아직 설정되지 않았습니다. 관리자에게 문의해주세요.",
        };
      }
      return { error: "다운로드 링크를 생성할 수 없습니다." };
    }
  }

  const { data, error } = await admin.storage
    .from("submissions")
    .createSignedUrl(fileRow.file_path, 60 * 10);

  if (error || !data?.signedUrl) {
    return { error: "다운로드 링크를 생성할 수 없습니다." };
  }

  return { url: data.signedUrl };
}

export async function saveAlbumSubmissionAction(
  payload: z.infer<typeof albumSubmissionSchema>,
): Promise<SubmissionActionState> {
  const parsed = albumSubmissionSchema.safeParse(payload);

  if (!parsed.success) {
    return { error: "입력값을 다시 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isMissingSessionError(userError)) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  const isGuest = !user;
  const isSubmitted = parsed.data.status === "SUBMITTED";
  const deferPayment = isSubmitted && parsed.data.deferPayment === true;
  const isAdminReviewer = isAdminReviewEmail(user?.email);
  const isOneClick = parsed.data.isOneClick ?? false;
  const externalApplicationFormRequested =
    parsed.data.applicationFormMode === "upload" ||
    parsed.data.externalApplicationForm === true;
  if (isOneClick && externalApplicationFormRequested) {
    return { error: "원클릭 접수와 파일 제출 방식은 함께 선택할 수 없습니다." };
  }
  const applicationFormMode = isOneClick
    ? "online"
    : externalApplicationFormRequested
      ? "upload"
      : parsed.data.applicationFormMode === "online"
        ? "online"
        : isSubmitted
          ? "online"
          : null;
  const usesExternalApplicationForm = applicationFormMode === "upload";
  const titleValue = parsed.data.title?.trim() ?? "";
  const artistNameValue = parsed.data.artistName?.trim() ?? "";
  const guestNameValue = parsed.data.guestName?.trim() ?? "";
  const guestEmailValue = parsed.data.guestEmail?.trim() ?? "";
  const guestPhoneValue = parsed.data.guestPhone?.trim() ?? "";
  const applicantNameValue = parsed.data.applicantName?.trim() ?? "";
  const applicantEmailValue = parsed.data.applicantEmail?.trim() ?? "";
  const applicantPhoneValue = parsed.data.applicantPhone?.trim() ?? "";
  const bankDepositorNameValue = parsed.data.bankDepositorName?.trim() ?? "";
  const paymentDocumentType = parsed.data.paymentDocumentType;
  const cashReceiptPurpose = parsed.data.cashReceiptPurpose;
  const cashReceiptPhoneValue = parsed.data.cashReceiptPhone?.trim() ?? "";
  const cashReceiptBusinessNumberDigits = normalizeDigits(
    parsed.data.cashReceiptBusinessNumber,
  );
  const taxInvoiceBusinessNumberDigits = normalizeDigits(
    parsed.data.taxInvoiceBusinessNumber,
  );
  const paymentMethod = parsed.data.paymentMethod ?? "BANK";

  if (isGuest && !parsed.data.guestToken) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }
  if (
    isSubmitted &&
    isGuest &&
    !usesExternalApplicationForm &&
    (!guestNameValue || !guestEmailValue || !guestPhoneValue)
  ) {
    return { error: "비회원 정보(담당자, 연락처, 이메일)를 입력해주세요." };
  }
  if (
    isSubmitted &&
    isGuest &&
    guestEmailValue &&
    !isValidEmailFormat(guestEmailValue)
  ) {
    return { error: "비회원 이메일 형식을 확인해주세요." };
  }
  if (
    isSubmitted &&
    applicantEmailValue &&
    !isValidEmailFormat(applicantEmailValue)
  ) {
    return { error: "접수자 이메일 형식을 확인해주세요." };
  }

  const adminDb = createAdminClient();
  const { data: existingSubmission, error: existingSubmissionError } =
    await loadEditableSubmissionByActor({
      db: adminDb,
      submissionId: parsed.data.submissionId,
      userId: user?.id,
      guestToken: parsed.data.guestToken,
    });
  if (existingSubmissionError) {
    console.error("Submission ownership lookup failed", existingSubmissionError);
    return { error: "접수 소유권을 확인할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }
  if (
    !canEditSubmission(existingSubmission, {
      userId: user?.id,
      guestToken: parsed.data.guestToken,
    })
  ) {
    return { error: "접수 수정 권한을 확인할 수 없습니다." };
  }
  if (!existingSubmission?.updated_at) {
    return { error: "접수 저장 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }
  const wasPreviouslySubmitted = ["SUBMITTED", "WAITING_PAYMENT"].includes(
    existingSubmission.status ?? "",
  );
  const albumDraftGroupId =
    parsed.data.albumDraftGroupId ?? parsed.data.submissionId;
  if (albumDraftGroupId !== parsed.data.submissionId) {
    let groupBaseQuery = adminDb
      .from("submissions")
      .select("id, album_draft_group_id")
      .eq("id", albumDraftGroupId)
      .eq("type", "ALBUM")
      .eq("album_price_tier", "FULL")
      .in("status", ["DRAFT", "PRE_REVIEW", "SUBMITTED", "WAITING_PAYMENT"])
      .eq("payment_status", "UNPAID");
    if (user?.id) {
      groupBaseQuery = groupBaseQuery.eq("user_id", user.id);
    } else {
      groupBaseQuery = groupBaseQuery
        .is("user_id", null)
        .eq(
          "guest_token",
          parsed.data.albumDraftGroupGuestToken ?? "__missing__",
        );
    }
    const { data: groupBase, error: groupBaseError } =
      await groupBaseQuery.maybeSingle();
    if (
      groupBaseError ||
      !groupBase ||
      (groupBase.album_draft_group_id &&
        groupBase.album_draft_group_id !== albumDraftGroupId)
    ) {
      return { error: "추가 앨범 묶음 소유권을 확인할 수 없습니다." };
    }
  }
  let expectedParentVersion = {
    updatedAt: existingSubmission.updated_at,
    userId: existingSubmission.user_id,
    guestToken: existingSubmission.guest_token,
  };
  const fileOwnershipError = validateSubmissionFileObjectKeys({
    files: parsed.data.files,
    submissionId: parsed.data.submissionId,
    userId: user?.id ?? null,
    guestToken: parsed.data.guestToken ?? null,
    allowClaimedGuestOwner: Boolean(
      user?.id && existingSubmission?.user_id === user.id,
    ),
  });
  if (fileOwnershipError) {
    return { error: fileOwnershipError };
  }
  const db = adminDb;
  let effectiveSubmissionFiles = parsed.data.files ?? [];
  if (
    isSubmitted &&
    parsed.data.files === undefined &&
    !parsed.data.filesSubmittedByEmail
  ) {
    const { data: existingFiles, error: existingFilesError } = await db
      .from("submission_files")
      .select("original_name, mime")
      .eq("submission_id", parsed.data.submissionId)
      .eq("kind", "AUDIO");
    if (existingFilesError) {
      return { error: "기존 파일 정보를 확인할 수 없습니다." };
    }
    effectiveSubmissionFiles = (existingFiles ?? []).map((file) => ({
      path: "",
      originalName: file.original_name ?? "",
      mime: file.mime ?? undefined,
      size: 0,
    }));
  }
  if (isSubmitted) {
    const submittedFilesError = validateSubmittedFiles({
      kind: "ALBUM",
      isAdminReviewer,
      filesSubmittedByEmail: Boolean(parsed.data.filesSubmittedByEmail),
      externalApplicationForm: usesExternalApplicationForm,
      files: effectiveSubmissionFiles,
    });
    if (submittedFilesError) return { error: submittedFilesError };
  }
  const albumDiscountPercent = await getAlbumReviewDiscountPercent(adminDb);

  const hasPackage = Boolean(parsed.data.packageId);
  let amountKrw = parsed.data.amountKrw ?? 0;
  let packageStationCount: number | null = null;
  let serverBasePriceKrw = 0;
  let albumPriceTier: AlbumPriceTier | null = null;
  let canonicalAlbumStationIds: string[] = [];

  if (isSubmitted && !parsed.data.packageId) {
    return { error: "패키지 정보를 확인할 수 없습니다." };
  }

  if (hasPackage && parsed.data.packageId) {
    const { data: selectedPackage, error: packageError } = await db
      .from("packages")
      .select("price_krw, station_count")
      .eq("id", parsed.data.packageId)
      .eq("is_active", true)
      .maybeSingle();

    if (packageError || !selectedPackage) {
      return { error: "패키지 정보를 확인할 수 없습니다." };
    }
    packageStationCount = selectedPackage.station_count ?? null;

    if (isSubmitted) {
      const { data: packageStations, error: packageStationsError } = await db
        .from("package_stations")
        .select("station_id")
        .eq("package_id", parsed.data.packageId);
      if (packageStationsError) {
        console.error("Album package station lookup failed", packageStationsError);
        return { error: "패키지 방송국 정보를 확인할 수 없습니다." };
      }

      const packageStationIds = Array.from(
        new Set(
          (packageStations ?? [])
            .map((station) => station.station_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const activeStationsResult =
        packageStationIds.length > 0
          ? await db
              .from("stations")
              .select("id")
              .in("id", packageStationIds)
              .eq("is_active", true)
          : { data: [], error: null };
      if (activeStationsResult.error) {
        console.error(
          "Album active package station lookup failed",
          activeStationsResult.error,
        );
        return { error: "패키지 방송국 정보를 확인할 수 없습니다." };
      }

      const stationSelection = resolveCanonicalAlbumStationSelection({
        stationIds: (activeStationsResult.data ?? []).map((station) => station.id),
        expectedCount: packageStationCount,
      });
      if (!stationSelection.ok) {
        console.error("Album package station configuration mismatch", {
          packageId: parsed.data.packageId,
          expectedCount: packageStationCount,
          configuredCount: packageStationIds.length,
          activeCount: activeStationsResult.data?.length ?? 0,
          reason: stationSelection.reason,
        });
        return { error: "패키지 방송국 구성이 올바르지 않습니다. 관리자에게 문의해주세요." };
      }
      canonicalAlbumStationIds = stationSelection.stationIds;
    }

    const serverOriginalBasePriceKrw = Math.max(
      0,
      Math.round(
        Number(
          isOneClick && packageStationCount
            ? albumOneClickPriceMap[packageStationCount] ??
              selectedPackage.price_krw
            : selectedPackage.price_krw,
        ),
      ),
    );
    serverBasePriceKrw = getDiscountedAlbumPrice(
      serverOriginalBasePriceKrw,
      albumDiscountPercent,
      packageStationCount,
    );

    if (isSubmitted) {
      const requestedAmount = Math.max(
        0,
        Math.round(Number(parsed.data.amountKrw ?? 0)),
      );
      const additionalPriceKrw = getAdditionalAlbumPriceKrw(serverBasePriceKrw);
      const requestedAdditionalDiscount =
        additionalPriceKrw > 0 && requestedAmount === additionalPriceKrw;
      const preservesExistingAdditionalTier =
        existingSubmission?.album_price_tier === "ADDITIONAL" &&
        existingSubmission.package_id === parsed.data.packageId &&
        existingSubmission.is_oneclick === isOneClick &&
        Math.round(Number(existingSubmission.amount_krw ?? 0)) ===
          additionalPriceKrw &&
        Math.round(Number(existingSubmission.album_base_price_krw ?? 0)) ===
          serverBasePriceKrw;
      // Guest submissions intentionally receive a different token per form.
      // Preserve the requested tier here so a guest can build one cart with a
      // full-price base and an additional album. The atomic payment RPC binds
      // that pair and rejects a discounted item paid on its own. Signed-in
      // users keep the recent-owner eligibility check for provisional saves.
      const hasRecentBaseAlbum =
        isGuest ||
        (additionalPriceKrw > 0 &&
          (await hasRecentBaseAlbumForDiscount({
            db: adminDb,
            packageId: parsed.data.packageId,
            submissionId: parsed.data.submissionId,
            userId: user?.id ?? null,
            guestToken: parsed.data.guestToken ?? null,
            basePriceKrw: serverBasePriceKrw,
            isOneClick,
          })));
      const canUseAdditionalDiscount =
        requestedAdditionalDiscount &&
        (preservesExistingAdditionalTier || hasRecentBaseAlbum);
      amountKrw = canUseAdditionalDiscount
        ? additionalPriceKrw
        : serverBasePriceKrw;
      albumPriceTier = canUseAdditionalDiscount ? "ADDITIONAL" : "FULL";
    } else {
      const additionalPriceKrw = getAdditionalAlbumPriceKrw(serverBasePriceKrw);
      const requestedAmount = Math.max(
        0,
        Math.round(Number(parsed.data.amountKrw ?? 0)),
      );
      const isAdditionalDraft =
        additionalPriceKrw > 0 &&
        additionalPriceKrw !== serverBasePriceKrw &&
        requestedAmount === additionalPriceKrw;
      amountKrw = isAdditionalDraft ? additionalPriceKrw : serverBasePriceKrw;
      albumPriceTier = isAdditionalDraft ? "ADDITIONAL" : "FULL";
    }
  }

  if (isSubmitted && amountKrw <= 0) {
    return { error: "결제 금액 정보를 확인할 수 없습니다." };
  }
  amountKrw = Math.max(0, amountKrw);

  if (
    isSubmitted &&
    paymentMethod === "BANK" &&
    !bankDepositorNameValue &&
    !isAdminReviewer &&
    !deferPayment
  ) {
    return { error: "입금자명을 입력해주세요." };
  }
  const bankPaymentDocumentError = isAdminReviewer
    ? null
    : validateBankPaymentDocument({
        isSubmitted: isSubmitted && !deferPayment,
        paymentMethod,
        paymentDocumentType,
        cashReceiptPurpose,
        cashReceiptPhone: cashReceiptPhoneValue,
        cashReceiptBusinessNumber: cashReceiptBusinessNumberDigits,
        taxInvoiceBusinessNumber: taxInvoiceBusinessNumberDigits,
      });
  if (bankPaymentDocumentError) {
    return { error: bankPaymentDocumentError };
  }
  const shouldRequestPayment =
    isSubmitted &&
    !deferPayment &&
    (paymentMethod === "CARD" || Boolean(bankDepositorNameValue));
  const saveState = resolveSubmissionSaveState({
    requestedStatus: parsed.data.status,
    shouldRequestPayment,
  });

  const submittedTracks = parsed.data.tracks ?? [];
  // A basic-information draft may intentionally omit tracks so an existing
  // draft can keep them intact. Final one-click/downloaded-form submissions,
  // however, must clear any rows left behind after switching application mode.
  const shouldReplaceTracks =
    parsed.data.tracks !== undefined ||
    (isSubmitted && (isOneClick || usesExternalApplicationForm));
  const trackRows = submittedTracks.map((track, index) => {
    const isSingleTrack = submittedTracks.length === 1;
    const isTitle = isSingleTrack || Boolean(track.isTitle);
    return {
      submission_id: parsed.data.submissionId,
      track_no: index + 1,
      track_title: track.trackTitle?.trim() || null,
      track_title_kr: track.trackTitleKr?.trim() || null,
      track_title_en: track.trackTitleEn?.trim() || null,
      track_title_official: track.trackTitleOfficial || null,
      performer: track.performer?.trim() || artistNameValue || null,
      featuring: track.featuring?.trim() || null,
      composer: track.composer?.trim() || null,
      lyricist: track.lyricist?.trim() || null,
      arranger: track.arranger?.trim() || null,
      lyrics: track.lyrics?.trim() || null,
      translated_lyrics: track.translatedLyrics?.trim() || null,
      notes: track.notes || null,
      is_title: isTitle,
      title_role: isSingleTrack ? "MAIN" : isTitle ? track.titleRole || "SUB" : null,
      broadcast_selected: Boolean(track.broadcastSelected),
    };
  });

  if (isSubmitted) {
    const requiredFieldsError = validateAlbumSubmittedFields({
      isAdminReviewer,
      externalApplicationForm: usesExternalApplicationForm,
      isOneClick,
      applicantName: applicantNameValue,
      applicantEmail: applicantEmailValue,
      applicantPhone: applicantPhoneValue,
      aiUsed: parsed.data.aiUsed,
      melonUrl: parsed.data.melonUrl,
      title: titleValue,
      artistName: artistNameValue,
      artistNameKr: parsed.data.artistNameKr,
      artistNameEn: parsed.data.artistNameEn,
      releaseDate: parsed.data.releaseDate,
      genre: parsed.data.genre,
      distributor: parsed.data.distributor,
      productionCompany: parsed.data.productionCompany,
      previousRelease: parsed.data.previousRelease,
      artistType: parsed.data.artistType,
      artistGender: parsed.data.artistGender,
      artistMembers: parsed.data.artistMembers,
      tracks: submittedTracks,
    });
    if (requiredFieldsError) return { error: requiredFieldsError };

    if (
      !isAdminReviewer &&
      !isOneClick &&
      trackRows.some(
        (track) =>
          hasNonKoreanLyrics(track.lyrics) &&
          !String(track.translated_lyrics ?? "").trim(),
      )
    ) {
      return {
        error: "한국어 외 언어가 포함된 가사는 번역본 가사를 함께 입력해주세요.",
      };
    }
  }

  const artistId = await ensureArtistByName(artistNameValue);

  const submissionPayload = {
    id: parsed.data.submissionId,
    user_id: user?.id ?? null,
    type: "ALBUM",
    title: titleValue || null,
    artist_name: artistNameValue || null,
    artist_id: artistId,
    artist_name_kr: parsed.data.artistNameKr?.trim() || null,
    artist_name_en: parsed.data.artistNameEn?.trim() || null,
    release_date: parsed.data.releaseDate || null,
    genre: parsed.data.genre?.trim() || null,
    distributor: parsed.data.distributor?.trim() || null,
    production_company: parsed.data.productionCompany?.trim() || null,
    applicant_name: parsed.data.applicantName?.trim() || null,
    applicant_email: applicantEmailValue || null,
    applicant_phone: parsed.data.applicantPhone?.trim() || null,
    previous_release: parsed.data.previousRelease?.trim() || null,
    artist_type: parsed.data.artistType?.trim() || null,
    artist_gender: parsed.data.artistGender?.trim() || null,
    artist_members: parsed.data.artistMembers?.trim() || null,
    is_oneclick: isOneClick,
    melon_url: parsed.data.melonUrl?.trim() || null,
    ai_used:
      typeof parsed.data.aiUsed === "boolean" ? parsed.data.aiUsed : null,
    package_id: parsed.data.packageId ?? null,
    amount_krw: amountKrw,
    album_base_price_krw:
      serverBasePriceKrw > 0 ? serverBasePriceKrw : null,
    album_price_tier: albumPriceTier,
    album_discount_base_submission_id: null,
    album_draft_group_id: albumDraftGroupId,
    guest_name: isGuest ? guestNameValue || null : null,
    guest_company: isGuest ? parsed.data.guestCompany?.trim() || null : null,
    guest_email: isGuest ? guestEmailValue || null : null,
    guest_phone: isGuest ? guestPhoneValue || null : null,
    guest_token: isGuest ? parsed.data.guestToken : null,
    pre_review_requested: parsed.data.preReviewRequested ?? false,
    karaoke_requested: parsed.data.karaokeRequested ?? false,
    payment_method: paymentMethod,
    bank_depositor_name:
      paymentMethod === "BANK" ? bankDepositorNameValue || null : null,
    payment_document_type:
      paymentMethod === "BANK" ? paymentDocumentType ?? null : null,
    cash_receipt_purpose:
      paymentMethod === "BANK" && paymentDocumentType === "CASH_RECEIPT"
        ? cashReceiptPurpose ?? null
        : null,
    cash_receipt_phone:
      paymentMethod === "BANK" &&
      paymentDocumentType === "CASH_RECEIPT" &&
      cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
        ? normalizeDigits(cashReceiptPhoneValue) || null
        : null,
    cash_receipt_business_number:
      paymentMethod === "BANK" &&
      paymentDocumentType === "CASH_RECEIPT" &&
      cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
        ? cashReceiptBusinessNumberDigits || null
        : null,
    tax_invoice_business_number:
      paymentMethod === "BANK" && paymentDocumentType === "TAX_INVOICE"
        ? taxInvoiceBusinessNumberDigits || null
        : null,
    application_form_mode: applicationFormMode,
    files_submitted_by_email: Boolean(parsed.data.filesSubmittedByEmail),
    status: saveState.finalStatus,
    payment_status: saveState.finalPaymentStatus,
  };
  const finalSubmissionState = {
    status: submissionPayload.status,
    paymentStatus: submissionPayload.payment_status,
  };

  if (parsed.data.status === "SUBMITTED") {
    const stalePaymentResult = await cancelStaleRequestedSubmissionPayments(
      adminDb,
      parsed.data.submissionId,
    );
    if (stalePaymentResult.error) {
      console.error("Stale submission payment cleanup failed", stalePaymentResult.error);
      return { error: "기존 결제 요청을 정리하지 못했습니다. 잠시 후 다시 시도해주세요." };
    }

    const { data: refreshedSubmission, error: refreshedSubmissionError } =
      await loadEditableSubmissionByActor({
        db: adminDb,
        submissionId: parsed.data.submissionId,
        userId: user?.id,
        guestToken: parsed.data.guestToken,
      });
    if (
      refreshedSubmissionError ||
      !canEditSubmission(refreshedSubmission, {
        userId: user?.id,
        guestToken: parsed.data.guestToken,
      }) ||
      !refreshedSubmission?.updated_at
    ) {
      console.error(
        "Submission ownership recheck failed after payment cleanup",
        refreshedSubmissionError,
      );
      return { error: "결제 상태가 변경되어 접수를 수정할 수 없습니다." };
    }
    expectedParentVersion = {
      updatedAt: refreshedSubmission.updated_at,
      userId: refreshedSubmission.user_id,
      guestToken: refreshedSubmission.guest_token,
    };
  }

  const atomicParentPayload = stripColumn(
    stripColumn(stripColumn(submissionPayload, "id"), "status"),
    "payment_status",
  );
  const leaseResult = await claimSubmissionSaveLease({
    db,
    submissionId: parsed.data.submissionId,
    expectedUpdatedAt: expectedParentVersion.updatedAt,
    expectedUserId: expectedParentVersion.userId,
    expectedGuestToken: expectedParentVersion.guestToken,
  });
  if (!leaseResult.lease) {
    console.error("Submission save lease claim failed", {
      code: leaseResult.error?.code,
      submissionId: parsed.data.submissionId,
    });
    return {
      error: formatSubmissionLeaseError(
        leaseResult.error,
        leaseResult.recoveryRequired,
      ),
    };
  }

  let replacedFileRefs: SubmissionB2ObjectRef[] = [];
  if (parsed.data.files !== undefined) {
    replacedFileRefs = await loadSubmissionB2ObjectRefs(db, [
      parsed.data.submissionId,
    ]);
  }
  const fileRows = (parsed.data.files ?? []).map((file) => ({
    file_path: file.path,
    object_key: file.path,
    uploaded_at: new Date().toISOString(),
    original_name: file.originalName,
    mime: file.mime || null,
    size: file.size,
    checksum: file.checksum ?? null,
    duration_seconds: file.durationSeconds ?? null,
  }));
  const { data: committedRows, error: commitError } = await db.rpc(
    "commit_submission_save_v2",
    {
      p_submission_id: parsed.data.submissionId,
      p_lease_token: leaseResult.lease.token,
      p_expected_updated_at: leaseResult.lease.updatedAt,
      p_parent: atomicParentPayload,
      p_replace_tracks: shouldReplaceTracks,
      p_tracks: trackRows,
      p_replace_files: parsed.data.files !== undefined,
      p_file_kind: "AUDIO",
      p_files: fileRows,
      p_sync_reviews: isSubmitted,
      p_station_ids: canonicalAlbumStationIds,
      p_final_status: finalSubmissionState.status,
      p_final_payment_status: finalSubmissionState.paymentStatus,
    },
  );
  const committed = Array.isArray(committedRows)
    ? committedRows[0]
    : committedRows;
  if (commitError || !committed) {
    await releaseSubmissionSaveLease({
      db,
      submissionId: parsed.data.submissionId,
      leaseToken: leaseResult.lease.token,
    });
    console.error("Submission atomic commit failed", {
      code: commitError?.code,
      submissionId: parsed.data.submissionId,
    });
    return {
      error: "접수 저장이 완료되지 않았습니다. 내용을 확인한 뒤 다시 시도해주세요.",
    };
  }

  scheduleReplacedSubmissionFileCleanup(db, replacedFileRefs);

  const eventMessage =
    parsed.data.status === "SUBMITTED"
      ? deferPayment
        ? "결제 전 신청서 저장이 완료되었습니다."
        : shouldRequestPayment
        ? paymentMethod === "CARD"
          ? "카드 결제 요청이 접수되었습니다."
          : "입금 확인 요청이 접수되었습니다."
        : "심의 접수가 완료되었습니다."
      : "임시 저장이 완료되었습니다.";

  // Background checkpoints use DRAFT saves frequently. They are state
  // snapshots, not lifecycle events, so recording every keystroke-level save
  // would bury the meaningful submission history.
  if (parsed.data.status !== "DRAFT" && !wasPreviouslySubmitted) {
    await db.from("submission_events").insert({
      submission_id: parsed.data.submissionId,
      actor_user_id: user?.id ?? null,
      event_type: parsed.data.status,
      message: eventMessage,
    });
  }

  let receiptEmailSent = false;
  let bankGuideEmailSent = false;
  if (parsed.data.status === "SUBMITTED" && !wasPreviouslySubmitted) {
    const recipientEmails = collectRecipientEmails(
      applicantEmailValue,
      guestEmailValue,
      user?.email,
    );
    const baseUrl = getBaseUrl();
    const siteLink = buildUrl("/", baseUrl);
    const link =
      isGuest && parsed.data.guestToken && parsed.data.guestToken.length >= 8
        ? buildUrl(`/track/${encodeURIComponent(parsed.data.guestToken)}`, baseUrl)
        : buildUrl(`/dashboard/submissions/${parsed.data.submissionId}`, baseUrl);

    const emailJobs: SubmissionEmailDeliveryJob[] = [];
    for (const recipientEmail of recipientEmails) {
      emailJobs.push({
        recipientEmail,
        label: "접수 완료 안내",
        kind: "receipt",
        send: () =>
          sendSubmissionReceiptEmail({
            email: recipientEmail,
            title: titleValue || "제목 미입력",
            kind: "ALBUM",
            submissionId: parsed.data.submissionId,
            isGuest,
            guestToken: parsed.data.guestToken ?? undefined,
            link,
            siteLink,
          }),
      });

      if (shouldRequestPayment && paymentMethod === "BANK" && amountKrw > 0) {
        emailJobs.push({
          recipientEmail,
          label: "무통장 입금 안내",
          kind: "bank",
          send: () =>
            sendSubmissionBankRequestEmail({
              email: recipientEmail,
              title: titleValue || "제목 미입력",
              artist: artistNameValue || null,
              kind: "ALBUM",
              amountKrw,
              bankDepositorName: bankDepositorNameValue || null,
              link,
              siteLink,
            }),
        });
      }
    }
    const kakaoDelivery = (async () => {
      const memberPhoneValue = isGuest ? null : await loadMemberPhone(user?.id);
      return sendKakaoOfficialNotification({
        phone:
          parsed.data.applicantPhone?.trim() ||
          guestPhoneValue ||
          memberPhoneValue,
        title: "음반 심의 접수 완료",
        message: `${titleValue || "제목 미입력"} 접수가 완료되었습니다. 진행 상황은 온사이드에서 확인할 수 있습니다.`,
        link,
      });
    })().catch((error) => {
      console.warn("[Kakao][submission] post-commit delivery failed", {
        submissionId: parsed.data.submissionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
    const emailDelivery = await deliverSubmissionEmails({
      db,
      submissionId: parsed.data.submissionId,
      jobs: emailJobs,
    });
    receiptEmailSent = emailDelivery.receiptSent;
    bankGuideEmailSent = emailDelivery.bankGuideSent;
    await kakaoDelivery;
  }

  if (user?.id) {
    clearDashboardStatusCache(user.id);
  }

  return {
    submissionId: parsed.data.submissionId,
    guestToken: isGuest ? parsed.data.guestToken : undefined,
    emailNotice: buildSubmissionEmailNotice({
      receiptSent: receiptEmailSent,
      bankGuideSent: bankGuideEmailSent,
    }),
  };
}

export async function saveMvSubmissionAction(
  payload: z.infer<typeof mvSubmissionSchema>,
): Promise<SubmissionActionState> {
  const parsed = mvSubmissionSchema.safeParse(payload);

  if (!parsed.success) {
    return { error: "입력값을 다시 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isMissingSessionError(userError)) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }

  const isGuest = !user;
  const isSubmitted = parsed.data.status === "SUBMITTED";
  const deferPayment = isSubmitted && parsed.data.deferPayment === true;
  const isAdminReviewer = isAdminReviewEmail(user?.email);
  const titleValue = parsed.data.title?.trim() ?? "";
  const artistNameValue = parsed.data.artistName?.trim() ?? "";
  const guestNameValue = parsed.data.guestName?.trim() ?? "";
  const guestEmailValue = parsed.data.guestEmail?.trim() ?? "";
  const guestPhoneValue = parsed.data.guestPhone?.trim() ?? "";
  const applicantEmailValue = parsed.data.applicantEmail?.trim() ?? "";
  const bankDepositorNameValue = parsed.data.bankDepositorName?.trim() ?? "";
  const paymentDocumentType = parsed.data.paymentDocumentType;
  const cashReceiptPurpose = parsed.data.cashReceiptPurpose;
  const hasApplicationFormAttachment =
    parsed.data.files?.some((file) => isApplicationFormFile(file.originalName)) ??
    false;
  const externalApplicationFormRequested =
    parsed.data.applicationFormMode === "upload" ||
    parsed.data.externalApplicationForm === true;
  const applicationFormMode = externalApplicationFormRequested
    ? "upload"
    : parsed.data.applicationFormMode === "online"
      ? "online"
      : isSubmitted
        ? "online"
        : null;
  const usesExternalApplicationForm = applicationFormMode === "upload";
  const cashReceiptPhoneValue = parsed.data.cashReceiptPhone?.trim() ?? "";
  const cashReceiptBusinessNumberDigits = normalizeDigits(
    parsed.data.cashReceiptBusinessNumber,
  );
  const taxInvoiceBusinessNumberDigits = normalizeDigits(
    parsed.data.taxInvoiceBusinessNumber,
  );

  if (isGuest && !parsed.data.guestToken) {
    return { error: "로그인 정보를 확인할 수 없습니다." };
  }
  if (
    isSubmitted &&
    usesExternalApplicationForm &&
    !parsed.data.filesSubmittedByEmail &&
    !hasApplicationFormAttachment
  ) {
    return { error: "작성한 신청서 파일을 업로드하거나 이메일 제출을 선택해주세요." };
  }
  if (
    isSubmitted &&
    isGuest &&
    !usesExternalApplicationForm &&
    (!guestNameValue || !guestEmailValue || !guestPhoneValue)
  ) {
    return { error: "비회원 정보(담당자, 연락처, 이메일)를 입력해주세요." };
  }
  if (
    isSubmitted &&
    isGuest &&
    guestEmailValue &&
    !isValidEmailFormat(guestEmailValue)
  ) {
    return { error: "비회원 이메일 형식을 확인해주세요." };
  }

  const adminDb = createAdminClient();
  const { data: existingSubmission, error: existingSubmissionError } =
    await loadEditableSubmissionByActor({
      db: adminDb,
      submissionId: parsed.data.submissionId,
      userId: user?.id,
      guestToken: parsed.data.guestToken,
    });
  if (existingSubmissionError) {
    console.error("MV submission ownership lookup failed", existingSubmissionError);
    return { error: "접수 소유권을 확인할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }
  if (
    !canEditSubmission(existingSubmission, {
      userId: user?.id,
      guestToken: parsed.data.guestToken,
    })
  ) {
    return { error: "접수 수정 권한을 확인할 수 없습니다." };
  }
  if (!existingSubmission?.updated_at) {
    return { error: "접수 저장 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }
  const wasPreviouslySubmitted = ["SUBMITTED", "WAITING_PAYMENT"].includes(
    existingSubmission.status ?? "",
  );
  let expectedParentVersion = {
    updatedAt: existingSubmission.updated_at,
    userId: existingSubmission.user_id,
    guestToken: existingSubmission.guest_token,
  };
  const fileOwnershipError = validateSubmissionFileObjectKeys({
    files: parsed.data.files,
    submissionId: parsed.data.submissionId,
    userId: user?.id ?? null,
    guestToken: parsed.data.guestToken ?? null,
    allowClaimedGuestOwner: Boolean(
      user?.id && existingSubmission?.user_id === user.id,
    ),
  });
  if (fileOwnershipError) {
    return { error: fileOwnershipError };
  }
  const db = adminDb;
  let effectiveSubmissionFiles = parsed.data.files ?? [];
  if (
    isSubmitted &&
    parsed.data.files === undefined &&
    !parsed.data.filesSubmittedByEmail
  ) {
    const { data: existingFiles, error: existingFilesError } = await db
      .from("submission_files")
      .select("original_name, mime")
      .eq("submission_id", parsed.data.submissionId)
      .eq("kind", "VIDEO");
    if (existingFilesError) {
      return { error: "기존 파일 정보를 확인할 수 없습니다." };
    }
    effectiveSubmissionFiles = (existingFiles ?? []).map((file) => ({
      path: "",
      originalName: file.original_name ?? "",
      mime: file.mime ?? undefined,
      size: 0,
    }));
  }
  if (isSubmitted) {
    const submittedFilesError = validateSubmittedFiles({
      kind: "MV",
      isAdminReviewer,
      filesSubmittedByEmail: Boolean(parsed.data.filesSubmittedByEmail),
      externalApplicationForm: usesExternalApplicationForm,
      files: effectiveSubmissionFiles,
    });
    if (submittedFilesError) return { error: submittedFilesError };
  }
  let canonicalMvStationIds: string[] = [];

  let amountKrw = Math.max(0, Math.round(Number(parsed.data.amountKrw ?? 0)));
  if (isSubmitted) {
    const { data: canonicalStations, error: stationError } = await adminDb
      .from("stations")
      .select("id, code")
      .in("code", Object.keys(MV_STATION_PRICE_KRW))
      .eq("is_active", true);
    if (stationError) {
      console.error("MV canonical station lookup failed", stationError);
      return { error: "선택한 방송국 정보를 확인할 수 없습니다." };
    }

    const stationSelection = resolveCanonicalMvStationSelection({
      mvType: parsed.data.mvType,
      requestedCodes: parsed.data.selectedStationCodes,
      requestedIds: parsed.data.selectedStationIds,
      stations: (canonicalStations ?? []).flatMap((station) =>
        station.id && station.code
          ? [{ id: station.id, code: station.code }]
          : [],
      ),
    });
    if (!stationSelection.ok) {
      console.warn("MV station selection validation failed", {
        submissionId: parsed.data.submissionId,
        reason: stationSelection.reason,
      });
      return { error: "선택한 방송국 정보가 일치하지 않습니다. 다시 선택해주세요." };
    }

    canonicalMvStationIds = stationSelection.stationIds;
    const baseAmountKrw =
      parsed.data.mvType === "MV_DISTRIBUTION" &&
      (parsed.data.mvBaseSelected ?? true)
        ? MV_BASE_ONLINE_PRICE_KRW
        : 0;
    amountKrw = baseAmountKrw + stationSelection.stationAmountKrw;
  }
  if (isSubmitted && amountKrw <= 0) {
    return { error: "결제 금액 정보를 확인할 수 없습니다." };
  }
  const songTitleValue =
    parsed.data.songTitleOfficial?.trim() ||
    parsed.data.songTitle?.trim() ||
    parsed.data.songTitleKr?.trim() ||
    parsed.data.songTitleEn?.trim() ||
    null;
  const songTitleKrValue = parsed.data.songTitleKr || null;
  const songTitleEnValue = parsed.data.songTitleEn || null;

  const paymentMethod = parsed.data.paymentMethod ?? "BANK";
  if (
    isSubmitted &&
    paymentMethod === "BANK" &&
    !bankDepositorNameValue &&
    !isAdminReviewer &&
    !deferPayment
  ) {
    return { error: "입금자명을 입력해주세요." };
  }
  const bankPaymentDocumentError = isAdminReviewer
    ? null
    : validateBankPaymentDocument({
        isSubmitted: isSubmitted && !deferPayment,
        paymentMethod,
        paymentDocumentType,
        cashReceiptPurpose,
        cashReceiptPhone: cashReceiptPhoneValue,
        cashReceiptBusinessNumber: cashReceiptBusinessNumberDigits,
        taxInvoiceBusinessNumber: taxInvoiceBusinessNumberDigits,
      });
  if (bankPaymentDocumentError) {
    return { error: bankPaymentDocumentError };
  }
  if (isSubmitted) {
    const requiredFieldsError = validateMvSubmittedFields({
      isAdminReviewer,
      externalApplicationForm: usesExternalApplicationForm,
      aiUsed: parsed.data.aiUsed,
      title: titleValue,
      artistName: artistNameValue,
      artistNameOfficial: parsed.data.artistNameOfficial,
      releaseDate: parsed.data.releaseDate,
      director: parsed.data.director,
      leadActor: parsed.data.leadActor,
      productionCompany: parsed.data.productionCompany,
      agency: parsed.data.agency,
      albumTitle: parsed.data.albumTitle,
      distributionCompany: parsed.data.distributionCompany,
      usage: parsed.data.usage,
      songTitleKr: parsed.data.songTitleKr,
      songTitleEn: parsed.data.songTitleEn,
      songTitleOfficial: parsed.data.songTitleOfficial,
      composer: parsed.data.composer,
      storyline: parsed.data.storyline,
      lyrics: parsed.data.lyrics,
    });
    if (requiredFieldsError) return { error: requiredFieldsError };
  }

  const shouldRequestPayment =
    isSubmitted &&
    !deferPayment &&
    (paymentMethod === "CARD" || Boolean(bankDepositorNameValue));
  const saveState = resolveSubmissionSaveState({
    requestedStatus: parsed.data.status,
    shouldRequestPayment,
  });
  const artistId = await ensureArtistByName(artistNameValue);

  const submissionPayload = {
    id: parsed.data.submissionId,
    user_id: user?.id ?? null,
    type: parsed.data.mvType,
    title: titleValue || null,
    artist_name: artistNameValue || null,
    artist_name_kr: parsed.data.artistNameOfficial || null,
    artist_id: artistId,
    release_date: parsed.data.releaseDate || null,
    genre: parsed.data.genre?.trim() || null,
    mv_runtime: parsed.data.runtime?.trim() || null,
    mv_format: parsed.data.format?.trim() || null,
    mv_director: parsed.data.director?.trim() || null,
    mv_lead_actor: parsed.data.leadActor?.trim() || null,
    mv_storyline: parsed.data.storyline?.trim() || null,
    mv_production_company: parsed.data.productionCompany?.trim() || null,
    mv_agency: parsed.data.agency?.trim() || null,
    mv_album_title: parsed.data.albumTitle?.trim() || null,
    mv_production_date: parsed.data.productionDate || null,
    mv_distribution_company: parsed.data.distributionCompany?.trim() || null,
    mv_business_reg_no: parsed.data.businessRegNo?.trim() || null,
    mv_usage: parsed.data.usage?.trim() || null,
    mv_desired_rating:
      parsed.data.mvType === "MV_DISTRIBUTION"
        ? parsed.data.desiredRating?.trim() || null
        : null,
    mv_memo: parsed.data.memo?.trim() || null,
    mv_song_title: songTitleValue,
    mv_song_title_kr: songTitleKrValue,
    mv_song_title_en: songTitleEnValue,
    mv_song_title_official: parsed.data.songTitleOfficial || null,
    mv_composer: parsed.data.composer?.trim() || null,
    mv_lyricist: parsed.data.lyricist?.trim() || null,
    mv_arranger: parsed.data.arranger?.trim() || null,
    mv_song_memo: parsed.data.songMemo?.trim() || null,
    mv_lyrics: parsed.data.lyrics?.trim() || null,
    ai_used:
      typeof parsed.data.aiUsed === "boolean" ? parsed.data.aiUsed : null,
    package_id: parsed.data.packageId ?? null,
    amount_krw: amountKrw,
    applicant_email: applicantEmailValue || null,
    mv_base_selected: parsed.data.mvBaseSelected ?? true,
    mv_selected_station_codes: parsed.data.selectedStationCodes ?? [],
    guest_name: isGuest ? guestNameValue || null : null,
    guest_company: isGuest ? parsed.data.guestCompany?.trim() || null : null,
    guest_email: isGuest ? guestEmailValue || null : null,
    guest_phone: isGuest ? guestPhoneValue || null : null,
    guest_token: isGuest ? parsed.data.guestToken : null,
    pre_review_requested: parsed.data.preReviewRequested ?? false,
    karaoke_requested: parsed.data.karaokeRequested ?? false,
    payment_method: paymentMethod,
    bank_depositor_name:
      paymentMethod === "BANK" ? bankDepositorNameValue || null : null,
    payment_document_type:
      paymentMethod === "BANK" ? paymentDocumentType ?? null : null,
    cash_receipt_purpose:
      paymentMethod === "BANK" && paymentDocumentType === "CASH_RECEIPT"
        ? cashReceiptPurpose ?? null
        : null,
    cash_receipt_phone:
      paymentMethod === "BANK" &&
      paymentDocumentType === "CASH_RECEIPT" &&
      cashReceiptPurpose === "PERSONAL_INCOME_DEDUCTION"
        ? normalizeDigits(cashReceiptPhoneValue) || null
        : null,
    cash_receipt_business_number:
      paymentMethod === "BANK" &&
      paymentDocumentType === "CASH_RECEIPT" &&
      cashReceiptPurpose === "BUSINESS_EXPENSE_PROOF"
        ? cashReceiptBusinessNumberDigits || null
        : null,
    tax_invoice_business_number:
      paymentMethod === "BANK" && paymentDocumentType === "TAX_INVOICE"
        ? taxInvoiceBusinessNumberDigits || null
        : null,
    application_form_mode: applicationFormMode,
    files_submitted_by_email: Boolean(parsed.data.filesSubmittedByEmail),
    status: saveState.finalStatus,
    payment_status: saveState.finalPaymentStatus,
  };
  const finalSubmissionState = {
    status: submissionPayload.status,
    paymentStatus: submissionPayload.payment_status,
  };

  if (parsed.data.status === "SUBMITTED") {
    const stalePaymentResult = await cancelStaleRequestedSubmissionPayments(
      adminDb,
      parsed.data.submissionId,
    );
    if (stalePaymentResult.error) {
      console.error("Stale MV payment cleanup failed", stalePaymentResult.error);
      return { error: "기존 결제 요청을 정리하지 못했습니다. 잠시 후 다시 시도해주세요." };
    }

    const { data: refreshedSubmission, error: refreshedSubmissionError } =
      await loadEditableSubmissionByActor({
        db: adminDb,
        submissionId: parsed.data.submissionId,
        userId: user?.id,
        guestToken: parsed.data.guestToken,
      });
    if (
      refreshedSubmissionError ||
      !canEditSubmission(refreshedSubmission, {
        userId: user?.id,
        guestToken: parsed.data.guestToken,
      }) ||
      !refreshedSubmission?.updated_at
    ) {
      console.error(
        "MV submission ownership recheck failed after payment cleanup",
        refreshedSubmissionError,
      );
      return { error: "결제 상태가 변경되어 접수를 수정할 수 없습니다." };
    }
    expectedParentVersion = {
      updatedAt: refreshedSubmission.updated_at,
      userId: refreshedSubmission.user_id,
      guestToken: refreshedSubmission.guest_token,
    };
  }

  const atomicParentPayload = stripColumn(
    stripColumn(stripColumn(submissionPayload, "id"), "status"),
    "payment_status",
  );
  const leaseResult = await claimSubmissionSaveLease({
    db,
    submissionId: parsed.data.submissionId,
    expectedUpdatedAt: expectedParentVersion.updatedAt,
    expectedUserId: expectedParentVersion.userId,
    expectedGuestToken: expectedParentVersion.guestToken,
  });
  if (!leaseResult.lease) {
    console.error("MV submission save lease claim failed", {
      code: leaseResult.error?.code,
      submissionId: parsed.data.submissionId,
    });
    return {
      error: formatSubmissionLeaseError(
        leaseResult.error,
        leaseResult.recoveryRequired,
      ),
    };
  }

  let replacedFileRefs: SubmissionB2ObjectRef[] = [];
  if (parsed.data.files !== undefined) {
    replacedFileRefs = await loadSubmissionB2ObjectRefs(db, [
      parsed.data.submissionId,
    ]);
  }
  const fileRows = (parsed.data.files ?? []).map((file) => ({
    file_path: file.path,
    object_key: file.path,
    uploaded_at: new Date().toISOString(),
    original_name: file.originalName,
    mime: file.mime || null,
    size: file.size,
    checksum: file.checksum ?? null,
    duration_seconds: file.durationSeconds ?? null,
  }));
  const { data: committedRows, error: commitError } = await db.rpc(
    "commit_submission_save_v2",
    {
      p_submission_id: parsed.data.submissionId,
      p_lease_token: leaseResult.lease.token,
      p_expected_updated_at: leaseResult.lease.updatedAt,
      p_parent: atomicParentPayload,
      p_replace_tracks: false,
      p_tracks: [],
      p_replace_files: parsed.data.files !== undefined,
      p_file_kind: "VIDEO",
      p_files: fileRows,
      p_sync_reviews: isSubmitted,
      p_station_ids: canonicalMvStationIds,
      p_final_status: finalSubmissionState.status,
      p_final_payment_status: finalSubmissionState.paymentStatus,
    },
  );
  const committed = Array.isArray(committedRows)
    ? committedRows[0]
    : committedRows;
  if (commitError || !committed) {
    await releaseSubmissionSaveLease({
      db,
      submissionId: parsed.data.submissionId,
      leaseToken: leaseResult.lease.token,
    });
    console.error("MV submission atomic commit failed", {
      code: commitError?.code,
      submissionId: parsed.data.submissionId,
    });
    return {
      error: "접수 저장이 완료되지 않았습니다. 내용을 확인한 뒤 다시 시도해주세요.",
    };
  }

  scheduleReplacedSubmissionFileCleanup(db, replacedFileRefs);

  const eventMessage =
    parsed.data.status === "SUBMITTED"
      ? deferPayment
        ? "결제 전 신청서 저장이 완료되었습니다."
        : shouldRequestPayment
        ? paymentMethod === "CARD"
          ? "카드 결제 요청이 접수되었습니다."
          : "입금 확인 요청이 접수되었습니다."
        : "뮤직비디오 심의 접수가 완료되었습니다."
      : "임시 저장이 완료되었습니다.";

  if (parsed.data.status !== "DRAFT" && !wasPreviouslySubmitted) {
    await db.from("submission_events").insert({
      submission_id: parsed.data.submissionId,
      actor_user_id: user?.id ?? null,
      event_type: parsed.data.status,
      message: eventMessage,
    });
  }

  let receiptEmailSent = false;
  let bankGuideEmailSent = false;
  if (parsed.data.status === "SUBMITTED" && !wasPreviouslySubmitted) {
    const recipientEmails = collectRecipientEmails(
      applicantEmailValue,
      guestEmailValue,
      user?.email,
    );
    const baseUrl = getBaseUrl();
    const siteLink = buildUrl("/", baseUrl);
    const link =
      isGuest && parsed.data.guestToken && parsed.data.guestToken.length >= 8
        ? buildUrl(`/track/${encodeURIComponent(parsed.data.guestToken)}`, baseUrl)
        : buildUrl(`/dashboard/submissions/${parsed.data.submissionId}`, baseUrl);

    const emailJobs: SubmissionEmailDeliveryJob[] = [];
    for (const recipientEmail of recipientEmails) {
      emailJobs.push({
        recipientEmail,
        label: "접수 완료 안내",
        kind: "receipt",
        send: () =>
          sendSubmissionReceiptEmail({
            email: recipientEmail,
            title: titleValue || "제목 미입력",
            kind: "MV",
            submissionId: parsed.data.submissionId,
            isGuest,
            guestToken: parsed.data.guestToken ?? undefined,
            link,
            siteLink,
          }),
      });

      if (shouldRequestPayment && paymentMethod === "BANK" && amountKrw > 0) {
        emailJobs.push({
          recipientEmail,
          label: "무통장 입금 안내",
          kind: "bank",
          send: () =>
            sendSubmissionBankRequestEmail({
              email: recipientEmail,
              title: titleValue || "제목 미입력",
              artist: artistNameValue || null,
              kind: "MV",
              amountKrw,
              bankDepositorName: bankDepositorNameValue || null,
              link,
              siteLink,
            }),
        });
      }
    }
    const kakaoDelivery = (async () => {
      const memberPhoneValue = isGuest ? null : await loadMemberPhone(user?.id);
      return sendKakaoOfficialNotification({
        phone: guestPhoneValue || memberPhoneValue,
        title: "뮤직비디오 심의 접수 완료",
        message: `${titleValue || "제목 미입력"} 접수가 완료되었습니다. 진행 상황은 온사이드에서 확인할 수 있습니다.`,
        link,
      });
    })().catch((error) => {
      console.warn("[Kakao][submission] post-commit delivery failed", {
        submissionId: parsed.data.submissionId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    });
    const emailDelivery = await deliverSubmissionEmails({
      db,
      submissionId: parsed.data.submissionId,
      jobs: emailJobs,
    });
    receiptEmailSent = emailDelivery.receiptSent;
    bankGuideEmailSent = emailDelivery.bankGuideSent;
    await kakaoDelivery;
  }

  if (user?.id) {
    clearDashboardStatusCache(user.id);
  }

  return {
    submissionId: parsed.data.submissionId,
    guestToken: isGuest ? parsed.data.guestToken : undefined,
    emailNotice: buildSubmissionEmailNotice({
      receiptSent: receiptEmailSent,
      bankGuideSent: bankGuideEmailSent,
    }),
  };
}

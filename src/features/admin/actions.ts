"use server";

import { z } from "zod";
import { randomUUID } from "node:crypto";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import {
  paymentStatusLabelMap,
  paymentStatusEnum,
  type PaymentStatus,
  resultStatusEnum,
  reviewStatusEnum,
  reviewStatusLabelMap,
  type ReviewStatus,
  stationReviewStatusEnum,
  stationReviewStatusOptions,
} from "@/constants/review-status";
import { saveManagedStationReview, saveManagedStationReviews, type BulkStationReviewInput } from "@/lib/admin/review-management";
import { sendReviewSummaryNotificationById, sendSubmissionUpdateNotificationById } from "@/lib/admin/submission-notifications";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAllowedImageSource } from "@/lib/image-source";
import { isRatingCode } from "@/lib/mv-assets";
import { completeMvReviewFlow } from "@/lib/admin/mv-review-flow";
import {
  ALBUM_REVIEW_DISCOUNT_SETTING_KEY,
  normalizeAlbumDiscountPercent,
} from "@/lib/album-pricing";
import { requireAdminAction } from "@/lib/admin/action-auth";
import { confirmLinkedOrderPayment, resolveUncertainCardPayment, statusAfterPaymentConfirmation } from "@/lib/admin/order-payment";
import { autoIssueRequestedCashReceipt } from "@/lib/cash-receipts-server";
import { sendPaidSubmissionNotificationsById } from "@/lib/payments/notifications";
import {
  PUBLIC_CATALOG_CACHE_TAG,
  PUBLIC_ALBUM_DISCOUNT_CACHE_TAG,
  PUBLIC_PROFANITY_TERMS_CACHE_TAG,
  PUBLIC_AD_BANNERS_CACHE_TAG,
} from "@/lib/public-cache-tags";
import { safeAdminRedirectPath } from "@/lib/admin/redirect";
import { buildAdminSubmissionDetailPath } from "@/lib/admin/submission-navigation";
import { SERVER_UPLOAD_MAX_BYTES, SERVER_UPLOAD_MAX_LABEL } from "@/lib/server-upload-limit";
import {
  cleanupDeletedSubmissionB2Objects,
  loadSubmissionB2ObjectRefs,
} from "@/lib/submission-file-cleanup";

export type AdminActionState = {
  error?: string;
  warning?: string;
  message?: string;
  row?: {
    id?: string | null;
    submission_id?: string | null;
    station_id?: string | null;
    status?: string | null;
    result_note?: string | null;
    track_results?: unknown;
    updated_at?: string | null;
  };
};

const submissionStatusSchema = z.object({
  submissionId: z.string().uuid(),
  status: reviewStatusEnum,
  adminMemo: z.string().optional(),
});

const adminOperationalStageValues = [
  "APPLICATION_RECEIVED",
  "PAYMENT_COMPLETE",
  "REVIEW_IN_PROGRESS",
  "RESULT_NOTIFIED",
] as const;

const adminOperationalStageEnum = z.enum(adminOperationalStageValues);
type AdminOperationalStage = z.infer<typeof adminOperationalStageEnum>;

const adminOperationalStageLabelMap: Record<AdminOperationalStage, string> = {
  APPLICATION_RECEIVED: "신청접수",
  PAYMENT_COMPLETE: "결제완료",
  REVIEW_IN_PROGRESS: "심의진행",
  RESULT_NOTIFIED: "결과 준비",
};

const mapAdminOperationalStage = (
  stage: AdminOperationalStage,
  currentPaymentStatus?: PaymentStatus | null,
  currentStatus: ReviewStatus = "SUBMITTED",
): { status: ReviewStatus; paymentStatus: PaymentStatus } => {
  switch (stage) {
    case "APPLICATION_RECEIVED":
      return {
        status: "SUBMITTED",
        paymentStatus:
          currentPaymentStatus && currentPaymentStatus !== "PAID"
            ? currentPaymentStatus
            : "PAYMENT_PENDING",
      };
    case "PAYMENT_COMPLETE":
      return { status: currentPaymentStatus === "PAID" ? currentStatus : statusAfterPaymentConfirmation(currentStatus), paymentStatus: "PAID" };
    case "REVIEW_IN_PROGRESS":
      return { status: "IN_PROGRESS", paymentStatus: "PAID" };
    case "RESULT_NOTIFIED":
      return { status: "RESULT_READY", paymentStatus: "PAID" };
  }
};

const submissionBasicInfoSchema = z.object({
  submissionId: z.string().uuid(),
  title: z.string().optional(),
  artistName: z.string().optional(),
});

const paymentStatusSchema = z.object({
  submissionId: z.string().uuid(),
  paymentStatus: paymentStatusEnum,
  adminMemo: z.string().optional(),
});

const submissionResultSchema = z.object({
  submissionId: z.string().uuid(),
  resultStatus: resultStatusEnum,
  resultMemo: z.string().max(4000).optional(),
});

const trackResultStatusEnum = z.enum(["PENDING", "APPROVED", "REJECTED"]);
const trackResultSchema = z.object({
  trackId: z.string().uuid().optional(),
  trackNo: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  status: trackResultStatusEnum,
});

const stationReviewPayloadSchema = z.object({
  reviewId: z.string().uuid().optional(),
  submissionId: z.string().uuid(),
  stationId: z.string().uuid().optional(),
  status: stationReviewStatusEnum,
  resultNote: z.string().optional(),
  trackResults: z.array(trackResultSchema).optional(),
  applyOverallStatus: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable(),
  ageRating: z.enum(["ALL", "12", "15", "19"]).nullable().optional(),
});

const STATION_REVIEW_TRACK_RESULTS_COLUMN = "track_results_json";
const STATION_REVIEW_TRACK_RESULTS_SELECT = `track_results:${STATION_REVIEW_TRACK_RESULTS_COLUMN}`;
const LEGACY_TRACK_RESULTS_COLUMN = "track_results";
const LEGACY_TRACK_RESULTS_SELECT = "track_results";


const uuidValueSchema = z.string().uuid();
const normalizeUuid = (value?: string | null) => {
  if (!value) return "";
  return uuidValueSchema.safeParse(value).success ? value : "";
};

const revalidateUserDashboards = (submissionId?: string) => {
  for (const prefix of ["", "/en"]) {
    for (const path of ["/dashboard", "/dashboard/history", "/dashboard/status", "/mypage", "/mypage/history"]) revalidatePath(`${prefix}${path}`);
    if (submissionId) {
      revalidatePath(`${prefix}/dashboard/submissions/${submissionId}`);
      revalidatePath(`${prefix}/mypage/submissions/${submissionId}`);
    }
    revalidatePath(`${prefix}/track/[token]`, "page");
  }
};

const withSavedQuery = (path: string, savedValue = "1") => {
  const [baseWithQuery, hash] = path.split("#");
  const [pathname, query] = baseWithQuery.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("saved", savedValue);
  const nextPath = `${pathname}?${params.toString()}`;
  return hash ? `${nextPath}#${hash}` : nextPath;
};

const buildSubmissionFormRedirect = (
  formData: FormData,
  submissionId: string,
  state: Record<string, string | null | undefined>,
) =>
  buildAdminSubmissionDetailPath({
    submissionId,
    returnTo: String(formData.get("returnTo") ?? ""),
    state,
  });

const packageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  stationCount: z.number().int().positive(),
  priceKrw: z.number().int().nonnegative(),
  description: z.string().optional(),
  isActive: z.boolean(),
});

const stationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  code: z.string().min(1),
  isActive: z.boolean(),
});

const packageStationsSchema = z.object({
  packageId: z.string().uuid(),
  stationCodes: z.string().min(1),
});

const albumReviewDiscountSchema = z.object({
  discountPercent: z.number().min(0).max(100),
});

const isSafeBannerUrl = (value: string, allowContactProtocols = false) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    const protocol = new URL(trimmed).protocol.toLowerCase();
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      (allowContactProtocols && ["mailto:", "tel:", "sms:"].includes(protocol))
    );
  } catch {
    return false;
  }
};

const adBannerSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).optional(),
  imageUrl: z
    .string()
    .max(2048)
    .refine(
      (value) => isAllowedImageSource(value),
      "지원되는 이미지 URL이 아닙니다.",
    )
    .optional(),
  linkUrl: z
    .string()
    .max(2048)
    .refine(
      (value) => isSafeBannerUrl(value, true),
      "안전한 링크 URL이 아닙니다.",
    )
    .optional(),
  placement: z.enum(["STRIP", "HOME_HERO", "LEFT"]).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean(),
});

const profanityTermSchema = z.object({
  id: z.string().uuid().optional(),
  term: z.string().min(1),
  language: z.enum(["KO", "EN"]),
  isActive: z.boolean(),
});

const deleteSubmissionsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

const deleteArtistSchema = z.object({
  id: z.string().uuid(),
});

const deleteArtistsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

const bannerBucket = "banners";
const maxBannerImageSizeBytes = SERVER_UPLOAD_MAX_BYTES;
const bannerFolders = {
  STRIP: "strip",
  HOME_HERO: "home-hero",
  LEFT: "left",
} as const;

const sanitizeFileName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);

const guessImageContentType = (file: File) => {
  if (file.type) {
    return file.type;
  }
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowerName.endsWith(".gif")) return "image/gif";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
};

const isLikelyImageFile = (file: File) => {
  if (file.type) {
    return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
      file.type.toLowerCase(),
    );
  }
  const lowerName = file.name.toLowerCase();
  return /\.(png|jpe?g|gif|webp)$/i.test(lowerName);
};

const uploadBannerImage = async (
  file: File,
  placement: keyof typeof bannerFolders = "STRIP",
) => {
  if (!isLikelyImageFile(file)) {
    return { error: "PNG, JPG, GIF, WebP 이미지만 업로드 가능합니다." };
  }
  if (file.size <= 0 || file.size > maxBannerImageSizeBytes) {
    return { error: `배너 이미지는 ${SERVER_UPLOAD_MAX_LABEL} 이하만 업로드 가능합니다.` };
  }

  const admin = await createServerSupabase();
  const safeName = sanitizeFileName(file.name || "banner.jpg");
  const bannerFolder = bannerFolders[placement] ?? bannerFolders.STRIP;
  const path = `${bannerFolder}/${Date.now()}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error } = await admin.storage
    .from(bannerBucket)
    .upload(path, arrayBuffer, {
      contentType: guessImageContentType(file),
      upsert: true,
    });

  if (error) {
    return { error: "배너 이미지 업로드에 실패했습니다." };
  }

  const { data } = admin.storage.from(bannerBucket).getPublicUrl(path);
  return { publicUrl: data.publicUrl };
};

async function insertEvent(
  submissionId: string,
  message: string,
  eventType: string,
) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("submission_events").insert({
    submission_id: submissionId,
    actor_user_id: user?.id ?? null,
    event_type: eventType,
    message,
  });
  if (error) throw new Error("처리 기록 저장에 실패했습니다.");
}

const auditWarning = "변경사항은 저장되었지만 처리 기록 저장에 실패했습니다.";
const combineWarnings = (...warnings: Array<string | undefined>) => warnings.filter(Boolean).join(" / ") || undefined;

export async function updateSubmissionStatusAction(
  payload: z.infer<typeof submissionStatusSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = submissionStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const { data: previous, error: previousError } = await supabase.from("submissions")
    .select("status, admin_memo").eq("id", parsed.data.submissionId).maybeSingle();
  if (previousError || !previous) return { error: "접수 정보를 확인하지 못했습니다." };
  const statusChanged = previous.status !== parsed.data.status;
  if (!statusChanged && (previous.admin_memo ?? "") === (parsed.data.adminMemo || "")) {
    return { message: "변경된 내용이 없습니다." };
  }
  const updatePayload: {
    status: z.infer<typeof reviewStatusEnum>;
    admin_memo: string | null;
  } = {
    status: parsed.data.status,
    admin_memo: parsed.data.adminMemo || null,
  };

  const { data: updatedSubmission, error } = await supabase
    .from("submissions")
    .update(updatePayload)
    .eq("id", parsed.data.submissionId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return { error: "상태 업데이트에 실패했습니다." };
  }
  if (!updatedSubmission || updatedSubmission.status !== parsed.data.status) {
    return { error: "상태 저장 결과가 DB에 반영되지 않았습니다." };
  }

  const eventWarning = await insertEvent(
    parsed.data.submissionId,
    `관리자 상태 변경: ${parsed.data.status}`,
    "ADMIN_STATUS",
  ).then(() => undefined, () => auditWarning);
  const notification = statusChanged && !["RESULT_READY", "COMPLETED"].includes(previous.status) && !["RESULT_READY", "COMPLETED"].includes(parsed.data.status) ? await sendSubmissionUpdateNotificationById({
    submissionId: parsed.data.submissionId,
    headline: "심의 진행 상태가 업데이트되었습니다.",
    summary: `현재 상태: ${
      reviewStatusLabelMap[parsed.data.status] ?? parsed.data.status
    }`,
    subject: "[onside] 심의 진행 상태 업데이트",
  }) : null;

  return { message: "상태가 업데이트되었습니다.", warning: combineWarnings(eventWarning, notification?.warning) };
}

export async function updateSubmissionStatusFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const result = await updateSubmissionStatusAction({
    submissionId,
    status: String(formData.get("status") ?? "") as z.infer<typeof reviewStatusEnum>,
    adminMemo: String(formData.get("adminMemo") ?? "") || undefined,
  });
  if (result.error) {
    console.error(result.error);
    if (submissionId) {
      redirect(
        buildSubmissionFormRedirect(formData, submissionId, {
          saved: "error",
          savedError: result.error,
        }),
      );
    }
    redirect(
      `/admin/submissions?saved=error&savedError=${encodeURIComponent(
        result.error,
      )}`,
    );
  }
  revalidatePath("/admin/submissions");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
    revalidateUserDashboards(submissionId);
    redirect(buildSubmissionFormRedirect(formData, submissionId, {
      saved: result.warning ? "status_warning" : "status", savedWarning: result.warning,
    }));
  }
}

// ----- MV Rating -----

const mvRatingSchema = z.object({
  submissionId: z.string().uuid(),
  rating: z.string().refine(isRatingCode, "유효하지 않은 등급입니다."),
});

export async function updateSubmissionMvRatingAction(
  payload: z.infer<typeof mvRatingSchema>,
): Promise<AdminActionState> {
  const actor = await requireAdminAction();
  const parsed = mvRatingSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "등급 값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const { data: submission } = await supabase
    .from("submissions")
    .select("type, mv_desired_rating, result_status, status")
    .eq("id", parsed.data.submissionId)
    .maybeSingle();

  if (!submission) {
    return { error: "접수를 찾을 수 없습니다." };
  }
  if (submission.type !== "MV_DISTRIBUTION") {
    return {
      error: "온라인 업로드용 뮤직비디오 심의만 등급을 설정할 수 있습니다.",
    };
  }

  const expectedResult = parsed.data.rating === "REJECT" ? "REJECTED" : "APPROVED";
  const completion = await completeMvReviewFlow(supabase, parsed.data.submissionId, {
    actorUserId: actor.id, rating: parsed.data.rating, resultStatus: expectedResult,
  });

  if (completion.error) {
    return { error: completion.error };
  }
  if (!completion.completed) {
    return { error: "뮤직비디오 접수를 찾을 수 없습니다." };
  }

  if (!completion.changed) return { message: "변경된 내용이 없습니다." };

  revalidateUserDashboards(parsed.data.submissionId);
  return { message: "MV 등급을 저장했습니다. 이메일은 결과 안내에서 따로 발송해주세요." };
}

export async function updateSubmissionMvRatingFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const rating = String(formData.get("rating") ?? "");
  const result = await updateSubmissionMvRatingAction({ submissionId, rating });
  if (result.error) {
    console.error(result.error);
    if (submissionId) {
      redirect(
        `/admin/submissions/${submissionId}?saved=error&savedError=${encodeURIComponent(
          result.error,
        )}`,
      );
    }
    redirect(
      `/admin/submissions?saved=error&savedError=${encodeURIComponent(
        result.error,
      )}`,
    );
  }
  revalidatePath("/admin/submissions");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
    revalidateUserDashboards(submissionId);
    redirect(buildSubmissionFormRedirect(formData, submissionId, { saved: "rating", savedWarning: result.warning }));
  }
}

export async function updateSubmissionBasicInfoAction(
  payload: z.infer<typeof submissionBasicInfoSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = submissionBasicInfoSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const title = parsed.data.title?.trim() ?? "";
  const artistName = parsed.data.artistName?.trim() ?? "";
  if (!title && !artistName) {
    return { error: "아티스트명 또는 제목을 입력해주세요." };
  }

  const updatePayload: {
    title?: string;
    artist_name?: string;
  } = {};
  if (title) {
    updatePayload.title = title;
  }
  if (artistName) {
    updatePayload.artist_name = artistName;
  }

  const supabase = createAdminClient();
  const { data: previous, error: previousError } = await supabase.from("submissions")
    .select("title, artist_name").eq("id", parsed.data.submissionId).maybeSingle();
  if (previousError || !previous) return { error: "접수 정보를 확인하지 못했습니다." };
  if ((!title || title === previous.title) && (!artistName || artistName === previous.artist_name)) {
    return { message: "변경된 내용이 없습니다." };
  }
  const { data: updatedSubmission, error } = await supabase
    .from("submissions")
    .update(updatePayload)
    .eq("id", parsed.data.submissionId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: "아티스트/앨범 정보 업데이트에 실패했습니다." };
  }
  if (!updatedSubmission) {
    return { error: "접수를 찾을 수 없습니다." };
  }

  const eventWarning = await insertEvent(
    parsed.data.submissionId,
    "관리자 정보 수정: 아티스트/앨범",
    "ADMIN_BASIC_INFO",
  ).then(() => undefined, () => auditWarning);

  const notification = await sendSubmissionUpdateNotificationById({
    submissionId: parsed.data.submissionId, headline: "접수 정보가 업데이트되었습니다.",
    summary: "신청 내역에서 작품명과 아티스트 정보를 확인해주세요.", subject: "[onside] 접수 정보 업데이트 안내",
  });
  return { message: "아티스트/앨범 정보가 업데이트되었습니다.", warning: combineWarnings(eventWarning, notification.warning) };
}

export async function updateSubmissionBasicInfoFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const result = await updateSubmissionBasicInfoAction({
    submissionId,
    title: String(formData.get("title") ?? ""),
    artistName: String(formData.get("artistName") ?? ""),
  });

  if (result.error) {
    console.error(result.error);
    if (submissionId) {
      redirect(
        `/admin/submissions/${submissionId}?saved=error&savedError=${encodeURIComponent(
          result.error,
        )}`,
      );
    }
    redirect(
      `/admin/submissions?saved=error&savedError=${encodeURIComponent(
        result.error,
      )}`,
    );
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  revalidateUserDashboards(submissionId);
  redirect(buildSubmissionFormRedirect(formData, submissionId, { saved: "basic", savedWarning: result.warning }));
}

export async function updatePaymentStatusAction(
  payload: z.infer<typeof paymentStatusSchema>,
): Promise<AdminActionState> {
  const actor = await requireAdminAction();
  const parsed = paymentStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "입력값을 확인해주세요." };
  }

  const supabase = createAdminClient();
  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("id, status, payment_status, current_order_id")
    .eq("id", parsed.data.submissionId)
    .maybeSingle();

  if (submissionError) {
    return { error: "접수 정보를 확인하지 못했습니다." };
  }
  if (!submission) {
    return { error: "접수를 찾을 수 없습니다." };
  }

  const orderPayment = await confirmLinkedOrderPayment(supabase, {
    orderId: submission.current_order_id,
    currentPaymentStatus: submission.payment_status,
    nextPaymentStatus: parsed.data.paymentStatus,
    actorUserId: actor.id,
    adminMemo: parsed.data.adminMemo,
  });
  if (orderPayment.error) return { error: orderPayment.error };
  if (orderPayment.confirmedIds) {
    for (const id of orderPayment.confirmedIds) revalidateUserDashboards(id);
    for (const prefix of ["", "/en"]) revalidatePath(`${prefix}/mypage/orders`);
    const outcomes = await Promise.all(orderPayment.confirmedIds.map((submissionId) => sendPaidSubmissionNotificationsById({
      submissionId, paymentKey: `bank:${submission.current_order_id ?? submissionId}`,
    })));
    return { message: "주문 전체의 입금이 확인되었습니다.", warning: outcomes.find((item) => item.warning)?.warning };
  }
  if (orderPayment.refundedIds) {
    for (const id of orderPayment.refundedIds) revalidateUserDashboards(id);
    for (const prefix of ["", "/en"]) revalidatePath(`${prefix}/mypage/orders`);
    const outcomes = await Promise.all(orderPayment.refundedIds.map((submissionId) => sendSubmissionUpdateNotificationById({
      submissionId, headline: "결제가 환불 처리되었습니다.",
      summary: "결제가 환불로 기록되어 심의 진행이 중단되었습니다. 환불 입금은 결제 수단에 따라 수일이 걸릴 수 있으며, 문의는 고객센터로 연락해주세요.",
      subject: "[onside] 환불 처리 안내",
    })));
    return { message: "주문 전체가 환불로 기록되었습니다.", warning: outcomes.find((item) => item?.warning)?.warning };
  }

  const nextStatus =
    parsed.data.paymentStatus === "PAID" && submission.payment_status !== "PAID"
      ? statusAfterPaymentConfirmation(submission.status as ReviewStatus)
      : submission.status;

  const { data: updatedSubmission, error } = await supabase
    .from("submissions")
    .update({
      ...(!submission.current_order_id ? { payment_status: parsed.data.paymentStatus } : {}),
      status: nextStatus,
      admin_memo: parsed.data.adminMemo || null,
    })
    .eq("id", parsed.data.submissionId)
    .select("id, status, payment_status")
    .maybeSingle();

  if (error) {
    return { error: "결제 상태 업데이트에 실패했습니다." };
  }
  if (
    !updatedSubmission ||
    updatedSubmission.payment_status !== parsed.data.paymentStatus ||
    updatedSubmission.status !== nextStatus
  ) {
    return { error: "결제 상태 저장 결과가 DB에 반영되지 않았습니다." };
  }

  const eventWarning = await insertEvent(
    parsed.data.submissionId,
    `결제 상태 변경: ${parsed.data.paymentStatus}`,
    "PAYMENT_UPDATE",
  ).then(() => undefined, () => auditWarning);

  const notification = submission.payment_status !== "PAID" && parsed.data.paymentStatus === "PAID"
    ? await sendPaidSubmissionNotificationsById({
      submissionId: parsed.data.submissionId, paymentKey: `bank:${submission.current_order_id ?? parsed.data.submissionId}`,
    }) : submission.payment_status !== parsed.data.paymentStatus || submission.status !== nextStatus
    ? await sendSubmissionUpdateNotificationById({
      submissionId: parsed.data.submissionId, headline: "결제 상태가 업데이트되었습니다.",
      summary: `결제 상태: ${paymentStatusLabelMap[parsed.data.paymentStatus] ?? parsed.data.paymentStatus}`,
      subject: "[onside] 결제 상태 업데이트 안내",
    }) : null;
  return { message: "결제 상태가 업데이트되었습니다.", warning: combineWarnings(eventWarning, notification?.warning) };
}

export async function updatePaymentStatusFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const paymentStatus = String(formData.get("paymentStatus") ?? "") as z.infer<
    typeof paymentStatusEnum
  >;
  const result = await updatePaymentStatusAction({
    submissionId,
    paymentStatus,
    adminMemo: String(formData.get("adminMemo") ?? "") || undefined,
  });
  if (result.error) {
    console.error(result.error);
    if (submissionId) {
      redirect(
        `/admin/submissions/${submissionId}?saved=error&savedError=${encodeURIComponent(
          result.error,
        )}`,
      );
    }
    redirect(
      `/admin/submissions?saved=error&savedError=${encodeURIComponent(
        result.error,
      )}`,
    );
  }

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  if (submissionId) {
    revalidateUserDashboards(submissionId);
  }
  if (submissionId) {
    redirect(buildSubmissionFormRedirect(formData, submissionId, { saved: "payment", savedWarning: result.warning }));
  }
}

export async function updateStationReviewAction(
  payload: z.infer<typeof stationReviewPayloadSchema>,
): Promise<AdminActionState> {
  const actor = await requireAdminAction();
  const parsed = stationReviewPayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: "입력값과 최신 변경 시각을 확인해주세요. 화면을 새로고침한 뒤 다시 시도해주세요." };
  const supabase = createAdminClient();
  const input = parsed.data;
  if (input.reviewId) {
    const { data: existing, error } = await supabase.from("station_reviews")
      .select("id, submission_id, station_id").eq("id", input.reviewId).maybeSingle();
    if (error || !existing || existing.submission_id !== input.submissionId ||
        (input.stationId && existing.station_id !== input.stationId)) return { error: "신청 내역과 방송국 정보를 다시 확인해주세요." };
    input.stationId = existing.station_id;
  }
  if (!input.stationId) return { error: "신청 방송국을 선택해주세요." };
  const result = await saveManagedStationReview(supabase, { ...input, stationId: input.stationId, actorUserId: actor.id });
  if (!result.ok || !result.row) return { error: result.error ?? "심의 결과를 저장하지 못했습니다." };
  if (!result.changed) return { message: "변경된 내용이 없습니다.", row: result.row };
  revalidatePath("/admin/submissions");
  revalidatePath("/admin/submissions/detail");
  revalidatePath(`/admin/submissions/${input.submissionId}`);
  revalidateUserDashboards(input.submissionId);
  return { message: "심의 결과가 저장되었습니다. 이메일은 결과 안내에서 따로 발송해주세요.", row: result.row };
}

export async function updateStationReviewsBulkAction(payload: Omit<BulkStationReviewInput, "actorUserId">): Promise<AdminActionState> {
  const actor = await requireAdminAction();
  const result = await saveManagedStationReviews(createAdminClient(), { ...payload, actorUserId: actor.id });
  if (!result.ok) return { error: result.error ?? "선택한 방송사를 저장하지 못했습니다." };
  for (const prefix of ["", "/en"]) {
    revalidatePath(`${prefix}/admin/submissions`);
    revalidatePath(`${prefix}/admin/submissions/detail`);
    revalidatePath(`${prefix}/admin/submissions/${payload.submissionId}`);
  }
  revalidateUserDashboards(payload.submissionId);
  return { message: `${result.savedCount ?? payload.stations.length}개 방송사의 결과를 저장했습니다. 이메일은 별도로 발송해주세요.` };
}

export async function updateStationReviewFormAction(
  formData: FormData,
): Promise<void> {
  await requireAdminAction();
  const getFormValue = (key: string) => {
    const direct = formData.get(key);
    if (direct !== null) return direct;
    for (const [name, value] of formData.entries()) {
      if (name === key || name.endsWith(`_${key}`)) {
        return value;
      }
    }
    return null;
  };

  const submissionId = String(getFormValue("submission_id") ?? "").trim();
  const stationId = normalizeUuid(String(getFormValue("station_id") ?? "").trim());
  const reviewId = normalizeUuid(String(getFormValue("review_id") ?? "").trim());
  const statusRaw = String(getFormValue("station_status") ?? "").trim().toUpperCase();
  const resultNote = String(getFormValue("station_memo") ?? "").trim();
  const expectedUpdatedAt = String(getFormValue("expected_updated_at") ?? "").trim() || null;
  const ageRatingRaw = String(getFormValue("age_rating") ?? "").trim();
  const ageRating = ageRatingRaw || null;
  const trackResultsJson = String(getFormValue("track_results_json") ?? "").trim();
  const hasTrackResultsInput = trackResultsJson.length > 0;

  console.info("[station_review][form][parse][start]", {
    submissionId,
    stationId,
    reviewId,
    statusRaw,
    trackResultsJsonLength: trackResultsJson.length,
    trackResultsInput: hasTrackResultsInput,
  });

  if (!submissionId || !statusRaw) {
    console.error("[station_review][form][parse][missing_fields]", {
      submissionId,
      stationId,
      statusRaw,
      hasTrackJson: hasTrackResultsInput,
    });
    redirect(
      buildSubmissionFormRedirect(formData, submissionId || "", {
        saved: "station_error",
        savedError: "필수 값이 누락되었습니다.",
      }),
    );
  }

  if (!stationId && !reviewId) {
    redirect(buildSubmissionFormRedirect(formData, submissionId, { saved: "station_error", savedError: "신청 방송국을 확인하지 못했습니다. 화면을 새로고침해주세요." }));
  }

  const selectableStationStatusValues = stationReviewStatusOptions.map(
    (option) => option.value,
  );
  selectableStationStatusValues.push("NOT_SENT", "RECEIVED");
  const status = selectableStationStatusValues.includes(
    statusRaw as (typeof selectableStationStatusValues)[number],
  )
    ? (statusRaw as (typeof selectableStationStatusValues)[number])
    : "SENT";

  let trackResults: Array<z.infer<typeof trackResultSchema>> | undefined = undefined;
  const trackResultsWarnings: string[] = [];
  if (hasTrackResultsInput) {
    try {
      const parsedTrackResults = JSON.parse(trackResultsJson);
      if (Array.isArray(parsedTrackResults)) {
        const invalidStatuses: string[] = [];
        const invalidTrackIds: string[] = [];
        const normalized = parsedTrackResults.map((item) => {
          const trackIdRaw = typeof item?.track_id === "string" ? item.track_id : undefined;
          const trackId =
            trackIdRaw && z.string().uuid().safeParse(trackIdRaw).success
              ? trackIdRaw
              : undefined;
          if (trackIdRaw && !trackId) {
            invalidTrackIds.push(trackIdRaw);
          }
          const statusValue =
            typeof item?.status === "string" ? item.status.toUpperCase() : "PENDING";
          const statusParsed = trackResultStatusEnum.safeParse(statusValue);
          if (!statusParsed.success) {
            invalidStatuses.push(statusValue);
          }
          return {
            trackId,
            trackNo:
              typeof item?.track_no === "number" && Number.isFinite(item.track_no)
                ? item.track_no
                : undefined,
            title: typeof item?.title === "string" ? item.title : undefined,
            status: statusParsed.success ? statusParsed.data : "PENDING",
          };
        });
        if (invalidStatuses.length > 0) {
          trackResultsWarnings.push(
            `TRACK_RESULTS_STATUS_INVALID: ${invalidStatuses.slice(0, 2).join(", ")}`,
          );
        }
        if (invalidTrackIds.length > 0) {
          trackResultsWarnings.push(
            `TRACK_RESULTS_TRACK_ID_INVALID: ${invalidTrackIds.slice(0, 2).join(", ")}`,
          );
        }
        if (normalized.length > 0) {
          trackResults = normalized;
        }
      } else {
        trackResultsWarnings.push("TRACK_RESULTS_FORMAT_INVALID");
      }
    } catch (error) {
      console.error("[station_review][form][parse][track_results_json_error]", {
        error,
        errorStack: (error as Error)?.stack,
      });
      trackResultsWarnings.push("TRACK_RESULTS_PARSE_ERROR");
    }
  }

  const trackResultsSampleParsed = trackResults?.slice(0, 2).map((item) => ({
    track_id: item.trackId ?? null,
    track_no: item.trackNo ?? null,
    status: item.status,
  }));

  console.info("[station_review][form][parse][done]", {
    submissionId,
    stationId,
    reviewId,
    status,
    trackResultsCount: trackResults?.length ?? 0,
    trackResultsSample: trackResultsSampleParsed ?? [],
    trackResultsWarnings,
  });

  if (trackResultsWarnings.length > 0) {
    redirect(buildSubmissionFormRedirect(formData, submissionId, {
      saved: "station_error",
      savedError: "트랙 결과 형식이 올바르지 않아 저장하지 않았습니다. 화면을 새로고침 후 다시 시도해주세요.",
    }));
  }

  const result = await updateStationReviewAction({
    reviewId: reviewId || undefined,
    submissionId,
    stationId,
    status,
    resultNote,
    trackResults,
    expectedUpdatedAt,
    ageRating: ageRating as "ALL" | "12" | "15" | "19" | null,
    applyOverallStatus: getFormValue("apply_overall_status") === "true",
  });
  if (result.error) {
    console.error("[station_review][form][save][error]", {
      submissionId,
      stationId,
      error: result.error,
    });
    if (submissionId) {
      redirect(
        buildSubmissionFormRedirect(formData, submissionId, {
          saved: "station_error",
          savedError: result.error,
        }),
      );
    }
    return;
  }

  revalidatePath("/admin/submissions");
  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    revalidateUserDashboards(submissionId);
    const warningMessages = [...trackResultsWarnings, result.warning].filter(Boolean);
    if (warningMessages.length > 0) {
      redirect(
        buildSubmissionFormRedirect(formData, submissionId, {
          saved: "station_warning",
          savedWarning: warningMessages.join(" / "),
        }),
      );
    }
    redirect(
      buildSubmissionFormRedirect(formData, submissionId, {
        saved: "station",
      }),
    );
  }
}

const createTrackSchema = z.object({
  submissionId: z.string().uuid(),
  trackTitle: z.string().min(1, "트랙명을 입력하세요."),
  trackNo: z.coerce.number().int().positive().optional(),
  performer: z.string().max(2_000).optional(),
  composer: z.string().optional(),
  lyricist: z.string().optional(),
  arranger: z.string().optional(),
});

const deleteTrackSchema = z.object({
  submissionId: z.string().uuid(),
  trackId: z.string().uuid(),
});

export async function createTrackForSubmissionAction(
  formData: FormData,
): Promise<void> {
  await requireAdminAction();
  const parsed = createTrackSchema.safeParse({
    submissionId: formData.get("submissionId"),
    trackTitle: formData.get("trackTitle"),
    trackNo: formData.get("trackNo"),
    performer: formData.get("performer"),
    composer: formData.get("composer"),
    lyricist: formData.get("lyricist"),
    arranger: formData.get("arranger"),
  });

  if (!parsed.success) {
    console.error("createTrack validation failed", parsed.error.flatten().fieldErrors);
    return;
  }

  const supabase = createAdminClient();
  let performer = parsed.data.performer?.trim() ?? "";
  if (!performer) {
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .select("artist_name")
      .eq("id", parsed.data.submissionId)
      .maybeSingle();
    if (submissionError) {
      console.error("createTrack performer fallback lookup error", submissionError);
      return;
    }
    performer = submission?.artist_name?.trim() ?? "";
  }
  let trackNo = parsed.data.trackNo;
  if (!trackNo) {
    const { data: existing } = await supabase
      .from("album_tracks")
      .select("track_no")
      .eq("submission_id", parsed.data.submissionId)
      .order("track_no", { ascending: false })
      .limit(1);
    const maxNo = existing?.[0]?.track_no;
    trackNo = typeof maxNo === "number" && Number.isFinite(maxNo) ? maxNo + 1 : 1;
  }

  const { data: createdTrack, error } = await supabase.from("album_tracks").insert({
    submission_id: parsed.data.submissionId,
    track_no: trackNo,
    track_title: parsed.data.trackTitle,
    performer: performer || null,
    composer: parsed.data.composer || null,
    lyricist: parsed.data.lyricist || null,
    arranger: parsed.data.arranger || null,
  }).select("id").single();

  if (error || !createdTrack) {
    redirect(buildSubmissionFormRedirect(formData, parsed.data.submissionId, {
      saved: "error", savedError: "트랙을 저장하지 못했습니다. 다시 시도해주세요.",
    }));
  }
  const eventWarning = await insertEvent(parsed.data.submissionId, "관리자가 접수 트랙을 추가했습니다.", "TRACK_ADDED")
    .then(() => undefined, () => auditWarning);
  const notification = await sendSubmissionUpdateNotificationById({
    submissionId: parsed.data.submissionId, changeKey: `track-added-${createdTrack.id}`,
    headline: "접수 트랙 정보가 업데이트되었습니다.", summary: "접수에 트랙이 추가되었습니다. 신청 내역에서 곡 목록을 확인해주세요.",
    subject: "[onside] 접수 트랙 업데이트 안내",
  });

  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${parsed.data.submissionId}`);
  revalidateUserDashboards(parsed.data.submissionId);
  redirect(
    buildSubmissionFormRedirect(formData, parsed.data.submissionId, {
      saved: "track", savedWarning: combineWarnings(eventWarning, notification.warning),
    }),
  );
}

export async function deleteTrackForSubmissionAction(
  formData: FormData,
): Promise<void> {
  await requireAdminAction();
  const parsed = deleteTrackSchema.safeParse({
    submissionId: formData.get("submissionId"),
    trackId: formData.get("trackId"),
  });

  if (!parsed.success) {
    console.error("deleteTrack validation failed", parsed.error.flatten().fieldErrors);
    return;
  }

  const admin = createAdminClient();
  const { data: trackRow, error: trackError } = await admin
    .from("album_tracks")
    .select("track_no")
    .eq("id", parsed.data.trackId)
    .eq("submission_id", parsed.data.submissionId)
    .maybeSingle();

  if (trackError) redirect(buildSubmissionFormRedirect(formData, parsed.data.submissionId, { saved: "error", savedError: "트랙 정보를 확인하지 못했습니다." }));
  if (!trackRow) redirect(buildSubmissionFormRedirect(formData, parsed.data.submissionId, { saved: "track_unchanged" }));
  const trackNo = trackRow.track_no ?? null;
  let cleanupWarning: string | undefined;

  const { data: deletedTracks, error: deleteError } = await admin
    .from("album_tracks")
    .delete()
    .eq("id", parsed.data.trackId)
    .eq("submission_id", parsed.data.submissionId).select("id");

  if (deleteError) {
    redirect(buildSubmissionFormRedirect(formData, parsed.data.submissionId, { saved: "error", savedError: "트랙을 삭제하지 못했습니다." }));
  }

  if (!deletedTracks?.length) redirect(buildSubmissionFormRedirect(formData, parsed.data.submissionId, { saved: "track_unchanged" }));

  const { data: stationReviewsData, error: stationReviewsError } = await admin
    .from("station_reviews")
    .select(`id, ${STATION_REVIEW_TRACK_RESULTS_SELECT}`)
    .eq("submission_id", parsed.data.submissionId);
  let stationReviews = stationReviewsData ?? null;

  const missingJsonColumn =
    stationReviewsError?.code === "42703" ||
    stationReviewsError?.message?.toLowerCase().includes("track_results_json");
  if (stationReviewsError && missingJsonColumn) {
    const fallback = await admin
      .from("station_reviews")
      .select(`id, ${LEGACY_TRACK_RESULTS_SELECT}`)
      .eq("submission_id", parsed.data.submissionId);
    stationReviews = fallback.data ?? stationReviews;
    if (fallback.error) cleanupWarning = "트랙은 삭제되었지만 방송국 결과 정리를 완료하지 못했습니다. 심의 결과를 확인해주세요.";
  }

  if (stationReviewsError && !missingJsonColumn) cleanupWarning = "트랙은 삭제되었지만 방송국 결과를 확인하지 못했습니다.";

  if (stationReviews && stationReviews.length > 0) {
    type TrackResultEntry = {
      track_id?: unknown;
      trackId?: unknown;
      track_no?: unknown;
      trackNo?: unknown;
      [key: string]: unknown;
    };
    for (const review of stationReviews) {
      const rawResults = Array.isArray(review.track_results)
        ? (review.track_results as TrackResultEntry[])
        : [];
      const filtered = rawResults.filter((entry) => {
        const idMatch =
          (typeof entry.track_id === "string" && entry.track_id === parsed.data.trackId) ||
          (typeof entry.trackId === "string" && entry.trackId === parsed.data.trackId);
        const noMatch =
          trackNo !== null &&
          ((typeof entry.track_no === "number" && entry.track_no === trackNo) ||
            (typeof entry.trackNo === "number" && entry.trackNo === trackNo));
        return !idMatch && !noMatch;
      });

      if (filtered.length !== rawResults.length) {
        const payload = {
          [STATION_REVIEW_TRACK_RESULTS_COLUMN]: filtered.length > 0 ? filtered : null,
        };
        let { error: updateError } = await admin
          .from("station_reviews")
          .update(payload)
          .eq("id", review.id);
        if (updateError) {
          const fallbackMissing =
            updateError.code === "42703" ||
            updateError.message?.toLowerCase().includes("track_results_json");
          if (fallbackMissing) {
            ({ error: updateError } = await admin
              .from("station_reviews")
              .update({
                [LEGACY_TRACK_RESULTS_COLUMN]: filtered.length > 0 ? filtered : null,
              })
              .eq("id", review.id));
          }
        }
        if (updateError) {
          cleanupWarning = "트랙은 삭제되었지만 방송국 결과 정리를 완료하지 못했습니다. 심의 결과를 확인해주세요.";
        }
      }
    }
  }

  const eventWarning = await insertEvent(parsed.data.submissionId, "관리자가 접수 트랙을 삭제했습니다.", "TRACK_DELETED")
    .then(() => undefined, () => auditWarning);
  const notification = await sendSubmissionUpdateNotificationById({
    submissionId: parsed.data.submissionId, changeKey: `track-deleted-${parsed.data.trackId}`,
    headline: "접수 트랙 정보가 업데이트되었습니다.", summary: "접수에서 트랙이 삭제되었습니다. 신청 내역에서 곡 목록과 심의 결과를 확인해주세요.",
    subject: "[onside] 접수 트랙 업데이트 안내",
  });
  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${parsed.data.submissionId}`);
  revalidatePath(`/admin/submissions/detail?id=${parsed.data.submissionId}`);
  revalidateUserDashboards(parsed.data.submissionId);
  revalidatePath("/");
  redirect(
    buildSubmissionFormRedirect(formData, parsed.data.submissionId, {
      saved: "track_deleted", savedWarning: combineWarnings(cleanupWarning, eventWarning, notification.warning),
    }),
  );
}

export async function updateSubmissionResultAction(
  payload: z.infer<typeof submissionResultSchema>,
): Promise<AdminActionState> {
  const actor = await requireAdminAction();
  const parsed = submissionResultSchema.safeParse(payload);
  if (!parsed.success) return { error: "입력값을 확인해주세요." };
  const admin = createAdminClient();
  const completion = await completeMvReviewFlow(admin, parsed.data.submissionId, {
    actorUserId: actor.id, includeNonMv: true,
    resultStatus: parsed.data.resultStatus, resultMemo: parsed.data.resultMemo ?? null,
  });
  if (completion.error || !completion.completed) return { error: completion.error ?? "결과 정보를 저장하지 못했습니다." };
  if (!completion.changed) return { message: "변경된 내용이 없습니다." };
  revalidatePath(`/admin/submissions/${parsed.data.submissionId}`);
  revalidateUserDashboards(parsed.data.submissionId);
  return { message: "결과 정보를 저장했습니다. 이메일은 결과 안내에서 따로 발송해주세요." };
}

export async function updateSubmissionResultFormAction(
  formData: FormData,
): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const resultStatus = String(
    formData.get("resultStatus") ?? "",
  ) as z.infer<typeof resultStatusEnum>;
  const resultMemo = String(formData.get("resultMemo") ?? "") || undefined;
  const result = await updateSubmissionResultAction({
    submissionId,
    resultStatus,
    resultMemo,
  });
  if (result.error) {
    console.error(result.error);
    if (submissionId) {
      redirect(
        buildSubmissionFormRedirect(formData, submissionId, {
          saved: "error",
          savedError: result.error,
        }),
      );
    }
    return;
  }

  if (submissionId) {
    revalidatePath(`/admin/submissions/${submissionId}`);
    revalidateUserDashboards(submissionId);
    revalidatePath("/");
    if (result.warning) {
      redirect(
        buildSubmissionFormRedirect(formData, submissionId, {
          saved: "result_warning",
          savedWarning: result.warning,
        }),
      );
    }
    redirect(
      buildSubmissionFormRedirect(formData, submissionId, {
        saved: "result",
      }),
    );
  }
}

export async function notifySubmissionResultAction(submissionId: string, preview?: {
  expectedRevision: string; expectedUpdatedAt: string; requestId: string;
}): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = z.object({ submissionId: z.string().uuid(), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    expectedUpdatedAt: z.string().datetime({ offset: true }), requestId: z.string().uuid() }).safeParse({ submissionId, ...preview });
  if (!parsed.success) return { error: "결과 이메일 미리보기를 확인한 뒤 발송해주세요." };
  const notification = await sendReviewSummaryNotificationById(parsed.data);
  if (notification.errorCode) return { error: notification.error ?? "최신 이메일 미리보기를 다시 확인해주세요." };
  return { message: "결과 이메일 발송을 요청했습니다.", warning: notification.warning };
}

export async function notifySubmissionResultFormAction(formData: FormData): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const result = await notifySubmissionResultAction(submissionId, {
    expectedRevision: String(formData.get("expectedRevision") ?? ""),
    expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
    requestId: String(formData.get("requestId") ?? ""),
  });
  revalidatePath(`/admin/submissions/detail`);
  redirect(buildSubmissionFormRedirect(formData, submissionId, {
    saved: result.error ? "notification_error" : result.warning ? "notification_warning" : "notification",
    savedError: result.error, savedWarning: result.warning,
  }));
}

export async function notifySubmissionProgressAction(submissionId: string): Promise<AdminActionState> {
  await requireAdminAction();
  if (!z.string().uuid().safeParse(submissionId).success) return { error: "접수 ID를 확인해주세요." };
  const { data, error } = await createAdminClient().from("submissions")
    .select("status, payment_status").eq("id", submissionId).maybeSingle();
  const status = reviewStatusEnum.safeParse(data?.status);
  const payment = paymentStatusEnum.safeParse(data?.payment_status);
  if (error || !data || !status.success || status.data === "DRAFT" || !payment.success) {
    return { error: "제출된 접수의 현재 진행상황을 확인한 뒤 다시 시도해주세요." };
  }
  const eventWarning = await insertEvent(submissionId, "관리자가 현재 진행상황 안내 이메일 재발송을 요청했습니다.", "PROGRESS_NOTIFICATION_RETRY")
    .then(() => undefined, () => "안내 재발송 요청 기록을 저장하지 못했습니다. 이메일 발송 내역을 확인해주세요.");
  const notification = await sendSubmissionUpdateNotificationById({
    submissionId, changeKey: `manual-progress-${randomUUID()}`,
    headline: "현재 접수 진행상황을 안내드립니다.",
    summary: `현재 상태: ${reviewStatusLabelMap[status.data]}\n결제 상태: ${paymentStatusLabelMap[payment.data]}\n신청 내역에서 방송국·트랙·보완 요청과 공개된 심의 결과를 확인해주세요.`,
    subject: "[onside] 현재 접수 진행상황 안내",
  });
  return { message: "현재 진행상황 안내 재발송을 요청했습니다.", warning: combineWarnings(eventWarning, notification.warning) };
}

export async function notifySubmissionProgressFormAction(formData: FormData): Promise<void> {
  const submissionId = String(formData.get("submissionId") ?? "");
  const result = await notifySubmissionProgressAction(submissionId);
  revalidatePath("/admin/submissions/detail");
  redirect(buildSubmissionFormRedirect(formData, submissionId, {
    saved: result.error ? "notification_error" : result.warning ? "notification_warning" : "notification",
    savedError: result.error, savedWarning: result.warning,
  }));
}

export async function updateArtistAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  await requireAdminAction();
  const artistId = String(formData.get("artistId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const thumbnailUrl = String(formData.get("thumbnailUrl") ?? "").trim();
  if (!z.string().uuid().safeParse(artistId).success) return { error: "아티스트 정보를 확인한 뒤 다시 저장해주세요." };
  if (!name || name.length > 500) return { error: "아티스트명은 1~500자로 입력해주세요." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("artists")
    .update({ name, thumbnail_url: thumbnailUrl || null })
    .eq("id", artistId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("updateArtistAction failed", error);
    return { error: error.code === "23505" ? "이미 사용 중인 아티스트명입니다. 다른 이름을 입력해주세요." : "아티스트 정보를 저장하지 못했습니다. 입력 내용을 확인하고 다시 시도해주세요." };
  }
  if (!data) return { error: "아티스트를 찾을 수 없습니다. 목록을 새로고침해주세요." };
  revalidatePath("/admin/artists");
  revalidatePath(`/admin/artists/${artistId}`);
  revalidatePath(`/dashboard/artists/${artistId}`);
  revalidateUserDashboards();
  return { message: "아티스트 정보를 저장했습니다." };
}

export async function upsertPackageAction(
  payload: z.infer<typeof packageSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = packageSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "패키지 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("packages").upsert({
    id: parsed.data.id,
    name: parsed.data.name,
    station_count: parsed.data.stationCount,
    price_krw: parsed.data.priceKrw,
    description: parsed.data.description || null,
    is_active: parsed.data.isActive,
  });

  if (error) {
    return { error: "패키지 저장에 실패했습니다." };
  }

  updateTag(PUBLIC_CATALOG_CACHE_TAG);
  return { message: "패키지가 저장되었습니다." };
}

export async function upsertPackageFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const id = String(formData.get("id") ?? "");
  const result = await upsertPackageAction({
    id: id ? id : undefined,
    name: String(formData.get("name") ?? ""),
    stationCount: Number(formData.get("stationCount") ?? 0),
    priceKrw: Number(formData.get("priceKrw") ?? 0),
    description: String(formData.get("description") ?? "") || undefined,
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
  redirect(withSavedQuery("/admin/config"));
}

export async function upsertStationAction(
  payload: z.infer<typeof stationSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = stationSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "방송국 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("stations").upsert({
    id: parsed.data.id,
    name: parsed.data.name,
    code: parsed.data.code,
    is_active: parsed.data.isActive,
  });

  if (error) {
    return { error: "방송국 저장에 실패했습니다." };
  }

  updateTag(PUBLIC_CATALOG_CACHE_TAG);
  return { message: "방송국 정보가 저장되었습니다." };
}

export async function upsertStationFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const id = String(formData.get("id") ?? "");
  const result = await upsertStationAction({
    id: id ? id : undefined,
    name: String(formData.get("name") ?? ""),
    code: String(formData.get("code") ?? ""),
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
  redirect(withSavedQuery("/admin/config"));
}

export async function updatePackageStationsAction(
  payload: z.infer<typeof packageStationsSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = packageStationsSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "방송국 코드를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const codes = parsed.data.stationCodes
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  const { data: stations, error: stationError } = await supabase
    .from("stations")
    .select("id, code")
    .in("code", codes);

  if (stationError) {
    return { error: "방송국 정보를 찾을 수 없습니다." };
  }

  if (codes.length > 0 && (stations?.length ?? 0) !== codes.length) {
    return { error: "일부 방송국 코드를 찾을 수 없습니다." };
  }

  const { error: deleteError } = await supabase
    .from("package_stations")
    .delete()
    .eq("package_id", parsed.data.packageId);

  if (deleteError) {
    return { error: "패키지 방송국 매핑 저장 실패" };
  }
  if (stations && stations.length > 0) {
    const rows = stations.map((station) => ({
      package_id: parsed.data.packageId,
      station_id: station.id,
    }));
    const { error } = await supabase.from("package_stations").insert(rows);
    if (error) {
      // The deletion already changed the catalog even though insertion failed.
      updateTag(PUBLIC_CATALOG_CACHE_TAG);
      return { error: "패키지 방송국 매핑 저장 실패" };
    }
  }

  updateTag(PUBLIC_CATALOG_CACHE_TAG);
  return { message: "패키지 방송국이 업데이트되었습니다." };
}

export async function updatePackageStationsFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const result = await updatePackageStationsAction({
    packageId: String(formData.get("packageId") ?? ""),
    stationCodes: String(formData.get("stationCodes") ?? ""),
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
  redirect(withSavedQuery("/admin/config"));
}

export async function updateAlbumReviewDiscountAction(
  payload: z.infer<typeof albumReviewDiscountSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = albumReviewDiscountSchema.safeParse({
    discountPercent: normalizeAlbumDiscountPercent(payload.discountPercent),
  });
  if (!parsed.success) {
    return { error: "음반 할인율은 0~100 사이 숫자로 입력해주세요." };
  }

  if (parsed.data.discountPercent !== 0) {
    return { error: "음반 심의는 정상 가격으로 운영됩니다. 할인율을 적용할 수 없습니다." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("site_settings").upsert({
    key: ALBUM_REVIEW_DISCOUNT_SETTING_KEY,
    value: { discountPercent: parsed.data.discountPercent },
    description: "음반 심의 전체 패키지 공통 할인율(%)",
  });

  if (error) {
    console.error("updateAlbumReviewDiscountAction failed", error);
    return {
      error:
        "음반 할인율 저장에 실패했습니다. site_settings 마이그레이션 적용 여부를 확인해주세요.",
    };
  }

  updateTag(PUBLIC_ALBUM_DISCOUNT_CACHE_TAG);
  return { message: "음반 할인율이 저장되었습니다." };
}

export async function updateAlbumReviewDiscountFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const submittedPercent =
    formData.get("quickDiscountPercent") ?? formData.get("discountPercent");
  const result = await updateAlbumReviewDiscountAction({
    discountPercent: Number(submittedPercent ?? 0),
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
  revalidatePath("/dashboard/new/album");
  revalidatePath("/en/dashboard/new/album");
  redirect(withSavedQuery("/admin/config"));
}

export async function deletePackageAction(
  payload: { id: string },
): Promise<AdminActionState> {
  await requireAdminAction();
  if (!payload.id) {
    return { error: "패키지 ID를 확인해주세요." };
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("packages").delete().eq("id", payload.id);
  if (error) {
    return { error: "패키지 삭제에 실패했습니다." };
  }
  updateTag(PUBLIC_CATALOG_CACHE_TAG);
  return { message: "패키지가 삭제되었습니다." };
}

export async function deletePackageFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const result = await deletePackageAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
}

export async function deleteStationAction(
  payload: { id: string },
): Promise<AdminActionState> {
  await requireAdminAction();
  if (!payload.id) {
    return { error: "방송국 ID를 확인해주세요." };
  }
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("stations").delete().eq("id", payload.id);
  if (error) {
    return { error: "방송국 삭제에 실패했습니다." };
  }
  updateTag(PUBLIC_CATALOG_CACHE_TAG);
  return { message: "방송국이 삭제되었습니다." };
}

export async function deleteStationFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const result = await deleteStationAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
}

export async function upsertAdBannerAction(
  payload: z.infer<typeof adBannerSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = adBannerSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "배너 정보를 확인해주세요." };
  }

  if (!parsed.data.imageUrl) {
    return { error: "배너 이미지를 입력하거나 업로드해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("ad_banners").upsert({
    id: parsed.data.id,
    title: parsed.data.title,
    description: parsed.data.description || null,
    image_url: parsed.data.imageUrl,
    link_url: parsed.data.linkUrl || null,
    placement: parsed.data.placement ?? "STRIP",
    sort_order: parsed.data.sortOrder ?? 0,
    is_active: parsed.data.isActive,
  });

  if (error) {
    const message = error.message?.toLowerCase() ?? "";
    if (message.includes("ad_banners") && message.includes("schema cache")) {
      return {
        error:
          "배너 테이블이 아직 생성되지 않았습니다. Supabase 마이그레이션을 실행해주세요.",
      };
    }
    return { error: "배너 저장에 실패했습니다." };
  }

  updateTag(PUBLIC_AD_BANNERS_CACHE_TAG);
  return { message: "배너가 저장되었습니다." };
}

export async function upsertAdBannerFormAction(
  formData: FormData,
): Promise<void> {
  await requireAdminAction();
  const id = String(formData.get("id") ?? "");
  const placementValue = String(formData.get("placement") ?? "STRIP");
  const placement =
    placementValue === "HOME_HERO" || placementValue === "LEFT"
      ? placementValue
      : "STRIP";
  const imageFile = formData.get("imageFile");
  let imageUrl = String(formData.get("imageUrl") ?? "");

  if (imageFile instanceof File && imageFile.size > 0) {
    const uploadResult = await uploadBannerImage(imageFile, placement);
    if (uploadResult.error) {
      console.error(uploadResult.error);
      return;
    }
    imageUrl = uploadResult.publicUrl ?? imageUrl;
  }

  const result = await upsertAdBannerAction({
    id: id ? id : undefined,
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? "") || undefined,
    imageUrl: imageUrl || undefined,
    linkUrl: String(formData.get("linkUrl") ?? "") || undefined,
    placement,
    sortOrder: Number.parseInt(String(formData.get("sortOrder") ?? "0"), 10) || 0,
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/banners");
  revalidatePath("/");
  redirect(withSavedQuery("/admin/banners"));
}

export async function deleteAdBannerAction(
  payload: { id: string },
): Promise<AdminActionState> {
  await requireAdminAction();
  if (!payload.id) {
    return { error: "배너 ID를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("ad_banners").delete().eq("id", payload.id);

  if (error) {
    const message = error.message?.toLowerCase() ?? "";
    if (message.includes("ad_banners") && message.includes("schema cache")) {
      return {
        error:
          "배너 테이블이 아직 생성되지 않았습니다. Supabase 마이그레이션을 실행해주세요.",
      };
    }
    return { error: "배너 삭제에 실패했습니다." };
  }

  updateTag(PUBLIC_AD_BANNERS_CACHE_TAG);
  return { message: "배너가 삭제되었습니다." };
}

export async function deleteAdBannerFormAction(
  formData: FormData,
): Promise<void> {
  const result = await deleteAdBannerAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    console.error(result.error);
    return;
  }
  revalidatePath("/admin/banners");
  revalidatePath("/");
}

export async function upsertProfanityTermAction(
  payload: z.infer<typeof profanityTermSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = profanityTermSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "욕설/비속어 정보를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("profanity_terms").upsert({
    id: parsed.data.id,
    term: parsed.data.term.trim(),
    language: parsed.data.language,
    is_active: parsed.data.isActive,
  });

  if (error) {
    return { error: "욕설/비속어 저장에 실패했습니다." };
  }

  updateTag(PUBLIC_PROFANITY_TERMS_CACHE_TAG);
  return { message: "욕설/비속어가 저장되었습니다." };
}

export async function upsertProfanityTermFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const id = String(formData.get("id") ?? "");
  const result = await upsertProfanityTermAction({
    id: id ? id : undefined,
    term: String(formData.get("term") ?? ""),
    language: (String(formData.get("language") ?? "KO") || "KO") as
      | "KO"
      | "EN",
    isActive: formData.get("isActive") === "on",
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
  revalidatePath("/dashboard/new/album");
  redirect(withSavedQuery("/admin/config"));
}

export async function deleteProfanityTermAction(
  payload: { id: string },
): Promise<AdminActionState> {
  await requireAdminAction();
  if (!payload.id) {
    return { error: "욕설/비속어 ID를 확인해주세요." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("profanity_terms")
    .delete()
    .eq("id", payload.id);

  if (error) {
    return { error: "욕설/비속어 삭제에 실패했습니다." };
  }

  updateTag(PUBLIC_PROFANITY_TERMS_CACHE_TAG);
  return { message: "욕설/비속어가 삭제되었습니다." };
}

export async function deleteProfanityTermFormAction(
  formData: FormData,
): Promise<AdminActionState | void> {
  const result = await deleteProfanityTermAction({
    id: String(formData.get("id") ?? ""),
  });
  if (result.error) {
    return result;
  }
  revalidatePath("/admin/config");
  revalidatePath("/dashboard/new/album");
}

export async function deleteSubmissionsAction(
  payload: z.infer<typeof deleteSubmissionsSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = deleteSubmissionsSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "삭제할 접수 ID를 확인해주세요." };
  }

  const supabase = await createAdminClient();
  const ids = Array.from(new Set(parsed.data.ids));
  const b2ObjectRefs = await loadSubmissionB2ObjectRefs(supabase, ids);
  const { data: deletedRows, error } = await supabase
    .from("submissions")
    .delete()
    .in("id", ids)
    .select("id");

  if (error) {
    console.error("admin delete submissions error", error);
    return { error: "접수 삭제에 실패했습니다." };
  }

  const deletedIds = (deletedRows ?? []).map((row) => String(row.id));
  if (deletedIds.length > 0 && b2ObjectRefs.length > 0) {
    after(() =>
      cleanupDeletedSubmissionB2Objects(supabase, b2ObjectRefs, deletedIds),
    );
  }

  revalidatePath("/admin/submissions");
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  revalidatePath("/mypage");
  revalidatePath("/");
  ids.forEach((id) => {
    revalidatePath(`/admin/submissions/${id}`);
    revalidatePath(`/admin/submissions/detail?id=${id}`);
  });

  return { message: "접수가 삭제되었습니다." };
}

export async function deleteSubmissionsFormAction(
  formData: FormData,
): Promise<void> {
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const redirectTo = safeAdminRedirectPath(
    String(formData.get("redirectTo") ?? ""),
    "/admin/submissions",
  );

  const result = await deleteSubmissionsAction({ ids });
  if (result.error) {
    console.error(result.error);
    return;
  }

  redirect(redirectTo);
}

export async function deleteArtistAction(
  payload: z.infer<typeof deleteArtistSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = deleteArtistSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "삭제할 아티스트 ID를 확인해주세요." };
  }

  const admin = createAdminClient();
  const { error: unlinkError } = await admin
    .from("submissions")
    .update({ artist_id: null })
    .eq("artist_id", parsed.data.id);
  if (unlinkError && unlinkError.code !== "42703") {
    console.error("admin unlink artist from submissions error", unlinkError);
    return { error: "아티스트 삭제 전 참조 정리에 실패했습니다." };
  }

  const { error } = await admin.from("artists").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("admin delete artist error", error);
    return { error: "아티스트 삭제에 실패했습니다." };
  }

  revalidatePath("/admin/artists");
  revalidatePath(`/admin/artists/${parsed.data.id}`);
  revalidatePath("/admin/submissions");
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  return { message: "아티스트를 삭제했습니다." };
}

export async function deleteArtistsAction(
  payload: z.infer<typeof deleteArtistsSchema>,
): Promise<AdminActionState> {
  await requireAdminAction();
  const parsed = deleteArtistsSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "삭제할 아티스트 ID를 확인해주세요." };
  }

  const admin = createAdminClient();
  const ids = parsed.data.ids;

  const { error: unlinkError } = await admin
    .from("submissions")
    .update({ artist_id: null })
    .in("artist_id", ids);
  if (unlinkError && unlinkError.code !== "42703") {
    console.error("admin bulk unlink artists from submissions error", unlinkError);
    return { error: "아티스트 삭제 전 참조 정리에 실패했습니다." };
  }

  const { error } = await admin.from("artists").delete().in("id", ids);
  if (error) {
    console.error("admin bulk delete artists error", error);
    return { error: "선택한 아티스트 삭제에 실패했습니다." };
  }

  revalidatePath("/admin/artists");
  revalidatePath("/admin/submissions");
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  ids.forEach((id) => {
    revalidatePath(`/admin/artists/${id}`);
    revalidatePath(`/dashboard/artists/${id}`);
  });
  return { message: `${ids.length}명의 아티스트를 삭제했습니다.` };
}

export async function deleteArtistFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const redirectTo = safeAdminRedirectPath(
    String(formData.get("redirectTo") ?? ""),
    "/admin/artists",
  );
  const result = await deleteArtistAction({ id });
  if (result.error) {
    console.error(result.error);
    return;
  }
  redirect(redirectTo);
}

export async function deleteArtistsFormAction(formData: FormData): Promise<void> {
  const redirectTo = safeAdminRedirectPath(
    String(formData.get("redirectTo") ?? ""),
    "/admin/artists",
  );
  const ids = formData
    .getAll("ids")
    .map((value) => String(value))
    .map((value) => value.trim())
    .filter(Boolean);

  const result = await deleteArtistsAction({ ids });
  if (result.error) {
    console.error(result.error);
    return;
  }
  redirect(redirectTo);
}

export async function saveSubmissionAdminFormAction(
  formData: FormData,
): Promise<void> {
  const actor = await requireAdminAction();
  const submissionId = String(formData.get("submissionId") ?? "").trim();
  if (!submissionId) {
    return;
  }

  const redirectWithError = (message: string): never => {
    redirect(
      buildSubmissionFormRedirect(formData, submissionId, {
        saved: "error",
        savedError: message,
      }),
    );
  };

  const status = String(formData.get("status") ?? "").trim();
  const operationalStage = String(formData.get("operationalStage") ?? "").trim();
  const adminMemo = String(formData.get("adminMemo") ?? "").trim();
  const paymentStatus = String(formData.get("paymentStatus") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const artistName = String(formData.get("artistName") ?? "").trim();

  const parsedSubmissionId = uuidValueSchema.safeParse(submissionId);
  const parsedOperationalStage = adminOperationalStageEnum.safeParse(operationalStage);
  const parsedStatus = parsedOperationalStage.success
    ? null
    : reviewStatusEnum.safeParse(status);
  const parsedPaymentStatus = parsedOperationalStage.success
    ? null
    : paymentStatusEnum.safeParse(paymentStatus);

  if (!parsedSubmissionId.success) {
    redirectWithError("접수 ID가 유효하지 않습니다.");
  }
  if (!parsedOperationalStage.success && !parsedStatus?.success) {
    redirectWithError("접수 상태 값을 확인해주세요.");
  }
  if (!parsedOperationalStage.success && !parsedPaymentStatus?.success) {
    redirectWithError("결제 상태 값을 확인해주세요.");
  }

  const supabase = createAdminClient();
  const { data: currentSubmission, error: currentSubmissionError } = await supabase
    .from("submissions")
    .select("id, type, mv_desired_rating, status, payment_status, current_order_id, title, artist_name, admin_memo")
    .eq("id", submissionId)
    .maybeSingle();

  if (currentSubmissionError) {
    console.error("admin save submission load error", currentSubmissionError, {
      submissionId,
    });
    redirectWithError(currentSubmissionError.message ?? "submission load error");
  }

  if (!currentSubmission) {
    redirectWithError("접수를 찾을 수 없습니다.");
  }

  const currentSubmissionRow = currentSubmission as NonNullable<
    typeof currentSubmission
  >;
  const currentStatus = currentSubmissionRow.status as ReviewStatus;
  const currentPaymentStatus = currentSubmissionRow.payment_status as PaymentStatus;
  const mappedStage = parsedOperationalStage.success
    ? mapAdminOperationalStage(parsedOperationalStage.data, currentPaymentStatus, currentStatus)
    : null;
  const mappedStageLabel = parsedOperationalStage.success
    ? adminOperationalStageLabelMap[parsedOperationalStage.data]
    : null;
  let nextStatus = mappedStage?.status ?? (parsedStatus?.data as ReviewStatus);
  const nextPaymentStatus =
    mappedStage?.paymentStatus ?? (parsedPaymentStatus?.data as PaymentStatus);
  // An online MV result is its official rating. Publishing "결과 준비" before
  // the rating is stored would show the customer an approved-but-unrated
  // result that cannot be reverted from this screen.
  if (
    ["RESULT_READY", "COMPLETED"].includes(nextStatus) &&
    !["RESULT_READY", "COMPLETED"].includes(currentStatus) &&
    currentSubmissionRow.type === "MV_DISTRIBUTION" &&
    !isRatingCode(currentSubmissionRow.mv_desired_rating)
  ) {
    redirectWithError("온라인 뮤직비디오는 영등위 확정 등급을 먼저 저장해야 결과 준비로 변경할 수 있습니다.");
  }

  if (
    !mappedStage &&
    currentPaymentStatus !== "PAID" &&
    nextPaymentStatus === "PAID" &&
    status === currentStatus
  ) {
    nextStatus = statusAfterPaymentConfirmation(currentStatus);
  }

  const orderPayment = await confirmLinkedOrderPayment(supabase, {
    orderId: currentSubmissionRow.current_order_id,
    currentPaymentStatus,
    nextPaymentStatus,
    actorUserId: actor.id,
    adminMemo,
  });
  if (orderPayment.error) redirectWithError(orderPayment.error);
  if (orderPayment.confirmedIds) {
    if (["DRAFT", "WAITING_PAYMENT", "SUBMITTED"].includes(nextStatus)) {
      nextStatus = statusAfterPaymentConfirmation(currentStatus);
    }
    for (const id of orderPayment.confirmedIds) revalidateUserDashboards(id);
    for (const prefix of ["", "/en"]) revalidatePath(`${prefix}/mypage/orders`);
    const confirmedOrderId = currentSubmissionRow.current_order_id;
    // A requested cash receipt is issued once the deposit is confirmed (when
    // the Inicis INIAPI key is registered); failures stay visible to admins.
    if (confirmedOrderId) after(() => autoIssueRequestedCashReceipt(createAdminClient(), confirmedOrderId, actor.id));
  }
  if (orderPayment.refundedIds) {
    for (const id of orderPayment.refundedIds) revalidateUserDashboards(id);
    for (const prefix of ["", "/en"]) revalidatePath(`${prefix}/mypage/orders`);
  }

  const submissionUpdate: Record<string, unknown> = {};
  submissionUpdate.status = nextStatus;
  submissionUpdate.admin_memo = adminMemo || null;
  if (!currentSubmissionRow.current_order_id) submissionUpdate.payment_status = nextPaymentStatus;
  if (title) submissionUpdate.title = title;
  if (artistName) submissionUpdate.artist_name = artistName;

  const { data: updatedSubmission, error: submissionError } = await supabase
    .from("submissions")
    .update(submissionUpdate)
    .eq("id", submissionId)
    .select("id, status, payment_status, title, artist_name, admin_memo")
    .maybeSingle();

  if (submissionError) {
    console.error("admin save submission status error", submissionError, {
      submissionId,
      update: submissionUpdate,
    });
    redirectWithError(submissionError.message ?? "submission update error");
  }

  if (
    !updatedSubmission ||
    updatedSubmission.status !== nextStatus ||
    updatedSubmission.payment_status !== nextPaymentStatus
  ) {
    console.error("admin save submission status mismatch", {
      submissionId,
      expected: {
        status: nextStatus,
        payment_status: nextPaymentStatus,
      },
      received: updatedSubmission,
    });
    redirectWithError("저장 결과가 DB에 반영되지 않았습니다.");
  }

  const changes = [
    mappedStageLabel &&
    (currentStatus !== nextStatus || currentPaymentStatus !== nextPaymentStatus)
      ? `운영 단계: ${mappedStageLabel}`
      : null,
    !mappedStage && currentStatus !== nextStatus
      ? `접수 상태: ${reviewStatusLabelMap[nextStatus] ?? nextStatus}`
      : null,
    !mappedStage && currentPaymentStatus !== nextPaymentStatus
      ? `결제 상태: ${paymentStatusLabelMap[nextPaymentStatus] ?? nextPaymentStatus}`
      : null,
    title && currentSubmissionRow.title !== title ? "작품명이 정리되었습니다." : null,
    artistName && currentSubmissionRow.artist_name !== artistName
      ? "아티스트명이 정리되었습니다."
      : null,
  ].filter(Boolean);

  let savedWarning = "";
  if (!changes.length && (currentSubmissionRow.admin_memo ?? "") !== adminMemo) {
    // Staff-only edits keep their audit trail without sending customer mail.
    try {
      await insertEvent(submissionId, "관리자 메모가 업데이트되었습니다.", "ADMIN_MEMO");
    } catch {
      savedWarning = "상태는 저장됐지만 처리 기록 저장은 실패했습니다.";
    }
  }
  if (changes.length > 0) {
    const changeSummary = [
      ...changes,
      currentPaymentStatus !== "PAID" && nextPaymentStatus === "PAID" && nextStatus === "PRE_REVIEW"
        ? "입금이 확인되었습니다. 자료 확인 후 방송국·기관 접수를 진행합니다."
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await insertEvent(submissionId, changeSummary, "ADMIN_STATUS");
    } catch (error) {
      console.warn("[admin save] event insert failed", {
        submissionId,
        error,
      });
      savedWarning = "상태는 저장됐지만 처리 기록 저장은 실패했습니다.";
    }

    try {
      const notification = currentPaymentStatus !== "PAID" && nextPaymentStatus === "PAID"
        ? await sendPaidSubmissionNotificationsById({
          submissionId, paymentKey: `bank:${currentSubmissionRow.current_order_id ?? submissionId}`,
        }) : orderPayment.refundedIds
        ? await sendSubmissionUpdateNotificationById({
          submissionId, headline: "결제가 환불 처리되었습니다.",
          summary: "결제가 환불로 기록되어 심의 진행이 중단되었습니다. 환불 입금은 결제 수단에 따라 수일이 걸릴 수 있으며, 문의는 고객센터로 연락해주세요.",
          subject: "[onside] 환불 처리 안내",
        }) : (currentStatus !== nextStatus && (["RESULT_READY", "COMPLETED"].includes(currentStatus) || ["RESULT_READY", "COMPLETED"].includes(nextStatus)))
        ? null : await sendSubmissionUpdateNotificationById({
        submissionId,
        headline: "접수 정보가 업데이트되었습니다.",
        summary: changeSummary,
        subject: "[onside] 접수 정보 업데이트 안내",
      });
      savedWarning = [savedWarning, notification?.warning].filter(Boolean).join(" / ");
    } catch (error) {
      console.warn("[admin save] notification failed", {
        submissionId,
        error,
      });
      savedWarning = "상태는 저장됐지만 알림 발송은 실패했습니다.";
    }
  }

  for (const siblingId of orderPayment.confirmedIds ?? []) {
    if (siblingId === submissionId) continue;
    const notification = await sendPaidSubmissionNotificationsById({
      submissionId: siblingId, paymentKey: `bank:${currentSubmissionRow.current_order_id ?? siblingId}`,
    });
    savedWarning = [savedWarning, notification.warning].filter(Boolean).join(" / ");
  }
  for (const siblingId of orderPayment.refundedIds ?? []) {
    if (siblingId === submissionId) continue;
    const notification = await sendSubmissionUpdateNotificationById({
      submissionId: siblingId, headline: "결제가 환불 처리되었습니다.",
      summary: "결제가 환불로 기록되어 심의 진행이 중단되었습니다. 환불 입금은 결제 수단에 따라 수일이 걸릴 수 있으며, 문의는 고객센터로 연락해주세요.",
      subject: "[onside] 환불 처리 안내",
    });
    savedWarning = [savedWarning, notification?.warning].filter(Boolean).join(" / ");
  }
  revalidatePath("/admin/submissions");
  revalidatePath(`/admin/submissions/${submissionId}`);
  revalidatePath(`/admin/submissions/detail?id=${submissionId}`);
  revalidatePath("/dashboard/status");
  revalidatePath("/dashboard/history");
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/submissions/${submissionId}`);
  revalidatePath("/dashboard/submissions");
  revalidatePath(`/mypage/submissions/${submissionId}`);
  revalidatePath("/mypage/history");
  revalidatePath("/mypage");
  revalidatePath("/");

  if (savedWarning) {
    redirect(
      buildSubmissionFormRedirect(formData, submissionId, {
        saved: "status_warning",
        savedWarning,
      }),
    );
  } else {
    redirect(
      buildSubmissionFormRedirect(formData, submissionId, {
        saved: "status",
      }),
    );
  }
}

const uncertainPaymentOrderIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** Operator reconciliation of a card approval the gateway callback could not
 * confirm. The decision comes from the Inicis console; this only records it. */
export async function resolveUncertainPaymentFormAction(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "").trim();
  const pgTid = String(formData.get("pgTid") ?? "").trim();
  const adminMemo = String(formData.get("adminMemo") ?? "").trim().slice(0, 500);
  const back = (query: string) => redirect(`/admin/payments?filter=attention&${query}`);
  if (!uncertainPaymentOrderIdPattern.test(orderId)) back("saved=error&savedError=" + encodeURIComponent("주문번호를 확인해주세요."));
  if (outcome !== "APPROVED" && outcome !== "FAILED") back("saved=error&savedError=" + encodeURIComponent("승인 또는 미승인 중 하나를 선택해주세요."));
  if (outcome === "APPROVED" && !/^[A-Za-z0-9_-]{5,64}$/.test(pgTid)) back("saved=error&savedError=" + encodeURIComponent("이니시스 승인 TID를 정확히 입력해주세요."));

  const result = await resolveUncertainCardPayment(createAdminClient(), {
    orderId, actorUserId: actor.id, outcome: outcome as "APPROVED" | "FAILED", pgTid, adminMemo,
  });
  if (result.error || !result.submissionIds) back("saved=error&savedError=" + encodeURIComponent(result.error ?? "처리하지 못했습니다."));
  const submissionIds = result.submissionIds ?? [];
  const warnings: string[] = [];
  for (const submissionId of submissionIds) {
    const notification = outcome === "APPROVED"
      ? await sendPaidSubmissionNotificationsById({ submissionId, paymentKey: orderId })
      : await sendSubmissionUpdateNotificationById({
        submissionId, headline: "카드 결제가 완료되지 않았습니다.",
        summary: "결제사 확인 결과 승인되지 않은 결제입니다. 청구된 금액은 없으며, 주문내역에서 다시 결제할 수 있습니다.",
        subject: "[onside] 결제 미승인 안내",
      });
    if (notification?.warning) warnings.push(notification.warning);
    revalidateUserDashboards(submissionId);
  }
  revalidatePath("/admin/payments");
  revalidatePath("/admin/submissions");
  for (const prefix of ["", "/en"]) revalidatePath(`${prefix}/mypage/orders`);
  back(`saved=${outcome === "APPROVED" ? "approved" : "failed"}${warnings.length ? `&savedWarning=${encodeURIComponent(warnings.join(" / "))}` : ""}`);
}

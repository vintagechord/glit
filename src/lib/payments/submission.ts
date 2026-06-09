import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildStdPayRequest } from "@/lib/inicis/stdpay";
import { getInicisMode, getStdPayConfig } from "@/lib/inicis/config";
import { sendSubmissionUpdateEmail } from "@/lib/email";
import { sendKakaoOfficialNotification } from "@/lib/kakao";
import { buildUrl, getBaseUrl } from "@/lib/url";

export type StdPayInitResult = {
  orderId: string;
  stdParams: Record<string, string>;
  stdJsUrl: string;
};

type SubmissionRecord = {
  id: string;
  user_id: string | null;
  guest_token: string | null;
  title: string | null;
  artist_name: string | null;
  status: string | null;
  type: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  amount_krw: number | null;
  payment_method: string | null;
  payment_status: string | null;
  mv_desired_rating: string | null;
  certificate_b2_path?: string | null;
  certificate_original_name?: string | null;
  certificate_mime?: string | null;
  certificate_size?: number | null;
  certificate_uploaded_at?: string | null;
  result_status?: string | null;
  result_memo?: string | null;
  result_notified_at?: string | null;
  package?: Array<{ name?: string | null }> | { name?: string | null } | null;
};

type PaymentCancelResult = {
  ok: boolean;
  error: unknown;
  submissionId?: string | null;
  guestToken?: string | null;
};

const normalizeEmailValue = (value?: string | null) =>
  value?.trim().toLowerCase() ?? "";

const collectNotificationEmails = (
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

export const findSubmissionById = async (submissionId: string) => {
  const admin = createAdminClient();
  const selectWithRating =
    "id, user_id, guest_token, title, artist_name, status, type, applicant_name, applicant_email, applicant_phone, guest_email, guest_phone, amount_krw, payment_method, payment_status, mv_desired_rating, certificate_b2_path, certificate_original_name, certificate_mime, certificate_size, certificate_uploaded_at, result_status, result_memo, result_notified_at, package:packages ( name )";
  const selectFallback =
    "id, user_id, guest_token, title, artist_name, status, type, applicant_name, applicant_email, applicant_phone, guest_email, guest_phone, amount_krw, payment_method, payment_status, mv_desired_rating, package:packages ( name )";

  const primary = await admin
    .from("submissions")
    .select(selectWithRating)
    .eq("id", submissionId)
    .maybeSingle();
  let data = primary.data as SubmissionRecord | null;
  let error = primary.error;

  if (error?.code === "42703") {
    const fallback = await admin
      .from("submissions")
      .select(selectFallback)
      .eq("id", submissionId)
      .maybeSingle();
    data = fallback.data as SubmissionRecord | null;
    error = fallback.error;
  }

  return { submission: data, error };
};

export const ensureSubmissionOwner = async (
  submissionId: string,
  guestToken?: string | null,
) => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { submission, error } = await findSubmissionById(submissionId);
  if (error || !submission) {
    return { user, submission: null, error: "NOT_FOUND" };
  }
  if (submission.user_id && user?.id === submission.user_id) {
    return { user, submission, error: null };
  }
  if (!submission.user_id && submission.guest_token && guestToken) {
    if (guestToken === submission.guest_token) {
      return { user, submission, error: null };
    }
  }
  if (!user && !guestToken) {
    return { user: null, submission: null, error: "UNAUTHORIZED" };
  }
  return { user, submission: null, error: "FORBIDDEN" };
};

export const createSubmissionPaymentOrder = async (
  submissionId: string,
  baseUrl: string,
): Promise<{ error?: string; result?: StdPayInitResult }> => {
  const { submission, error } = await findSubmissionById(submissionId);
  if (error || !submission) {
    return { error: "접수를 찾을 수 없습니다." };
  }
  if (submission.payment_status === "PAID") {
    return { error: "이미 결제가 완료된 접수입니다." };
  }
  if (submission.status === "DRAFT") {
    return { error: "임시저장 상태에서는 결제를 시작할 수 없습니다." };
  }
  if (submission.payment_method === "BANK") {
    return { error: "무통장 입금 접수는 카드 결제를 시작할 수 없습니다." };
  }
  const amountKrw = Math.round(Number(submission.amount_krw ?? 0));
  if (!Number.isFinite(amountKrw) || amountKrw <= 0) {
    return { error: "결제 금액이 유효하지 않습니다." };
  }
  const orderTimestamp = Date.now().toString();
  const orderId = `SUBP-${orderTimestamp}-${submission.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const config = getStdPayConfig();
  const packageName = Array.isArray(submission.package)
    ? (submission.package as Array<{ name?: string }>)[0]?.name
    : (submission.package as { name?: string } | null | undefined)?.name;

  const productName =
    packageName ?? submission.title ?? submission.artist_name ?? "심의 접수";
  const buyerName =
    submission.applicant_name ??
    submission.artist_name ??
    packageName ??
    "회원";
  const buyerEmail = submission.applicant_email ?? "";
  const buyerTel = submission.applicant_phone ?? "";

  const maskMid = (mid: string) =>
    mid.length <= 4 ? `${mid.slice(0, 2)}**` : `${mid.slice(0, 2)}***${mid.slice(-2)}`;

  const returnUrl = new URL("/api/inicis/return", baseUrl).toString();
  const closeUrl = new URL(`/api/inicis/close?oid=${encodeURIComponent(orderId)}&cancel=1`, baseUrl).toString();
  const stdParams = buildStdPayRequest({
    orderId,
    amountKrw,
    productName,
    buyerName,
    buyerEmail,
    buyerTel,
    returnUrl,
    closeUrl,
  }, orderTimestamp);

  console.info("[Inicis][STDPay][init]", {
    mode: getInicisMode(),
    mid: maskMid(config.mid),
    orderId,
    amountKrw,
    returnUrl,
    closeUrl: stdParams.closeUrl,
    stdJsUrl: config.stdJsUrl,
    timestamp: stdParams.timestamp,
    baseUrl,
    guest: Boolean(submission.guest_token),
    note: baseUrl.includes("localhost")
      ? "Local baseUrl detected; use a public URL (e.g. ngrok) if the window is blocked."
      : undefined,
  });

  const admin = createAdminClient();
  const { error: insertError } = await admin.from("submission_payments").insert({
    submission_id: submission.id,
    user_id: submission.user_id ?? null,
    order_id: orderId,
    amount_krw: amountKrw,
    status: "REQUESTED",
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return { error: "이미 생성된 결제 요청이 있습니다. 잠시 후 다시 시도해주세요." };
    }
    return { error: "결제 요청을 저장하지 못했습니다." };
  }

  return {
    result: { orderId, stdParams, stdJsUrl: config.stdJsUrl },
  };
};

export const getPaymentByOrderId = async (orderId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submission_payments")
    .select(
      "*, submission:submissions ( id, user_id, guest_token, payment_status, payment_method, title, artist_name, amount_krw )",
    )
    .eq("order_id", orderId)
    .maybeSingle();
  return { payment: data, error };
};

export const markPaymentFailure = async (
  orderId: string,
  payload: {
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
  },
) => {
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("submission_payments")
    .update({
      status: "FAILED",
      result_code: payload.result_code ?? null,
      result_message: payload.result_message ?? null,
      raw_response: payload.raw_response ?? null,
    })
    .eq("order_id", orderId)
    .neq("status", "APPROVED")
    .select("submission_id")
    .maybeSingle();

  if (updated?.submission_id) {
    const { data: approvedPayments } = await admin
      .from("submission_payments")
      .select("id")
      .eq("submission_id", updated.submission_id)
      .eq("status", "APPROVED")
      .limit(1);

    if (!approvedPayments?.length) {
      const { error: submissionError } = await admin
        .from("submissions")
        .update({ payment_status: "UNPAID", status: "WAITING_PAYMENT" })
        .eq("id", updated.submission_id)
        .neq("payment_status", "PAID");
      if (submissionError) {
        return { ok: false, error: submissionError };
      }
    }
  }

  return { ok: !error, error };
};

export const markPaymentCanceled = async (
  orderId: string,
  payload?: {
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
  },
) => {
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("submission_payments")
    .update({
      status: "CANCELED",
      result_code: payload?.result_code ?? "CANCELED",
      result_message: payload?.result_message ?? "사용자 취소",
      raw_response: payload?.raw_response ?? null,
    })
    .eq("order_id", orderId)
    .neq("status", "APPROVED")
    .select("submission_id")
    .maybeSingle();

  let guestToken: string | null = null;

  if (updated?.submission_id) {
    const { data: approvedPayments } = await admin
      .from("submission_payments")
      .select("id")
      .eq("submission_id", updated.submission_id)
      .eq("status", "APPROVED")
      .limit(1);

    if (!approvedPayments?.length) {
      const { error: submissionError } = await admin
        .from("submissions")
        .update({ payment_status: "UNPAID", status: "WAITING_PAYMENT" })
        .eq("id", updated.submission_id)
        .neq("payment_status", "PAID");
      if (submissionError) {
        return {
          ok: false,
          error: submissionError,
          submissionId: updated.submission_id,
          guestToken,
        } satisfies PaymentCancelResult;
      }
    }

    const { data: submission } = await admin
      .from("submissions")
      .select("guest_token")
      .eq("id", updated.submission_id)
      .maybeSingle();
    guestToken = submission?.guest_token ?? null;
  }

  return {
    ok: Boolean(updated?.submission_id) && !error,
    error,
    submissionId: updated?.submission_id ?? null,
    guestToken,
  } satisfies PaymentCancelResult;
};

export const markPaymentSuccess = async (
  orderId: string,
  payload: {
    tid?: string | null;
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
  },
) => {
  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("submission_payments")
    .update({
      status: "APPROVED",
      pg_tid: payload.tid ?? null,
      result_code: payload.result_code ?? null,
      result_message: payload.result_message ?? null,
      raw_response: payload.raw_response ?? null,
      paid_at: new Date().toISOString(),
    })
    .eq("order_id", orderId)
    .select("submission_id")
    .maybeSingle();

  if (updated?.submission_id) {
    const { data: submission } = await admin
      .from("submissions")
      .select("status")
      .eq("id", updated.submission_id)
      .maybeSingle();
    const nextSubmissionUpdate: Record<string, unknown> = {
      payment_status: "PAID",
      payment_method: "CARD",
    };
    if (
      submission?.status === "WAITING_PAYMENT" ||
      submission?.status === "SUBMITTED"
    ) {
      nextSubmissionUpdate.status = "IN_PROGRESS";
    }

    const { error: submissionError } = await admin
      .from("submissions")
      .update(nextSubmissionUpdate)
      .eq("id", updated.submission_id);
    if (submissionError) {
      return { ok: false, error: submissionError, submissionId: updated.submission_id };
    }

    const { error: eventError } = await admin.from("submission_events").insert({
      submission_id: updated.submission_id,
      event_type: "PAYMENT",
      message: "KG이니시스 카드 결제 완료",
    });
    if (eventError) {
      return { ok: false, error: eventError, submissionId: updated.submission_id };
    }

    const { submission: notificationSubmission } = await findSubmissionById(
      updated.submission_id,
    );
    if (notificationSubmission) {
      let memberEmail: string | null = null;
      let memberPhone: string | null = null;
      if (notificationSubmission.user_id) {
        const { data: userData, error: userError } =
          await admin.auth.admin.getUserById(notificationSubmission.user_id);
        if (userError) {
          console.warn("[Email][payment] member lookup failed", {
            submissionId: notificationSubmission.id,
            userId: notificationSubmission.user_id,
            error: userError,
          });
        } else {
          memberEmail = userData?.user?.email ?? null;
        }

        const { data: profile, error: profileError } = await admin
          .from("profiles")
          .select("phone")
          .eq("user_id", notificationSubmission.user_id)
          .maybeSingle();
        if (!profileError) {
          memberPhone = profile?.phone ?? null;
        }
      }

      const kind = notificationSubmission.type?.startsWith("MV") ? "MV" : "ALBUM";
      const baseUrl = getBaseUrl();
      const link =
        notificationSubmission.guest_token &&
        notificationSubmission.guest_token.length >= 8
          ? buildUrl(
              `/track/${encodeURIComponent(notificationSubmission.guest_token)}`,
              baseUrl,
            )
          : buildUrl(
              `/dashboard/submissions/${notificationSubmission.id}`,
              baseUrl,
            );
      const recipientEmails = collectNotificationEmails(
        notificationSubmission.applicant_email,
        notificationSubmission.guest_email,
        memberEmail,
      );

      for (const recipientEmail of recipientEmails) {
        await sendSubmissionUpdateEmail({
          email: recipientEmail,
          title: notificationSubmission.title ?? "제목 미입력",
          artist: notificationSubmission.artist_name ?? null,
          kind,
          headline: "결제가 완료되었습니다.",
          summary: "결제 확인이 완료되어 심의가 시작됩니다.",
          link,
          subject: "[onside] 결제 완료 안내",
        });
      }

      await sendKakaoOfficialNotification({
        phone:
          notificationSubmission.applicant_phone ??
          notificationSubmission.guest_phone ??
          memberPhone,
        title: "결제가 완료되었습니다.",
        message: `${notificationSubmission.title ?? "제목 미입력"} 결제가 완료되어 심의가 시작됩니다.`,
        link,
      });
    }
  }

  return { ok: !error, error, submissionId: updated?.submission_id ?? null };
};

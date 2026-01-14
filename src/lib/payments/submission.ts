import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { buildStdPayRequest } from "@/lib/inicis/stdpay";
import { getInicisMode, getStdPayConfig } from "@/lib/inicis/config";

export type StdPayInitResult = {
  orderId: string;
  stdParams: Record<string, string>;
  stdJsUrl: string;
};

export const findSubmissionById = async (submissionId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select(
      "id, user_id, guest_token, title, artist_name, applicant_name, applicant_email, applicant_phone, amount_krw, payment_method, payment_status, package:packages ( name )",
    )
    .eq("id", submissionId)
    .maybeSingle();
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
  const amountKrw = submission.amount_krw ?? 0;
  if (amountKrw <= 0) {
    return { error: "결제 금액이 유효하지 않습니다." };
  }
  const orderId = `SUBP-${Date.now()}-${submission.id.slice(0, 8)}`;
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

  const returnUrl = `${baseUrl}/api/inicis/submission/key-return`;
  const closeUrl = `${baseUrl}/api/inicis/submission/key-return?oid=${orderId}&cancel=1`;
  const stdParams = buildStdPayRequest({
    orderId,
    amountKrw,
    productName,
    buyerName,
    buyerEmail,
    buyerTel,
    returnUrl,
    closeUrl,
  });

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
  await admin
    .from("submission_payments")
    .update({
      status: "FAILED",
      result_code: payload.result_code ?? null,
      result_message: payload.result_message ?? null,
      raw_response: payload.raw_response ?? null,
    })
    .eq("order_id", orderId);
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
  const { data: updated } = await admin
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
    await admin
      .from("submissions")
      .update({ payment_status: "PAID", payment_method: "CARD" })
      .eq("id", updated.submission_id);

    await admin.from("submission_events").insert({
      submission_id: updated.submission_id,
      event_type: "PAYMENT",
      message: "KG이니시스 카드 결제 완료",
    });
  }
};

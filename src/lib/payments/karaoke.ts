import { buildStdPayRequest } from "@/lib/inicis/stdpay";
import { getInicisMode, getStdPayConfig } from "@/lib/inicis/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export type KaraokeStdPayInitResult = {
  orderId: string;
  stdParams: Record<string, string>;
  stdJsUrl: string;
  amount: number;
};

type KaraokeRequestRow = {
  id: string;
  user_id: string | null;
  title: string | null;
  artist: string | null;
  contact: string | null;
  amount_krw: number | null;
  payment_status: string | null;
  payment_method: string | null;
  order_id?: string | null;
};

type KaraokePaymentRow = {
  id: string;
  request_id: string | null;
  amount_krw: number | null;
  status: string | null;
  pg_tid?: string | null;
  result_code?: string | null;
  result_message?: string | null;
  raw_response?: unknown;
  request?: KaraokeRequestRow | null;
};

const maskMid = (mid: string) =>
  mid.length <= 4 ? `${mid.slice(0, 2)}**` : `${mid.slice(0, 2)}***${mid.slice(-2)}`;

export const findKaraokeRequestById = async (requestId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("karaoke_requests")
    .select("id, user_id, title, artist, contact, amount_krw, payment_status, payment_method, order_id")
    .eq("id", requestId)
    .maybeSingle();
  return { request: data as KaraokeRequestRow | null, error };
};

export const ensureKaraokeRequestOwner = async (
  requestId: string,
): Promise<{
  user: { id?: string } | null;
  request: KaraokeRequestRow | null;
  error: "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN" | null;
}> => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { request, error } = await findKaraokeRequestById(requestId);
  if (error || !request) {
    return { user, request: null, error: "NOT_FOUND" };
  }
  if (!user) {
    return { user: null, request: null, error: "UNAUTHORIZED" };
  }
  if (request.user_id && request.user_id === user.id) {
    return { user, request, error: null };
  }
  return { user, request: null, error: "FORBIDDEN" };
};

export const createKaraokePaymentOrder = async (
  requestId: string,
  baseUrl: string,
): Promise<{ error?: string; result?: KaraokeStdPayInitResult }> => {
  const { request, error } = await findKaraokeRequestById(requestId);
  if (error || !request) {
    return { error: "요청을 찾을 수 없습니다." };
  }
  const amountKrw = Number(request.amount_krw ?? 0);
  if (!Number.isFinite(amountKrw) || amountKrw <= 0) {
    return { error: "결제 금액이 유효하지 않습니다." };
  }

  const orderTimestamp = Date.now().toString();
  const orderId = `KRP-${orderTimestamp}-${request.id.slice(0, 8)}`;
  const config = getStdPayConfig();

  const productName = request.title ?? "노래방 등록 대행";
  const buyerName = request.artist ?? request.contact ?? "회원";
  const buyerEmail = "";
  const buyerTel = request.contact ?? "";

  const returnUrl = new URL("/api/inicis/return", baseUrl).toString();
  const closeUrl = new URL(`/api/inicis/close?oid=${encodeURIComponent(orderId)}&cancel=1`, baseUrl).toString();
  const stdParams = buildStdPayRequest(
    {
      orderId,
      amountKrw,
      productName,
      buyerName,
      buyerEmail,
      buyerTel,
      returnUrl,
      closeUrl,
    },
    orderTimestamp,
  );

  console.info("[Karaoke][Inicis][STDPay][init]", {
    mode: getInicisMode(),
    mid: maskMid(config.mid),
    orderId,
    amountKrw,
    returnUrl,
    closeUrl: stdParams.closeUrl,
    stdJsUrl: config.stdJsUrl,
  });

  const admin = createAdminClient();
  const { error: insertError } = await admin.from("karaoke_payments").insert({
    request_id: request.id,
    user_id: request.user_id,
    order_id: orderId,
    amount_krw: amountKrw,
    status: "REQUESTED",
  });
  if (insertError) {
    return { error: "결제 요청을 저장하지 못했습니다." };
  }

  await admin
    .from("karaoke_requests")
    .update({
      payment_method: "CARD",
      payment_status: "PAYMENT_PENDING",
      order_id: orderId,
    })
    .eq("id", request.id);

  return { result: { orderId, stdParams, stdJsUrl: config.stdJsUrl, amount: amountKrw } };
};

export const getKaraokePaymentByOrderId = async (orderId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("karaoke_payments")
    .select(
      "*, request:karaoke_requests ( id, user_id, guest_email, title, artist, contact, amount_krw, payment_status, payment_method, order_id )",
    )
    .eq("order_id", orderId)
    .maybeSingle();
  return { payment: data as KaraokePaymentRow | null, error };
};

export const markKaraokePaymentFailure = async (
  orderId: string,
  payload: {
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
  },
) => {
  const admin = createAdminClient();
  const { error } = await admin
    .from("karaoke_payments")
    .update({
      status: "FAILED",
      result_code: payload.result_code ?? null,
      result_message: payload.result_message ?? null,
      raw_response: payload.raw_response ?? null,
    })
    .eq("order_id", orderId);

  await admin
    .from("karaoke_requests")
    .update({
      payment_status: "UNPAID",
      payment_result_code: payload.result_code ?? null,
      payment_result_message: payload.result_message ?? null,
      payment_raw_response: payload.raw_response ?? null,
    })
    .eq("order_id", orderId);

  return { ok: !error, error };
};

export const markKaraokePaymentSuccess = async (
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
    .from("karaoke_payments")
    .update({
      status: "APPROVED",
      pg_tid: payload.tid ?? null,
      result_code: payload.result_code ?? null,
      result_message: payload.result_message ?? null,
      raw_response: payload.raw_response ?? null,
      paid_at: new Date().toISOString(),
    })
    .eq("order_id", orderId)
    .select("request_id")
    .maybeSingle();

  if (updated?.request_id) {
    await admin
      .from("karaoke_requests")
      .update({
        payment_status: "PAID",
        payment_method: "CARD",
        paid_at: new Date().toISOString(),
        pg_tid: payload.tid ?? null,
        payment_result_code: payload.result_code ?? null,
        payment_result_message: payload.result_message ?? null,
        payment_raw_response: payload.raw_response ?? null,
      })
      .eq("id", updated.request_id);
  }

  return { ok: !error, error, requestId: updated?.request_id ?? null };
};

import { randomUUID } from "node:crypto";

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

type KaraokeBeginRpcRow = {
  request_id: string | null;
  order_id: string | null;
};

type KaraokeCloseRpcRow = {
  request_id: string | null;
  final_status: string | null;
  transitioned: boolean | null;
};

type KaraokeApproveRpcRow = {
  request_id: string | null;
  final_status: string | null;
  already_approved: boolean | null;
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
  if (request.payment_status === "PAID") {
    return { error: "이미 결제가 완료된 요청입니다." };
  }
  if (request.payment_method === "BANK") {
    return { error: "무통장 입금 요청은 카드 결제를 시작할 수 없습니다." };
  }
  const amountKrw = Math.round(Number(request.amount_krw ?? 0));
  if (!Number.isFinite(amountKrw) || amountKrw <= 0) {
    return { error: "결제 금액이 유효하지 않습니다." };
  }

  const orderTimestamp = Date.now().toString();
  const orderId = `KRP-${orderTimestamp}-${request.id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const closeState = randomUUID();
  const config = getStdPayConfig();

  const productName = request.title ?? "노래방 등록 대행";
  const buyerName = request.artist ?? request.contact ?? "회원";
  const buyerEmail = "";
  const buyerTel = request.contact ?? "";

  const returnUrl = new URL("/api/inicis/return", baseUrl).toString();
  const closeUrl = new URL(
    `/api/inicis/close?oid=${encodeURIComponent(orderId)}&state=${encodeURIComponent(closeState)}&cancel=1`,
    baseUrl,
  ).toString();
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
      merchantData: closeState,
    },
    orderTimestamp,
  );

  console.info("[Karaoke][Inicis][STDPay][init]", {
    mode: getInicisMode(),
    mid: maskMid(config.mid),
    orderId,
    amountKrw,
    returnUrl,
    closeUrlConfigured: Boolean(stdParams.closeUrl),
    stdJsUrl: config.stdJsUrl,
  });

  const admin = createAdminClient();
  const { data: startedRows, error: startError } = await admin.rpc(
    "begin_karaoke_payment_order",
    {
      p_request_id: request.id,
      p_user_id: request.user_id,
      p_order_id: orderId,
      p_amount_krw: amountKrw,
      p_raw_response: { closeState },
    },
  );
  if (startError) {
    if (
      startError.code === "23505" ||
      startError.message?.includes("KARAOKE_PAYMENT_ALREADY_IN_PROGRESS")
    ) {
      return { error: "이미 생성된 결제 요청이 있습니다. 잠시 후 다시 시도해주세요." };
    }
    if (startError.message?.includes("KARAOKE_PAYMENT_OWNER")) {
      return { error: "결제 요청 소유자를 확인할 수 없습니다." };
    }
    if (startError.message?.includes("KARAOKE_REQUEST_NOT_FOUND")) {
      return { error: "요청을 찾을 수 없습니다." };
    }
    if (startError.message?.includes("KARAOKE_PAYMENT_AMOUNT_MISMATCH")) {
      return { error: "결제 금액이 변경되었습니다. 다시 확인해주세요." };
    }
    if (startError.message?.includes("KARAOKE_PAYMENT_ALREADY_TERMINAL")) {
      return { error: "이미 결제가 완료되거나 환불된 요청입니다." };
    }
    console.error("[Karaoke][Inicis][STDPay][init][transaction-error]", {
      orderId,
      code: startError.code,
      message: startError.message,
    });
    return { error: "결제 요청을 저장하지 못했습니다." };
  }

  const started = ((startedRows ?? []) as KaraokeBeginRpcRow[])[0] ?? null;
  if (started?.request_id !== request.id || started?.order_id !== orderId) {
    console.error("[Karaoke][Inicis][STDPay][init][transaction-result-mismatch]", {
      requestId: request.id,
      orderId,
      started,
    });
    return { error: "결제 요청 상태를 저장하지 못했습니다." };
  }

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
    callback_state: string;
  },
) => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("close_karaoke_payment_order", {
    p_order_id: orderId,
    p_status: "FAILED",
    p_callback_state: payload.callback_state,
    p_result_code: payload.result_code ?? null,
    p_result_message: payload.result_message ?? null,
    p_raw_response: payload.raw_response ?? null,
  });
  if (error) return { ok: false, error };

  const closed = ((data ?? []) as KaraokeCloseRpcRow[])[0] ?? null;
  const ok = closed?.final_status === "FAILED";
  return {
    ok,
    error: ok ? null : new Error("이미 승인되거나 종료된 결제 요청입니다."),
  };
};

export const markKaraokePaymentCanceled = async (
  orderId: string,
  payload?: {
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
    close_state?: string | null;
  },
) => {
  const admin = createAdminClient();
  const receivedCloseState = payload?.close_state ?? "";
  if (receivedCloseState.length < 32) {
    return {
      ok: false,
      error: new Error("결제창 종료 요청 인증값이 올바르지 않습니다."),
      requestId: null,
    };
  }
  const { data, error } = await admin.rpc("close_karaoke_payment_order", {
    p_order_id: orderId,
    p_status: "CANCELED",
    p_callback_state: receivedCloseState,
    p_result_code: payload?.result_code ?? "CANCELED",
    p_result_message: payload?.result_message ?? "사용자 취소",
    p_raw_response: payload?.raw_response ?? null,
  });
  if (error) {
    return { ok: false, error, requestId: null };
  }

  const closed = ((data ?? []) as KaraokeCloseRpcRow[])[0] ?? null;
  const ok = closed?.final_status === "CANCELED";
  return {
    ok,
    error: ok ? null : new Error("이미 승인되거나 종료된 결제 요청입니다."),
    requestId: closed?.request_id ?? null,
  };
};

export const markKaraokePaymentSuccess = async (
  orderId: string,
  payload: {
    amount_krw: number;
    tid?: string | null;
    result_code?: string | null;
    result_message?: string | null;
    raw_response?: Record<string, unknown> | null;
  },
) => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("approve_karaoke_payment_order", {
    p_order_id: orderId,
    p_amount_krw: payload.amount_krw,
    p_pg_tid: payload.tid ?? null,
    p_result_code: payload.result_code ?? null,
    p_result_message: payload.result_message ?? null,
    p_raw_response: payload.raw_response ?? null,
    p_paid_at: new Date().toISOString(),
  });
  if (error) {
    return { ok: false, error, requestId: null };
  }

  const approved = ((data ?? []) as KaraokeApproveRpcRow[])[0] ?? null;
  const ok = approved?.final_status === "APPROVED";
  return {
    ok,
    error: ok ? null : new Error("결제 승인 상태를 저장하지 못했습니다."),
    requestId: approved?.request_id ?? null,
  };
};

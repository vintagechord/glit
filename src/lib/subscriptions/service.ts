import { randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { makeOrderId, sha256 } from "@/lib/inicis/crypto";

type HistoryStatus =
  | "REQUESTED"
  | "BILLKEY_ISSUED"
  | "APPROVED"
  | "FAILED"
  | "CANCELED";

type SubscriptionStatus = "PENDING" | "ACTIVE" | "PAUSED" | "CANCELED" | "FAILED";

export type SubscriptionCallbackClaim = {
  history_id: string;
  history_user_id: string;
  history_amount_krw: number;
  history_product_name: string | null;
  claim_token: string | null;
  already_approved: boolean;
  already_processing: boolean;
};

export const createHistoryAttempt = async (params: {
  userId: string;
  amountKrw: number;
  productName: string;
  orderId?: string;
}) => {
  const admin = createAdminClient();
  const orderId = params.orderId ?? makeOrderId("SUB");
  const callbackState = randomUUID();

  const { data, error } = await admin
    .from("subscription_history")
    .insert({
      user_id: params.userId,
      order_id: orderId,
      amount_krw: params.amountKrw,
      product_name: params.productName,
      status: "REQUESTED",
      callback_state_hash: sha256(callbackState),
      callback_phase: "READY",
    })
    .select("*")
    .single();

  return { orderId, callbackState, history: data, error };
};

export const claimSubscriptionBillingCallback = async (params: {
  orderId: string;
  callbackState: string;
  channel: "PC" | "MOBILE";
}) => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "claim_subscription_billing_callback",
    {
      p_order_id: params.orderId,
      p_callback_state: params.callbackState,
      p_channel: params.channel,
    },
  );
  return {
    claim:
      ((data ?? []) as SubscriptionCallbackClaim[])[0] ?? null,
    error,
  };
};

export const recordSubscriptionBillKeyForCallback = async (params: {
  orderId: string;
  claimToken: string;
  billKey: string;
  billKeyIssueTid: string;
  pgMid: string;
  cardCode?: string | null;
  cardName?: string | null;
  cardNumber?: string | null;
  cardQuota?: string | null;
  resultCode?: string | null;
  resultMessage?: string | null;
  rawResponse?: Record<string, unknown> | null;
}) => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "record_subscription_billkey_for_callback",
    {
      p_order_id: params.orderId,
      p_claim_token: params.claimToken,
      p_bill_key: params.billKey,
      p_billkey_issue_tid: params.billKeyIssueTid,
      p_pg_mid: params.pgMid,
      p_card_code: params.cardCode ?? null,
      p_card_name: params.cardName ?? null,
      p_card_number: params.cardNumber ?? null,
      p_card_quota: params.cardQuota ?? null,
      p_result_code: params.resultCode ?? null,
      p_result_message: params.resultMessage ?? null,
      p_raw_response: params.rawResponse ?? null,
    },
  );
  return {
    billing:
      ((data ?? []) as Array<{
        billing_id: string;
        already_recorded: boolean;
      }>)[0] ?? null,
    error,
  };
};

export const failSubscriptionBillingCallback = async (params: {
  orderId: string;
  claimToken: string;
  resultCode: string;
  resultMessage: string;
  rawResponse?: Record<string, unknown> | null;
}) => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "fail_subscription_billing_callback",
    {
      p_order_id: params.orderId,
      p_claim_token: params.claimToken,
      p_result_code: params.resultCode,
      p_result_message: params.resultMessage,
      p_raw_response: params.rawResponse ?? null,
    },
  );
  const row = ((data ?? []) as Array<{ final_status: string | null }>)[0];
  return { ok: row?.final_status === "FAILED", error };
};

export const recordSubscriptionBillingUncertain = async (params: {
  orderId: string;
  claimToken: string;
  resultCode: string;
  resultMessage: string;
  rawResponse?: Record<string, unknown> | null;
}) => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "record_subscription_billing_uncertain",
    {
      p_order_id: params.orderId,
      p_claim_token: params.claimToken,
      p_result_code: params.resultCode,
      p_result_message: params.resultMessage,
      p_raw_response: params.rawResponse ?? null,
    },
  );
  const row = ((data ?? []) as Array<{ recorded: boolean | null }>)[0];
  return { ok: Boolean(row?.recorded), error };
};

export const finalizeSubscriptionBillingCallback = async (params: {
  orderId: string;
  claimToken: string;
  billingTid: string;
  amountKrw: number;
  resultCode?: string | null;
  resultMessage?: string | null;
  rawResponse?: Record<string, unknown> | null;
  paidAt?: string | null;
}) => {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "finalize_subscription_billing_callback",
    {
      p_order_id: params.orderId,
      p_claim_token: params.claimToken,
      p_billing_tid: params.billingTid,
      p_amount_krw: params.amountKrw,
      p_result_code: params.resultCode ?? null,
      p_result_message: params.resultMessage ?? null,
      p_raw_response: params.rawResponse ?? null,
      p_paid_at: params.paidAt ?? new Date().toISOString(),
    },
  );
  return {
    finalized:
      ((data ?? []) as Array<{
        history_id: string;
        billing_id: string;
        subscription_id: string;
        already_finalized: boolean;
      }>)[0] ?? null,
    error,
  };
};

export const getHistoryByOrderId = async (orderId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscription_history")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  return { history: data, error };
};

export const getHistoryByTid = async (tid: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscription_history")
    .select("*")
    .eq("pg_tid", tid)
    .maybeSingle();
  return { history: data, error };
};

export const updateHistory = async (
  orderId: string,
  payload: Partial<{
    status: HistoryStatus;
    pg_tid: string | null;
    subscription_id: string | null;
    result_code: string | null;
    result_message: string | null;
    raw_response: Record<string, unknown> | null;
    billing_id: string | null;
    amount_krw: number | null;
    paid_at: string | null;
  }>,
) => {
  const admin = createAdminClient();
  const { error, data } = await admin
    .from("subscription_history")
    .update(payload)
    .eq("order_id", orderId)
    .select("*")
    .maybeSingle();
  return { history: data, error };
};

export const storeBillingKey = async (params: {
  userId: string;
  billKey: string;
  pgTid?: string | null;
  pgMid: string;
  cardCode?: string | null;
  cardName?: string | null;
  cardNumber?: string | null;
  cardQuota?: string | null;
  lastResultCode?: string | null;
  lastResultMessage?: string | null;
}) => {
  const admin = createAdminClient();

  await admin
    .from("subscription_billing")
    .update({ status: "INACTIVE" })
    .eq("user_id", params.userId)
    .eq("status", "ACTIVE");

  const { data, error } = await admin
    .from("subscription_billing")
    .insert({
      user_id: params.userId,
      status: "ACTIVE",
      bill_key: params.billKey,
      pg_tid: params.pgTid ?? null,
      pg_mid: params.pgMid,
      card_code: params.cardCode ?? null,
      card_name: params.cardName ?? null,
      card_number: params.cardNumber ?? null,
      card_quota: params.cardQuota ?? null,
      last_result_code: params.lastResultCode ?? null,
      last_result_message: params.lastResultMessage ?? null,
    })
    .select("*")
    .single();

  return { billing: data, error };
};

export const activateSubscription = async (params: {
  userId: string;
  billingId: string;
  amountKrw: number;
  productName: string;
}) => {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const nextBilling = new Date();
  nextBilling.setMonth(nextBilling.getMonth() + 1);
  const nextBillingIso = nextBilling.toISOString();

  const { data: existing } = await admin
    .from("subscriptions")
    .select("*")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await admin
      .from("subscriptions")
      .update({
        status: "ACTIVE" as SubscriptionStatus,
        billing_id: params.billingId,
        amount_krw: params.amountKrw,
        product_name: params.productName,
        started_at: existing.started_at ?? nowIso,
        canceled_at: null,
        cancel_reason: null,
        next_billing_at: nextBillingIso,
        last_billed_at: nowIso,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    return { subscription: data, error };
  }

  const { data, error } = await admin
    .from("subscriptions")
    .insert({
      user_id: params.userId,
      billing_id: params.billingId,
      status: "ACTIVE" as SubscriptionStatus,
      amount_krw: params.amountKrw,
      product_name: params.productName,
      started_at: nowIso,
      last_billed_at: nowIso,
      next_billing_at: nextBillingIso,
    })
    .select("*")
    .single();

  return { subscription: data, error };
};

export const cancelSubscription = async (
  subscriptionId: string,
  reason?: string,
) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .update({
      status: "CANCELED",
      cancel_reason: reason ?? "user requested",
      canceled_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId)
    .select("*")
    .maybeSingle();
  return { subscription: data, error };
};

export const deactivateBilling = async (billingId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscription_billing")
    .update({ status: "INACTIVE" })
    .eq("id", billingId)
    .select("*")
    .maybeSingle();
  return { billing: data, error };
};

export const getActiveSubscription = async (userId: string) => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, user_id, status, amount_krw, product_name, started_at, last_billed_at, next_billing_at, canceled_at",
    )
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  return { subscription: data, error };
};

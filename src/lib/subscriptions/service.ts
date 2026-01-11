import { createAdminClient } from "@/lib/supabase/admin";
import { makeOrderId } from "@/lib/inicis/crypto";

type HistoryStatus =
  | "REQUESTED"
  | "BILLKEY_ISSUED"
  | "APPROVED"
  | "FAILED"
  | "CANCELED";

type SubscriptionStatus = "PENDING" | "ACTIVE" | "PAUSED" | "CANCELED" | "FAILED";

export const createHistoryAttempt = async (params: {
  userId: string;
  amountKrw: number;
  productName: string;
  orderId?: string;
}) => {
  const admin = createAdminClient();
  const orderId = params.orderId ?? makeOrderId("SUB");

  const { data, error } = await admin
    .from("subscription_history")
    .insert({
      user_id: params.userId,
      order_id: orderId,
      amount_krw: params.amountKrw,
      product_name: params.productName,
      status: "REQUESTED",
    })
    .select("*")
    .single();

  return { orderId, history: data, error };
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
    .select("*, billing:subscription_billing(*)")
    .eq("user_id", userId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  return { subscription: data, error };
};

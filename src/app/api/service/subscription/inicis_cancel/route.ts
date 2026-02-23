import { NextRequest, NextResponse } from "next/server";

import { requestRefund } from "@/lib/inicis/api";
import {
  cancelSubscription,
  deactivateBilling,
  getHistoryByOrderId,
  getHistoryByTid,
  updateHistory,
} from "@/lib/subscriptions/service";
import { getBaseUrl, getClientIp } from "../../../../../lib/url";
import { createServerSupabase } from "@/lib/supabase/server";

type CancelPayload = {
  orderId?: string;
  tid?: string;
  reason?: string;
};

const parsePayload = async (req: NextRequest): Promise<CancelPayload> => {
  if (req.method === "GET") {
    const params = req.nextUrl.searchParams;
    return {
      orderId: params.get("orderId")?.trim() || undefined,
      tid: params.get("tid")?.trim() || undefined,
      reason: params.get("reason")?.trim() || undefined,
    };
  }

  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      const parsed = (await req.json()) as CancelPayload;
      return {
        orderId: parsed.orderId?.trim() || undefined,
        tid: parsed.tid?.trim() || undefined,
        reason: parsed.reason?.trim() || undefined,
      };
    } catch {
      return {};
    }
  }

  const form = await req.formData();
  return {
    orderId: ((form.get("orderId") as string | null) ?? "").trim() || undefined,
    tid: ((form.get("tid") as string | null) ?? "").trim() || undefined,
    reason: ((form.get("reason") as string | null) ?? "").trim() || undefined,
  };
};

const findHistory = async (payload: CancelPayload) => {
  if (payload.orderId) {
    return getHistoryByOrderId(payload.orderId);
  }
  if (payload.tid) {
    return getHistoryByTid(payload.tid);
  }
  return { history: null, error: { message: "Missing order or tid" } };
};

const isAdminUser = async () => {
  const supabase = await createServerSupabase();
  const { data: adminCheck } = await supabase.rpc("is_admin");
  return Boolean(adminCheck);
};

const handleCancel = async (req: NextRequest, requireAdmin = false) => {
  const baseUrl = getBaseUrl(req);
  const payload = await parsePayload(req);
  if (!payload.orderId && !payload.tid) {
    return NextResponse.json(
      { error: "orderId or tid is required" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !requireAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { history, error } = await findHistory(payload);
  if (error || !history) {
    return NextResponse.json(
      { error: "Subscription record not found" },
      { status: 404 },
    );
  }
  if (history.status === "CANCELED") {
    return NextResponse.json({ ok: true, alreadyCanceled: true });
  }

  const adminAllowed = requireAdmin ? await isAdminUser() : false;
  const isOwner = history.user_id === user?.id;
  if (requireAdmin && !adminAllowed && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!requireAdmin && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (history.status !== "APPROVED" && history.status !== "CANCELED") {
    return NextResponse.json(
      { error: "환불 가능한 결제 상태가 아닙니다." },
      { status: 409 },
    );
  }

  const targetTid = payload.tid ?? history.pg_tid;
  if (!targetTid) {
    return NextResponse.json(
      { error: "결제 TID가 존재하지 않습니다." },
      { status: 400 },
    );
  }

  const refund = await requestRefund({
    tid: targetTid,
    message: payload.reason ?? "subscription cancel",
    clientIp: getClientIp(req),
  });
  const resultCode =
    refund.data?.resultCode != null
      ? String(refund.data.resultCode)
      : refund.ok
        ? "00"
        : "CANCEL_FAIL";
  const resultMsg =
    refund.data?.resultMsg != null
      ? String(refund.data.resultMsg)
      : refund.ok
        ? "정상 취소되었습니다."
        : "취소 실패";

  await updateHistory(history.order_id, {
    status: refund.ok ? "CANCELED" : "FAILED",
    result_code: resultCode,
    result_message: resultMsg,
    raw_response: refund.data ?? null,
  });

  if (!refund.ok) {
    return NextResponse.json(
      {
        error: resultMsg ?? "취소 요청이 실패했습니다.",
        data: refund.data,
      },
      { status: 400 },
    );
  }

  if (history.subscription_id) {
    await cancelSubscription(history.subscription_id, payload.reason);
  }
  if (history.billing_id) {
    await deactivateBilling(history.billing_id);
  }

  return NextResponse.json({
    ok: true,
    data: refund.data,
    redirect: `${baseUrl}/subscription/result?orderId=${encodeURIComponent(history.order_id)}&status=refunded`,
  });
};

export async function POST(req: NextRequest) {
  return handleCancel(req, false);
}

export async function GET(req: NextRequest) {
  return handleCancel(req, false);
}

export const runtime = "nodejs";

export const handleCancelRequest = handleCancel;

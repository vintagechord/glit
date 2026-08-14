import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requestRefund } from "@/lib/inicis/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { getBaseUrl, getClientIp } from "../../../../../lib/url";

const MAX_CANCEL_BODY_BYTES = 16 * 1024;

const cancelPayloadSchema = z
  .object({
    orderId: z.string().trim().min(1).max(160).optional(),
    tid: z.string().trim().min(1).max(255).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((payload) => Boolean(payload.orderId || payload.tid), {
    message: "orderId or tid is required",
  });

type CancelPayload = z.infer<typeof cancelPayloadSchema>;

type RefundClaimRow = {
  history_id: string;
  claimed_order_id: string;
  claimed_pg_tid: string;
  claimed_subscription_id: string | null;
  claimed_billing_id: string | null;
  claim_token: string | null;
  already_canceled: boolean;
};

type RpcError = {
  code?: string | null;
  message?: string | null;
};

const firstRpcRow = <T,>(data: unknown): T | null => {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  if (data && typeof data === "object") return data as T;
  return null;
};

const auditId = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

const textValue = (value: unknown, maxLength: number) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const readBoundedBody = async (req: NextRequest) => {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_CANCEL_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

/**
 * Persist only a small, non-secret PG audit projection. In particular, never
 * retain billing keys, auth tokens, card data, hashes, signatures, or URLs
 * returned by a gateway in a user-related history row.
 */
export const sanitizeSubscriptionRefundResponse = (value: unknown) => {
  const response =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    provider: "inicis",
    resultCode: textValue(
      response.resultCode ?? response.resultcode ?? response.P_STATUS,
      120,
    ),
    resultMessage: textValue(
      response.resultMsg ?? response.resultmsg ?? response.P_RMESG1,
      500,
    ),
    cancelDate: textValue(
      response.cancelDate ?? response.canceldate ?? response.cancel_date,
      32,
    ),
    cancelTime: textValue(
      response.cancelTime ?? response.canceltime ?? response.cancel_time,
      32,
    ),
  };
};

const parsePayload = async (req: NextRequest): Promise<CancelPayload | null> => {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_CANCEL_BODY_BYTES
  ) {
    return null;
  }

  const body = await readBoundedBody(req).catch(() => null);
  if (!body) return null;

  const contentType = req.headers.get("content-type") ?? "";
  let raw: unknown = null;
  if (contentType.includes("application/json")) {
    try {
      raw = JSON.parse(new TextDecoder().decode(body)) as unknown;
    } catch {
      return null;
    }
  } else {
    const form = await new Response(body, {
      headers: { "content-type": contentType },
    })
      .formData()
      .catch(() => null);
    if (form) {
      raw = {
        orderId: form.get("orderId"),
        tid: form.get("tid"),
        reason: form.get("reason"),
      };
    }
  }

  const parsed = cancelPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const refundClaimErrorResponse = (error: RpcError) => {
  const message = String(error.message ?? "");
  if (
    error.code === "P0002" ||
    error.code === "42501" ||
    message.includes("REFUND_NOT_FOUND") ||
    message.includes("REFUND_FORBIDDEN")
  ) {
    // Deliberately collapse missing and non-owned records so authenticated
    // callers cannot use this endpoint as an order/TID existence oracle.
    return NextResponse.json(
      { error: "Subscription record not found" },
      { status: 404 },
    );
  }
  if (message.includes("REFUND_IN_PROGRESS")) {
    return NextResponse.json(
      { error: "이미 환불 요청이 처리 중입니다." },
      { status: 409 },
    );
  }
  if (
    error.code === "55000" ||
    message.includes("REFUND_NOT_ALLOWED") ||
    message.includes("REFUND_CLAIM_MISMATCH")
  ) {
    return NextResponse.json(
      { error: "환불 가능한 결제 상태가 아닙니다." },
      { status: 409 },
    );
  }
  if (error.code === "22023" || error.code === "21000") {
    return NextResponse.json(
      { error: "환불할 결제 정보를 확인해주세요." },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { error: "환불 정보를 확인하지 못했습니다." },
    { status: 500 },
  );
};

const handleCancel = async (req: NextRequest, requireAdmin = false) => {
  // Authenticate before parsing identifiers or querying history so this route
  // cannot be used as an order/TID existence oracle.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let adminAllowed = false;
  if (requireAdmin) {
    const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
    if (adminError || isAdmin !== true) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    adminAllowed = true;
  }

  const payload = await parsePayload(req);
  if (!payload) {
    return NextResponse.json(
      { error: "orderId 또는 tid와 취소 사유를 확인해주세요." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: claimData, error: claimError } = await admin.rpc(
    "claim_subscription_refund",
    {
      p_order_id: payload.orderId ?? null,
      p_pg_tid: payload.tid ?? null,
      p_actor_user_id: user.id,
      p_allow_admin: adminAllowed,
    },
  );

  if (claimError) {
    return refundClaimErrorResponse(claimError);
  }

  const claim = firstRpcRow<RefundClaimRow>(claimData);
  if (!claim?.claimed_order_id) {
    return NextResponse.json(
      { error: "환불 정보를 확인하지 못했습니다." },
      { status: 500 },
    );
  }
  if (claim.already_canceled) {
    return NextResponse.json({ ok: true, alreadyCanceled: true });
  }
  if (!claim.claim_token || !claim.claimed_pg_tid) {
    return NextResponse.json(
      { error: "결제 TID가 존재하지 않습니다." },
      { status: 409 },
    );
  }

  const refundReason = payload.reason || "subscription cancel";
  let refund: Awaited<ReturnType<typeof requestRefund>>;
  try {
    // Always use the TID returned by the locked DB row. A caller-supplied TID
    // is only an exact-match selector in claim_subscription_refund.
    refund = await requestRefund({
      tid: claim.claimed_pg_tid,
      message: refundReason,
      clientIp: getClientIp(req),
    });
  } catch (error) {
    refund = {
      ok: false,
      data: {
        resultCode: "REFUND_REQUEST_ERROR",
        resultMsg:
          error instanceof Error
            ? error.message.slice(0, 300)
            : "환불 요청 중 오류가 발생했습니다.",
      },
    };
  }

  const resultCode =
    textValue(
      refund.data?.resultCode ?? refund.data?.resultcode ?? refund.data?.P_STATUS,
      120,
    ) ?? (refund.ok ? "00" : "CANCEL_FAIL");
  const resultMessage =
    textValue(
      refund.data?.resultMsg ?? refund.data?.resultmsg ?? refund.data?.P_RMESG1,
      500,
    ) ?? (refund.ok ? "정상 취소되었습니다." : "취소 실패");
  const safeRefundResponse = sanitizeSubscriptionRefundResponse(refund.data);

  const commonRpcPayload = {
    p_order_id: claim.claimed_order_id,
    p_pg_tid: claim.claimed_pg_tid,
    p_claim_token: claim.claim_token,
    p_actor_user_id: user.id,
    p_allow_admin: adminAllowed,
    p_result_code: resultCode,
    p_result_message: resultMessage,
    p_refund_response: safeRefundResponse,
  };

  if (!refund.ok) {
    const { error: releaseError } = await admin.rpc(
      "fail_subscription_refund",
      commonRpcPayload,
    );
    if (releaseError) {
      console.error("[subscription-refund] failed to release claim", {
        orderIdHash: auditId(claim.claimed_order_id),
        code: releaseError.code,
      });
      return NextResponse.json(
        {
          error:
            "환불 요청은 실패했으며 상태 복구도 완료되지 않았습니다. 관리자에게 문의해주세요.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: resultMessage }, { status: 400 });
  }

  const { data: finalizedData, error: finalizeError } = await admin.rpc(
    "finalize_subscription_refund",
    {
      ...commonRpcPayload,
      p_reason: refundReason,
    },
  );
  const finalized = firstRpcRow<{ final_status?: string }>(finalizedData);
  if (finalizeError || finalized?.final_status !== "CANCELED") {
    console.error("[subscription-refund] refunded but finalization failed", {
      orderIdHash: auditId(claim.claimed_order_id),
      code: finalizeError?.code ?? null,
    });
    return NextResponse.json(
      {
        error:
          "환불은 승인되었지만 서비스 상태 반영에 실패했습니다. 다시 결제하지 말고 관리자에게 문의해주세요.",
        refundCompleted: true,
      },
      { status: 500 },
    );
  }

  const baseUrl = getBaseUrl(req);
  return NextResponse.json({
    ok: true,
    redirect: `${baseUrl}/subscription/result?orderId=${encodeURIComponent(claim.claimed_order_id)}&status=refunded`,
  });
};

export async function POST(req: NextRequest) {
  return handleCancel(req, false);
}

export function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const runtime = "nodejs";

export const handleCancelRequest = handleCancel;

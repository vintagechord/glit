import { NextRequest, NextResponse } from "next/server";

import { requestStdPayApproval, isInicisSuccessCode } from "@/lib/inicis/api";
import { getStdPayConfig } from "@/lib/inicis/config";
import { getBaseUrl } from "@/lib/url";

const postMessageResponse = (
  type: "SUCCESS" | "FAIL" | "CANCEL" | "ERROR",
  payload: Record<string, unknown>,
) => {
  const safePayload = JSON.stringify({ type: `INICIS:${type}`, payload });
  const html = `
<!DOCTYPE html>
<html lang="ko">
<body>
<p>결제 창을 닫아주세요.</p>
<script>
  (function() {
    try {
      if (window.opener) {
        window.opener.postMessage(${safePayload}, "*");
      }
    } catch (e) {
      console.error("INICIS postMessage error", e);
    }
    window.close();
  })();
</script>
</body>
</html>
`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

const maskMid = (mid: string) => {
  if (!mid) return "";
  return mid.length <= 4 ? `${mid.slice(0, 2)}**` : `${mid.slice(0, 2)}***${mid.slice(-2)}`;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
  }

  const baseUrl = getBaseUrl(req);
  let params: Record<string, string> = {};
  let formKeys: string[] = [];

  try {
    const form = await req.formData();
    formKeys = Array.from(form.keys());
    params = Object.fromEntries(
      Array.from(form.entries()).map(([k, v]) => [k, String(v)]),
    );
  } catch (error) {
    console.warn("[Inicis][STDPay][test-1000][callback] formData parse error", error);
  }

  const pick = (k: string) => (typeof params[k] === "string" ? String(params[k]) : "");
  const mask = (v: string) => (!v ? "" : v.length <= 4 ? `${v[0] ?? ""}*` : `${v.slice(0, 4)}***${v.slice(-2)}`);

  const authToken = pick("authToken");
  const authUrl = pick("authUrl") || pick("checkAckUrl");
  const netCancelUrl = pick("netCancelUrl") || pick("NetCancelURL");
  const orderId = pick("oid") || pick("orderNumber") || pick("MOID") || pick("orderId");
  const mid = pick("mid");
  const timestamp = pick("timestamp") || pick("tstamp") || Date.now().toString();
  const isCancel = pick("cancel") === "1" || pick("cancel") === "true";
  const resultCode = pick("resultCode") || pick("resultcode") || pick("P_STATUS");
  const resultMsg = (pick("resultMsg") || pick("resultmsg") || pick("P_RMESG1")).slice(0, 120);
  const tidRaw = pick("tid") || pick("P_TID") || pick("TID") || pick("PG_TID") || pick("CARD_TID");
  const totPrice = pick("TotPrice") || pick("price") || pick("amt") || pick("P_AMT");

  console.info("[Inicis][STDPay][test-1000][callback] received keys", formKeys);
  console.info("[Inicis][STDPay][test-1000][callback] received core", {
    resultCode,
    resultMsg,
    mid: mask(mid),
    MOID: orderId,
    TotPrice: totPrice,
    tid: mask(tidRaw),
    hasAuthToken: Boolean(authToken),
    hasAuthUrl: Boolean(authUrl),
    hasNetCancelUrl: Boolean(netCancelUrl),
    hasCheckAckUrl: Boolean(pick("checkAckUrl")),
  });

  if (isCancel) {
    return postMessageResponse("CANCEL", {
      orderId,
      message: "사용자가 결제를 취소했습니다.",
    });
  }

  if (resultCode && !isInicisSuccessCode(resultCode)) {
    return postMessageResponse("FAIL", {
      orderId,
      resultCode,
      resultMsg,
      message: resultMsg || "이니시스 인증이 실패했습니다.",
    });
  }

  if (!authToken || !authUrl || !orderId) {
    return postMessageResponse("FAIL", {
      orderId,
      message: "인증 토큰을 받지 못했습니다.",
      missing: [
        !authToken ? "authToken" : null,
        !authUrl ? "authUrl/checkAckUrl" : null,
        !orderId ? "oid" : null,
      ].filter(Boolean),
    });
  }

  const config = getStdPayConfig();
  if (mid && mid !== config.mid) {
    console.warn("[Inicis][STDPay][test-1000][callback] MID mismatch", {
      got: maskMid(mid),
      expected: maskMid(config.mid),
    });
    return postMessageResponse("FAIL", {
      orderId,
      message: "MID 불일치",
    });
  }

  console.info("[Inicis][STDPay][test-1000][callback] auth_call_start", {
    orderId,
    authHost: (() => {
      try {
        const u = new URL(authUrl);
        return `${u.host}${u.pathname}`;
      } catch {
        return null;
      }
    })(),
    hasTstamp: Boolean(pick("tstamp") || pick("timestamp")),
    hasNetCancelUrl: Boolean(netCancelUrl),
  });

  const approval = await requestStdPayApproval({
    authUrl,
    netCancelUrl: null,
    authToken,
    timestamp: String(timestamp),
    skipNetCancel: true,
  });

  const approvalResultCode =
    approval.data?.resultCode ?? approval.data?.resultcode ?? "UNKNOWN";
  const approvalResultMsg =
    approval.data?.resultMsg ?? approval.data?.resultmsg ?? null;
  const approvalTid =
    approval.data?.tid ??
    approval.data?.P_TID ??
    approval.data?.TID ??
    approval.data?.PG_TID ??
    approval.data?.CARD_TID ??
    tidRaw ??
    null;

  console.info("[Inicis][STDPay][test-1000][callback] auth_call_done", {
    orderId,
    resultCode: approvalResultCode,
    resultMsg: approvalResultMsg ? String(approvalResultMsg).slice(0, 120) : null,
    tid: approvalTid ? mask(String(approvalTid)) : null,
    secureSignatureMatches: approval.secureSignatureMatches ?? null,
  });

  if (!approval.ok || !isInicisSuccessCode(approvalResultCode)) {
    console.info("[Inicis][STDPay][test-1000][callback] netCancel_skipped", {
      orderId,
      reason: "approval_failed",
      hasNetCancelUrl: Boolean(netCancelUrl),
    });
    return postMessageResponse("FAIL", {
      orderId,
      resultCode: approvalResultCode,
      resultMsg: approvalResultMsg ?? "승인에 실패했습니다.",
      secureSignatureMatches: approval.secureSignatureMatches ?? null,
    });
  }

  return postMessageResponse("SUCCESS", {
    orderId,
    resultCode: approvalResultCode,
    resultMsg: approvalResultMsg ?? "승인되었습니다.",
    secureSignatureMatches: approval.secureSignatureMatches ?? null,
    tid: approvalTid ?? null,
    amount: approval.data?.TotPrice ?? totPrice ?? null,
  });
}

export const POST = handler;

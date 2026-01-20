import { NextRequest, NextResponse } from "next/server";

import { requestStdPayApproval } from "@/lib/inicis/api";
import { getStdPayConfig } from "@/lib/inicis/config";
import { getBaseUrl } from "@/lib/url";
import { isInicisSuccessCode } from "@/lib/inicis/api";

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

  const authToken = params.authToken ?? "";
  const authUrl = params.authUrl ?? "";
  const netCancelUrl = params.netCancelUrl ?? "";
  const orderId = params.oid ?? params.orderNumber ?? "";
  const mid = params.mid ?? "";
  const timestamp = params.timestamp ?? params.tstamp ?? Date.now().toString();
  const isCancel = params.cancel === "1" || params.cancel === "true";
  const resultCode = params.resultCode ?? params.resultcode ?? params.P_STATUS ?? "";
  const resultMsg = params.resultMsg ?? params.resultmsg ?? params.P_RMESG1 ?? "";

  console.info("[Inicis][STDPay][test-1000][callback] incoming", {
    method: req.method,
    baseUrl,
    hasAuthToken: Boolean(authToken),
    hasAuthUrl: Boolean(authUrl),
    hasOrderId: Boolean(orderId),
    mid: maskMid(mid),
    formKeys,
  });

  if (resultCode && !isInicisSuccessCode(resultCode)) {
    return postMessageResponse("FAIL", {
      orderId,
      resultCode,
      resultMsg,
      message: resultMsg || "이니시스 인증이 실패했습니다.",
    });
  }

  if (isCancel) {
    return postMessageResponse("CANCEL", {
      orderId,
      message: "사용자가 결제를 취소했습니다.",
    });
  }

  if (!authToken || !authUrl || !orderId) {
    return postMessageResponse("FAIL", {
      orderId,
      message: "인증 토큰을 받지 못했습니다.",
      missing: [
        !authToken ? "authToken" : null,
        !authUrl ? "authUrl" : null,
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

  const approval = await requestStdPayApproval({
    authUrl,
    netCancelUrl,
    authToken,
    timestamp: String(timestamp),
  });

  if (!approval.ok || !isInicisSuccessCode(approval.data?.resultCode ?? approval.data?.resultcode)) {
    const resultCode =
      approval.data?.resultCode ?? approval.data?.resultcode ?? "APPROVAL_FAIL";
    const resultMsg =
      approval.data?.resultMsg ?? approval.data?.resultmsg ?? "승인에 실패했습니다.";
    return postMessageResponse("FAIL", {
      orderId,
      resultCode,
      resultMsg,
      secureSignatureMatches: approval.secureSignatureMatches ?? null,
    });
  }

  return postMessageResponse("SUCCESS", {
    orderId,
    resultCode: approval.data?.resultCode ?? approval.data?.resultcode ?? "0000",
    resultMsg: approval.data?.resultMsg ?? approval.data?.resultmsg ?? "승인되었습니다.",
    secureSignatureMatches: approval.secureSignatureMatches ?? null,
  });
}

export const POST = handler;
export const GET = handler;

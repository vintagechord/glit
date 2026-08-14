import { NextResponse } from "next/server";

import { markPaymentCanceled } from "@/lib/payments/submission";
import { markKaraokePaymentCanceled } from "@/lib/payments/karaoke";
import {
  createPaymentResultGrant,
  setPaymentResultGrantCookie,
} from "@/lib/payment-result-grant";
import { serializeInlineScriptJson } from "@/lib/inline-script-json";

const orderIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const callbackStatePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const postMessageResponse = (payloadData: Record<string, unknown> = {}) => {
  const payload = serializeInlineScriptJson({
    type: "INICIS:CANCEL",
    payload: {
      message: "사용자가 결제를 취소했습니다.",
      ...payloadData,
    },
  });
  const html = `
<!DOCTYPE html>
<html lang="ko">
<body style="margin:0;background:transparent;">
<script>
  (function() {
    try {
      document.body.innerHTML = "";
      if (window.opener) {
        window.opener.postMessage(${payload}, window.location.origin);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(${payload}, window.location.origin);
      }
    } catch (e) {
      console.error("INICIS postMessage error", e);
    }
    setTimeout(function() {
      try {
        window.close();
      } catch (e) {}
    }, 0);
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawOrderId = url.searchParams.get("oid") ?? "";
  const rawCloseState = url.searchParams.get("state") ?? "";
  const orderId = orderIdPattern.test(rawOrderId) ? rawOrderId : null;
  const closeState = callbackStatePattern.test(rawCloseState)
    ? rawCloseState
    : "";
  const payloadData: Record<string, unknown> = {};
  let paymentResultGrant: string | null = null;

  if (orderId && closeState) {
    const rawResponse = {
      closeUrl: true,
      cancel: url.searchParams.get("cancel") ?? null,
    };
    const [submissionResult, karaokeResult] = await Promise.all([
      markPaymentCanceled(orderId, {
        result_code: "CANCELED",
        result_message: "사용자가 결제창을 닫았습니다.",
        raw_response: rawResponse,
        close_state: closeState,
      }),
      markKaraokePaymentCanceled(orderId, {
        result_code: "CANCELED",
        result_message: "사용자가 결제창을 닫았습니다.",
        raw_response: rawResponse,
        close_state: closeState,
      }),
    ]);
    if (submissionResult.submissionId) {
      payloadData.submissionId = submissionResult.submissionId;
    }
    if (
      submissionResult.ok &&
      submissionResult.submissionId &&
      submissionResult.guestToken
    ) {
      paymentResultGrant = createPaymentResultGrant({
        provider: "inicis",
        submissionId: submissionResult.submissionId,
        orderId,
        guestToken: submissionResult.guestToken,
      });
    }
    if (karaokeResult.requestId) {
      payloadData.requestId = karaokeResult.requestId;
    }
    if (!submissionResult.ok && !karaokeResult.ok) {
      console.warn("[Inicis][close] cancel persistence failed", {
        orderId,
        submissionError: submissionResult.error,
        karaokeError: karaokeResult.error,
      });
    }
  } else if (orderId) {
    console.warn("[Inicis][close] missing authenticated close state", {
      orderId,
    });
  }

  const response = postMessageResponse(payloadData);
  if (paymentResultGrant) {
    setPaymentResultGrantCookie(response, paymentResultGrant);
  }
  return response;
}

export const POST = GET;

import { NextResponse } from "next/server";

import { markPaymentCanceled } from "@/lib/payments/submission";
import { markKaraokePaymentCanceled } from "@/lib/payments/karaoke";

const postMessageResponse = () => {
  const payload = JSON.stringify({
    type: "INICIS:CANCEL",
    payload: { message: "사용자가 결제를 취소했습니다." },
  });
  const html = `
<!DOCTYPE html>
<html lang="ko">
<body>
<p>결제 창을 닫아주세요.</p>
<script>
  (function() {
    try {
      if (window.opener) {
        window.opener.postMessage(${payload}, "*");
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("oid")?.trim();

  if (orderId) {
    const rawResponse = {
      closeUrl: true,
      cancel: url.searchParams.get("cancel") ?? null,
    };
    const [submissionResult, karaokeResult] = await Promise.all([
      markPaymentCanceled(orderId, {
        result_code: "CANCELED",
        result_message: "사용자가 결제창을 닫았습니다.",
        raw_response: rawResponse,
      }),
      markKaraokePaymentCanceled(orderId, {
        result_code: "CANCELED",
        result_message: "사용자가 결제창을 닫았습니다.",
        raw_response: rawResponse,
      }),
    ]);
    if (!submissionResult.ok && !karaokeResult.ok) {
      console.warn("[Inicis][close] cancel persistence failed", {
        orderId,
        submissionError: submissionResult.error,
        karaokeError: karaokeResult.error,
      });
    }
  }

  return postMessageResponse();
}

export const POST = GET;

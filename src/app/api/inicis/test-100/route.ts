import { NextRequest, NextResponse } from "next/server";

import { getStdPayConfig } from "@/lib/inicis/config";
import { buildStdPayRequest } from "@/lib/inicis/stdpay";
import { buildUrl, getBaseUrl } from "@/lib/url";

const TEST_AMOUNT = 1000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const baseUrl = getBaseUrl(req);
    const config = getStdPayConfig();
    const orderId = `TEST1000-${Date.now()}`;
    const returnUrl = buildUrl("/api/inicis/test-100/return", baseUrl);
    const closeUrl = buildUrl("/api/inicis/test-100/close", baseUrl);

    const stdParams = buildStdPayRequest({
      orderId,
      amountKrw: TEST_AMOUNT,
      productName: "GLIT 1000원 테스트 결제",
      buyerName: "테스터",
      buyerEmail: "",
      buyerTel: "",
      returnUrl,
      closeUrl,
    });

    console.info("[Inicis][STDPay][test-1000][init]", {
      orderId,
      amount: TEST_AMOUNT,
      mid: config.mid.length <= 4 ? `${config.mid.slice(0, 2)}**` : `${config.mid.slice(0, 2)}***${config.mid.slice(-2)}`,
      returnUrl,
      closeUrl,
    });

    return NextResponse.json({
      ok: true,
      orderId,
      amount: TEST_AMOUNT,
      stdParams,
      stdJsUrl: config.stdJsUrl,
      returnUrl,
      closeUrl,
    });
  } catch (error) {
    console.error("[Inicis][STDPay][test-1000][init][error]", error);
    const message = error instanceof Error ? error.message : "초기화 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = POST;

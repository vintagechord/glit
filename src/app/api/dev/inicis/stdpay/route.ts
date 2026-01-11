import { NextRequest, NextResponse } from "next/server";

import { getStdPayConfig } from "@/lib/inicis/config";
import { buildStdPayRequest } from "@/lib/inicis/stdpay";
import { getBaseUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  const devToolsEnabled =
    process.env.NODE_ENV !== "production" ||
    String(process.env.INICIS_DEV_TOOLS ?? "").toLowerCase() === "true";

  if (!devToolsEnabled) {
    return NextResponse.json(
      { error: "Dev STDPay API는 프로덕션에서 비활성화되어 있습니다. INICIS_DEV_TOOLS=true 로 켜세요." },
      { status: 403 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount ?? 0);
    const productName = String(body.productName ?? "STDPay Test").trim() || "STDPay Test";
    const buyerName = String(body.buyerName ?? "Tester").trim() || "Tester";
    const buyerEmail = String(body.buyerEmail ?? "").trim() || "";
    const buyerTel = String(body.buyerTel ?? "").trim() || "";

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "금액을 확인해주세요." }, { status: 400 });
    }

    const config = getStdPayConfig();
    const baseUrl = getBaseUrl(req);
    if (baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.")) {
      return NextResponse.json(
        {
          error:
            "STDPay 콜백은 로컬 http://localhost 로 호출이 어렵습니다. NEXT_PUBLIC_SITE_URL에 https 퍼블릭 URL(ngrok 등)을 설정하고 다시 시도하세요.",
        },
        { status: 400 },
      );
    }
    const orderId = `DEV-${Date.now()}`;
    const returnUrl = `${baseUrl}/api/dev/inicis/stdpay-return`;
    const closeUrl = `${baseUrl}/dev/inicis-stdpay`;

    const stdParams = buildStdPayRequest({
      orderId,
      amountKrw: amount,
      productName,
      buyerName,
      buyerEmail,
      buyerTel,
      returnUrl,
      closeUrl,
    });

    console.info("[Inicis][STDPay][dev-init]", {
      orderId,
      amount,
      mid: config.mid.slice(0, 2) + "***" + config.mid.slice(-2),
      stdJsUrl: config.stdJsUrl,
      signKeyLen: config.signKey.length,
      signatureLen: String(stdParams.signature ?? "").length,
      mKeyLen: String(stdParams.mKey ?? "").length,
      returnUrl,
      closeUrl,
    });

    return NextResponse.json({
      orderId,
      stdParams,
      stdJsUrl: config.stdJsUrl,
      returnUrl,
      closeUrl,
    });
  } catch (error: any) {
    console.error("[Inicis][STDPay][dev-init][error]", error);
    const message = error?.message ?? "초기화 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { createKaraokePaymentOrder, ensureKaraokeRequestOwner } from "@/lib/payments/karaoke";
import { getBaseUrl } from "@/lib/url";
import { parseInicisContext } from "@/lib/inicis/context";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const requestId = String(body.requestId ?? "").trim();
    const context = parseInicisContext(body.context);

    if (!context || context !== "karaoke") {
      return NextResponse.json({ error: "context가 올바르지 않습니다." }, { status: 400 });
    }
    if (!requestId) {
      return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });
    }

    const ownership = await ensureKaraokeRequestOwner(requestId);
    if (ownership.error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    if (ownership.error === "NOT_FOUND") {
      return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
    }
    if (ownership.error === "FORBIDDEN") {
      return NextResponse.json({ error: "요청 소유자가 아닙니다." }, { status: 403 });
    }

    const baseUrl = getBaseUrl(req);
    const { error, result } = await createKaraokePaymentOrder(requestId, baseUrl);
    if (error || !result) {
      console.error("[Karaoke][Inicis][STDPay][init][order-error]", {
        requestId,
        context,
        baseUrl,
        error,
      });
      const status =
        error?.includes("이미 결제가 완료") || error?.includes("시작할 수 없습니다")
          ? 409
          : 400;
      return NextResponse.json({ error: error ?? "결제 요청 생성 실패" }, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Karaoke][Inicis][STDPay][init][order-unhandled]", error);
    return NextResponse.json(
      { error: "결제 요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createKaraokePaymentOrder, ensureKaraokeRequestOwner } from "@/lib/payments/karaoke";
import { getBaseUrl } from "@/lib/url";
import { parseInicisContext } from "@/lib/inicis/context";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";

const requestSchema = z
  .object({
    requestId: z.string().uuid(),
    context: z.literal("karaoke"),
  })
  .strict();

export async function POST(req: NextRequest) {
  const ipLimit = consumeRateLimit({
    namespace: "inicis-karaoke-order-ip",
    identifier: getRequestIdentifier(req.headers),
    limit: 20,
    windowMs: 15 * 60 * 1_000,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "결제 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 429,
        headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
      },
    );
  }
  try {
    const body = await readBoundedJsonBody(req, 16 * 1024);
    if (!body.ok) {
      return NextResponse.json(
        { error: "결제 요청 정보를 확인해주세요." },
        { status: body.reason === "too_large" ? 413 : 400 },
      );
    }
    const parsed = requestSchema.safeParse(body.value);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "결제 요청 정보를 확인해주세요." },
        { status: 400 },
      );
    }
    const requestId = parsed.data.requestId;
    const requestLimit = consumeRateLimit({
      namespace: "inicis-karaoke-order-request",
      identifier: requestId,
      limit: 10,
      windowMs: 15 * 60 * 1_000,
    });
    if (!requestLimit.allowed) {
      return NextResponse.json(
        { error: "결제 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
        {
          status: 429,
          headers: { "Retry-After": String(requestLimit.retryAfterSeconds) },
        },
      );
    }
    const context = parseInicisContext(parsed.data.context);

    if (!context || context !== "karaoke") {
      return NextResponse.json({ error: "context가 올바르지 않습니다." }, { status: 400 });
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

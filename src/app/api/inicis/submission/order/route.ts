import { NextRequest, NextResponse } from "next/server";

import { ensureSubmissionOwner, createSubmissionPaymentOrder } from "../../../../../lib/payments/submission";
import { getBaseUrl } from "../../../../../lib/url";
import { parseInicisContext } from "@/lib/inicis/context";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const submissionId = String(body.submissionId ?? "").trim();
    const guestToken = body.guestToken ? String(body.guestToken) : undefined;
    const context = parseInicisContext(body.context);

    if (!context) {
      return NextResponse.json(
        { error: "context가 올바르지 않습니다.", received: body.context ?? null },
        { status: 400 },
      );
    }
    if (!submissionId) {
      return NextResponse.json({ error: "submissionId가 필요합니다." }, { status: 400 });
    }

    const ownership = await ensureSubmissionOwner(submissionId, guestToken);
    if (ownership.error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인 또는 조회코드가 필요합니다." }, { status: 401 });
    }
    if (ownership.error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (ownership.error === "FORBIDDEN") {
      return NextResponse.json({ error: "접수 소유자가 아닙니다." }, { status: 403 });
    }

    const baseUrl = getBaseUrl(req);
    const { error, result } = await createSubmissionPaymentOrder(submissionId, baseUrl);
    if (error || !result) {
      console.error("[Inicis][STDPay][init][order-error]", {
        submissionId,
        context,
        baseUrl,
        error,
      });
      return NextResponse.json({ error: error ?? "결제 요청 생성 실패" }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[Inicis][STDPay][init][order-unhandled]", error);
    return NextResponse.json(
      { error: "결제 요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";

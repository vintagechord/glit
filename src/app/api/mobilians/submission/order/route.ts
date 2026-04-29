import { NextRequest, NextResponse } from "next/server";

import {
  createMobiliansSubmissionPaymentOrder,
} from "@/lib/mobilians/payments";
import { parseInicisContext } from "@/lib/inicis/context";
import { getServerCardPaymentProvider } from "@/lib/payments/provider";
import { ensureSubmissionOwner } from "@/lib/payments/submission";
import { getBaseUrl } from "@/lib/url";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const submissionId = String(body.submissionId ?? "").trim();
    const guestToken = body.guestToken ? String(body.guestToken).trim() : undefined;
    const context = parseInicisContext(body.context);

    if (getServerCardPaymentProvider() !== "mobilians") {
      return NextResponse.json(
        { error: "현재 카드 결제 제공자가 모빌리언스가 아닙니다." },
        { status: 409 },
      );
    }

    if (!context) {
      return NextResponse.json(
        { error: "context가 올바르지 않습니다.", received: body.context ?? null },
        { status: 400 },
      );
    }
    if (context !== "music" && context !== "mv" && context !== "oneclick") {
      return NextResponse.json(
        { error: "submission 결제에서 지원하지 않는 context입니다." },
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
    const { error, result } = await createMobiliansSubmissionPaymentOrder(
      submissionId,
      baseUrl,
    );
    if (error || !result) {
      console.error("[Mobilians][submission][order-error]", {
        submissionId,
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
    console.error("[Mobilians][submission][order-unhandled]", error);
    return NextResponse.json(
      { error: "결제 요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}

export const runtime = "nodejs";

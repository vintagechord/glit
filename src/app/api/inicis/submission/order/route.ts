import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ensureSubmissionOwner, createSubmissionPaymentOrder } from "../../../../../lib/payments/submission";
import { getBaseUrl } from "../../../../../lib/url";
import { parseInicisContext } from "@/lib/inicis/context";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxSubmissionCount = 100;
const guestTokenSchema = z
  .string()
  .min(8)
  .max(120)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const requestSchema = z
  .object({
    submissionId: z.string().uuid(),
    submissionIds: z
      .union([
        z.string().max(4_000),
        z.array(z.string().uuid()).max(maxSubmissionCount),
      ])
      .optional(),
    guestToken: guestTokenSchema.optional(),
    guestTokensBySubmissionId: z
      .record(z.string().uuid(), guestTokenSchema)
      .optional(),
    context: z.string().min(1).max(32),
  })
  .strict();

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringList(item))
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

export async function POST(req: NextRequest) {
  const ipLimit = consumeRateLimit({
    namespace: "inicis-submission-order-ip",
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
    const body = await readBoundedJsonBody(req, 32 * 1024);
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
    const submissionId = parsed.data.submissionId;
    const submissionLimit = consumeRateLimit({
      namespace: "inicis-submission-order-submission",
      identifier: submissionId,
      limit: 10,
      windowMs: 15 * 60 * 1_000,
    });
    if (!submissionLimit.allowed) {
      return NextResponse.json(
        { error: "결제 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
        {
          status: 429,
          headers: {
            "Retry-After": String(submissionLimit.retryAfterSeconds),
          },
        },
      );
    }
    const requestedSubmissionIds = normalizeStringList(parsed.data.submissionIds);
    const submissionIds = Array.from(
      new Set([submissionId, ...requestedSubmissionIds].filter(Boolean)),
    );
    const guestToken = parsed.data.guestToken;
    const guestTokensBySubmissionId =
      parsed.data.guestTokensBySubmissionId ?? {};
    const guestTokenEntries = Object.entries(guestTokensBySubmissionId);
    const context = parseInicisContext(parsed.data.context);

    if (!context) {
      return NextResponse.json(
        { error: "context가 올바르지 않습니다." },
        { status: 400 },
      );
    }
    const isSubmissionContext =
      context === "music" || context === "mv" || context === "oneclick";
    if (!isSubmissionContext) {
      return NextResponse.json(
        { error: "submission 결제에서 지원하지 않는 context입니다." },
        { status: 400 },
      );
    }
    if (
      submissionIds.length > maxSubmissionCount ||
      submissionIds.some((id) => !uuidPattern.test(id)) ||
      guestTokenEntries.length > maxSubmissionCount ||
      guestTokenEntries.some(([id]) => !submissionIds.includes(id))
    ) {
      return NextResponse.json(
        { error: "결제할 접수 ID를 확인해주세요." },
        { status: 400 },
      );
    }

    const ownership = await ensureSubmissionOwner(
      submissionId,
      guestTokensBySubmissionId[submissionId] ?? guestToken,
    );
    if (ownership.error === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인 또는 조회코드가 필요합니다." }, { status: 401 });
    }
    if (ownership.error === "NOT_FOUND") {
      return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
    }
    if (ownership.error === "FORBIDDEN") {
      return NextResponse.json({ error: "접수 소유자가 아닙니다." }, { status: 403 });
    }

    for (const relatedSubmissionId of submissionIds) {
      if (relatedSubmissionId === submissionId) continue;
      const relatedOwnership = await ensureSubmissionOwner(
        relatedSubmissionId,
        guestTokensBySubmissionId[relatedSubmissionId] ?? guestToken,
      );
      if (relatedOwnership.error === "UNAUTHORIZED") {
        return NextResponse.json({ error: "로그인 또는 조회코드가 필요합니다." }, { status: 401 });
      }
      if (relatedOwnership.error === "NOT_FOUND") {
        return NextResponse.json({ error: "접수를 찾을 수 없습니다." }, { status: 404 });
      }
      if (relatedOwnership.error === "FORBIDDEN") {
        return NextResponse.json({ error: "접수 소유자가 아닙니다." }, { status: 403 });
      }
    }

    const baseUrl = getBaseUrl(req);
    const { error, result } = await createSubmissionPaymentOrder(
      submissionId,
      baseUrl,
      { submissionIds },
    );
    if (error || !result) {
      console.error("[Inicis][STDPay][init][order-error]", {
        submissionId,
        context,
        baseUrl,
        error,
      });
      const status =
        error?.includes("이미 결제가") || error?.includes("시작할 수 없습니다")
          ? 409
          : 400;
      return NextResponse.json({ error: error ?? "결제 요청 생성 실패" }, { status });
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

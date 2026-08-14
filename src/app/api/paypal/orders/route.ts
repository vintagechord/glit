import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createPayPalOrderForSubmission,
  summarizeUnexpectedPayPalError,
} from "@/lib/payments/paypal";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const guestTokenSchema = z
  .string()
  .min(8)
  .max(120)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const orderBodySchema = z
  .object({
    submissionId: z.string().uuid(),
    guestToken: guestTokenSchema.optional(),
  })
  .strict();

export async function POST(req: Request) {
  const ipLimit = consumeRateLimit({
    namespace: "paypal-order-ip",
    identifier: getRequestIdentifier(req.headers),
    limit: 20,
    windowMs: 15 * 60 * 1_000,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many payment requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
      },
    );
  }
  const body = await readBoundedJsonBody(req, 16 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: "Payment request is invalid." },
      { status: body.reason === "too_large" ? 413 : 400 },
    );
  }
  const parsed = orderBodySchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payment request is invalid." },
      { status: 400 },
    );
  }
  const { submissionId, guestToken } = parsed.data;
  const submissionLimit = consumeRateLimit({
    namespace: "paypal-order-submission",
    identifier: submissionId,
    limit: 10,
    windowMs: 15 * 60 * 1_000,
  });
  if (!submissionLimit.allowed) {
    return NextResponse.json(
      { error: "Too many payment requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(submissionLimit.retryAfterSeconds) },
      },
    );
  }

  try {
    const result = await createPayPalOrderForSubmission({
      submissionId,
      guestToken,
      request: req,
    });

    if (result.error || !result.approveUrl) {
      return NextResponse.json(
        { error: result.error ?? "PayPal order could not be created." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      approveUrl: result.approveUrl,
    });
  } catch (error) {
    console.error(
      "[PayPal] order route failed",
      summarizeUnexpectedPayPalError(error),
    );
    return NextResponse.json(
      { error: "PayPal order could not be created." },
      { status: 500 },
    );
  }
}

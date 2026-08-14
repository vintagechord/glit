import { NextResponse } from "next/server";
import { z } from "zod";

import {
  capturePayPalOrder,
  markPayPalOrderCanceled,
  resolvePayPalReturnGuestAccess,
  summarizeUnexpectedPayPalError,
} from "@/lib/payments/paypal";
import {
  createPaymentResultGrant,
  setPaymentResultGrantCookie,
} from "@/lib/payment-result-grant";
import { readBoundedJsonBody } from "@/lib/request-body";
import {
  consumeRateLimit,
  getRequestIdentifier,
} from "@/lib/request-rate-limit";
import { getBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paypalOrderIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const guestTokenSchema = z
  .string()
  .min(8)
  .max(120)
  .refine((value) => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const captureBodySchema = z
  .object({
    orderId: z.string().regex(paypalOrderIdPattern),
    submissionId: z.string().uuid(),
    guestToken: guestTokenSchema.optional(),
    returnState: z.string().uuid().optional(),
  })
  .strict();

const redirectToStatus = (
  submissionId: string,
  payment: "paid" | "cancelled" | "failed",
) => {
  const url = new URL(
    `/en/submissions/${encodeURIComponent(submissionId)}`,
    getBaseUrl(),
  );
  url.searchParams.set("payment", payment);
  return NextResponse.redirect(url);
};

const withGuestResultGrant = async ({
  response,
  orderId,
  submissionId,
  returnState,
}: {
  response: NextResponse;
  orderId: string;
  submissionId: string;
  returnState: string;
}) => {
  const access = await resolvePayPalReturnGuestAccess({
    orderId,
    submissionId,
    returnState,
  });
  if (!access.authorized || !access.guestToken) return response;
  const grant = createPaymentResultGrant({
    provider: "paypal",
    submissionId,
    orderId,
    guestToken: access.guestToken,
  });
  if (grant) setPaymentResultGrantCookie(response, grant);
  return response;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const submissionId = url.searchParams.get("submissionId") ?? "";
  const returnState = url.searchParams.get("state") ?? "";
  // Never accept or reflect the long-lived guest submission token in a
  // third-party return URL. Guest callbacks use the order-bound state nonce.
  const guestToken = "";
  const orderId =
    url.searchParams.get("token") ??
    url.searchParams.get("orderId") ??
    "";
  const cancelled = url.searchParams.get("cancel") === "1";

  if (!z.string().uuid().safeParse(submissionId).success) {
    return NextResponse.json(
      { error: "submissionId is invalid." },
      { status: 400 },
    );
  }
  if (
    !z.string().uuid().safeParse(returnState).success ||
    !paypalOrderIdPattern.test(orderId)
  ) {
    return redirectToStatus(submissionId, "failed");
  }

  const ipLimit = consumeRateLimit({
    namespace: "paypal-capture-return-ip",
    identifier: getRequestIdentifier(req.headers),
    limit: 30,
    windowMs: 15 * 60 * 1_000,
  });
  const orderLimit = consumeRateLimit({
    namespace: "paypal-capture-return-order",
    identifier: orderId,
    limit: 10,
    windowMs: 15 * 60 * 1_000,
  });
  if (!ipLimit.allowed || !orderLimit.allowed) {
    const blocked = !ipLimit.allowed ? ipLimit : orderLimit;
    const response = redirectToStatus(submissionId, "failed");
    response.headers.set("Retry-After", String(blocked.retryAfterSeconds));
    return response;
  }

  if (cancelled) {
    const result = await markPayPalOrderCanceled({
      orderId: orderId || null,
      submissionId,
      guestToken,
      returnState,
    });
    return withGuestResultGrant({
      response: redirectToStatus(
        submissionId,
        result.error ? "failed" : "cancelled",
      ),
      orderId,
      submissionId,
      returnState,
    });
  }

  if (!orderId) {
    return redirectToStatus(submissionId, "failed");
  }

  try {
    const result = await capturePayPalOrder({
      orderId,
      submissionId,
      guestToken,
      returnState,
    });

    if (result.error) {
      return withGuestResultGrant({
        response: redirectToStatus(submissionId, "failed"),
        orderId,
        submissionId,
        returnState,
      });
    }

    return withGuestResultGrant({
      response: redirectToStatus(submissionId, "paid"),
      orderId,
      submissionId,
      returnState,
    });
  } catch (error) {
    console.error(
      "[PayPal] capture route failed",
      summarizeUnexpectedPayPalError(error),
    );
    return withGuestResultGrant({
      response: redirectToStatus(submissionId, "failed"),
      orderId,
      submissionId,
      returnState,
    });
  }
}

export async function POST(req: Request) {
  const ipLimit = consumeRateLimit({
    namespace: "paypal-capture-post-ip",
    identifier: getRequestIdentifier(req.headers),
    limit: 30,
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
  const parsed = captureBodySchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payment request is invalid." },
      { status: 400 },
    );
  }
  const {
    orderId,
    submissionId,
    guestToken = "",
    returnState = "",
  } = parsed.data;
  const orderLimit = consumeRateLimit({
    namespace: "paypal-capture-post-order",
    identifier: orderId,
    limit: 10,
    windowMs: 15 * 60 * 1_000,
  });
  if (!orderLimit.allowed) {
    return NextResponse.json(
      { error: "Too many payment requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(orderLimit.retryAfterSeconds) },
      },
    );
  }

  const result = await capturePayPalOrder({
    orderId,
    submissionId,
    guestToken,
    returnState,
  });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, captureId: result.captureId });
}

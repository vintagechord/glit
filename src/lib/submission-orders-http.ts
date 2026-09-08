import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeRateLimit, getRequestIdentifier } from "@/lib/request-rate-limit";
import { getBaseUrl } from "@/lib/url";

export const orderGuestTokensSchema = z.record(z.string().uuid(), z.string().min(8).max(120)
  .refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)))
  .refine(tokens => Object.keys(tokens).length <= 100);

export const orderOffsetSchema = z.coerce.number().int().min(0).max(100_000).default(0);

export const orderJson = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export function checkOrderRequest(request: Request, mutation = false) {
  const origin = request.headers.get("origin");
  if (mutation && ((origin && origin !== new URL(request.url).origin && origin !== getBaseUrl()) || request.headers.get("sec-fetch-site") === "cross-site")) {
    return orderJson({ error: "같은 사이트에서 다시 요청해주세요." }, 403);
  }
  const limit = consumeRateLimit({
    namespace: mutation ? "orders-return-ip" : "orders-read-ip",
    identifier: getRequestIdentifier(request.headers), limit: mutation ? 20 : 120, windowMs: 15 * 60 * 1_000,
  });
  return limit.allowed ? null : NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, {
    status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "private, no-store" },
  });
}

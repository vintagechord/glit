import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { NextResponse } from "next/server";

import {
  PAYMENT_RESULT_GRANT_COOKIE,
  PAYMENT_RESULT_GRANT_TTL_SECONDS,
} from "@/lib/payment-result-grant-cookie";
import { getServiceRoleKey } from "@/lib/supabase/env";

export {
  PAYMENT_RESULT_GRANT_COOKIE,
  PAYMENT_RESULT_GRANT_TTL_SECONDS,
} from "@/lib/payment-result-grant-cookie";

export type PaymentResultGrantProvider = "inicis" | "paypal";

type PaymentResultGrantPayload = {
  version: 1;
  purpose: "submission-payment-result";
  provider: PaymentResultGrantProvider;
  submissionId: string;
  orderId: string;
  guestToken: string;
  issuedAt: number;
  expiresAt: number;
};

const tokenVersion = "v1";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getEncryptionKey = () => {
  let secret = (process.env.PAYMENT_RESULT_GRANT_SECRET ?? "").trim();
  if (!secret) {
    try {
      secret = getServiceRoleKey();
    } catch {
      secret = (process.env.SUPABASE_JWT_SECRET ?? "").trim();
    }
  }
  if (secret.length < 32) return null;
  return createHash("sha256")
    .update("onside:submission-payment-result-grant:v1\0")
    .update(secret)
    .digest();
};

const isProvider = (value: unknown): value is PaymentResultGrantProvider =>
  value === "inicis" || value === "paypal";

const isPayload = (value: unknown): value is PaymentResultGrantPayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<PaymentResultGrantPayload>;
  return (
    payload.version === 1 &&
    payload.purpose === "submission-payment-result" &&
    isProvider(payload.provider) &&
    typeof payload.submissionId === "string" &&
    uuidPattern.test(payload.submissionId) &&
    typeof payload.orderId === "string" &&
    payload.orderId.length > 0 &&
    payload.orderId.length <= 200 &&
    typeof payload.guestToken === "string" &&
    payload.guestToken.length >= 8 &&
    payload.guestToken.length <= 120 &&
    Number.isSafeInteger(payload.issuedAt) &&
    Number.isSafeInteger(payload.expiresAt)
  );
};

export function createPaymentResultGrant({
  provider,
  submissionId,
  orderId,
  guestToken,
  nowMs = Date.now(),
}: {
  provider: PaymentResultGrantProvider;
  submissionId: string;
  orderId: string;
  guestToken: string;
  nowMs?: number;
}) {
  const key = getEncryptionKey();
  const normalizedSubmissionId = submissionId.trim();
  const normalizedOrderId = orderId.trim();
  const normalizedGuestToken = guestToken.trim();
  if (
    !key ||
    !uuidPattern.test(normalizedSubmissionId) ||
    !normalizedOrderId ||
    normalizedOrderId.length > 200 ||
    normalizedGuestToken.length < 8 ||
    normalizedGuestToken.length > 120 ||
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  ) {
    return null;
  }

  const issuedAt = Math.floor(nowMs / 1_000);
  const payload: PaymentResultGrantPayload = {
    version: 1,
    purpose: "submission-payment-result",
    provider,
    submissionId: normalizedSubmissionId,
    orderId: normalizedOrderId,
    guestToken: normalizedGuestToken,
    issuedAt,
    expiresAt: issuedAt + PAYMENT_RESULT_GRANT_TTL_SECONDS,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(tokenVersion, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    tokenVersion,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    authTag.toString("base64url"),
  ].join(".");
}

export function readPaymentResultGrant(
  value: string | null | undefined,
  {
    submissionId,
    provider,
    nowMs = Date.now(),
  }: {
    submissionId: string;
    provider?: PaymentResultGrantProvider;
    nowMs?: number;
  },
) {
  const key = getEncryptionKey();
  if (!key || !value || value.length > 4_096 || !Number.isSafeInteger(nowMs)) {
    return null;
  }
  const [version, ivValue, ciphertextValue, authTagValue, extra] = value.split(".");
  if (
    version !== tokenVersion ||
    !ivValue ||
    !ciphertextValue ||
    !authTagValue ||
    extra
  ) {
    return null;
  }

  try {
    const iv = Buffer.from(ivValue, "base64url");
    const ciphertext = Buffer.from(ciphertextValue, "base64url");
    const authTag = Buffer.from(authTagValue, "base64url");
    if (
      iv.length !== 12 ||
      authTag.length !== 16 ||
      ciphertext.length === 0 ||
      iv.toString("base64url") !== ivValue ||
      ciphertext.toString("base64url") !== ciphertextValue ||
      authTag.toString("base64url") !== authTagValue
    ) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(tokenVersion, "utf8"));
    decipher.setAuthTag(authTag);
    const decoded = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(decoded) as unknown;
    if (!isPayload(payload)) return null;

    const nowSeconds = Math.floor(nowMs / 1_000);
    if (
      payload.submissionId !== submissionId.trim() ||
      (provider && payload.provider !== provider) ||
      payload.issuedAt > nowSeconds + 30 ||
      payload.expiresAt <= nowSeconds ||
      payload.expiresAt - payload.issuedAt !==
        PAYMENT_RESULT_GRANT_TTL_SECONDS
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function setPaymentResultGrantCookie(
  response: NextResponse,
  grant: string,
  options?: { secure?: boolean },
) {
  response.cookies.set(PAYMENT_RESULT_GRANT_COOKIE, grant, {
    httpOnly: true,
    secure: options?.secure ?? process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PAYMENT_RESULT_GRANT_TTL_SECONDS,
    priority: "high",
  });
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export const DESK_PROTOCOL_VERSION = 2;

/** This protocol is only used between the private Mac process and the service.
 * The Supabase secret itself is never placed in a URL, response, or request header.
 */
export function signDeskRequest(secret: string, input: {
  method: string; path: string; timestamp: string; requestId: string; actorId: string; body: Uint8Array;
}) {
  const key = createHmac("sha256", secret).update("onside-review-desk:v2").digest();
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  return createHmac("sha256", key).update([input.method.toUpperCase(), input.path, input.timestamp, input.requestId, input.actorId, bodyHash].join("\n")).digest("hex");
}
export function verifyDeskRequest(request: Request, body: Uint8Array, secret: string, now = Date.now()) {
  const timestamp = request.headers.get("x-onside-desk-time") ?? "";
  const requestId = request.headers.get("x-onside-desk-request") ?? "";
  const actorId = request.headers.get("x-onside-desk-actor") ?? "";
  const signature = request.headers.get("x-onside-desk-signature") ?? "";
  if (!secret || !/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 120_000 || !UUID.test(requestId) || !UUID.test(actorId) || !/^[a-f\d]{64}$/.test(signature)) return null;
  const url = new URL(request.url);
  const expected = signDeskRequest(secret, { method: request.method, path: url.pathname + url.search, timestamp, requestId, actorId, body });
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex")) ? { actorId, requestId } : null;
}
export async function readBoundedDeskBody(request: Request, limit: number) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > limit) throw Object.assign(new Error("파일 또는 입력 데이터가 허용 크기를 초과했습니다."), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw Object.assign(new Error("파일 또는 입력 데이터가 허용 크기를 초과했습니다."), { status: 413 }); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}

export type BoundedJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid" | "too_large" };

export type BoundedBodyResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid" | "too_large" };

export async function readBoundedBodyBytes(
  request: Pick<Request, "body" | "headers">,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  const safeMaxBytes = Math.max(1, Math.trunc(maxBytes));
  const contentLengthValue = request.headers.get("content-length");
  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > safeMaxBytes
    ) {
      return {
        ok: false,
        reason: contentLength > safeMaxBytes ? "too_large" : "invalid",
      };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "invalid" };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > safeMaxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/**
 * Parse a JSON request without trusting Content-Length. The stream is stopped
 * as soon as the configured byte limit is crossed, which also covers chunked
 * requests and forged or omitted Content-Length headers.
 */
export async function readBoundedJsonBody(
  request: Pick<Request, "body" | "headers">,
  maxBytes: number,
): Promise<BoundedJsonResult> {
  const body = await readBoundedBodyBytes(request, maxBytes);
  if (!body.ok) return body;

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(body.bytes)) as unknown,
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

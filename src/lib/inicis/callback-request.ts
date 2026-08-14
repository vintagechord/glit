import { readBoundedBodyBytes } from "@/lib/request-body";

export const INICIS_CALLBACK_MAX_BODY_BYTES = 64 * 1024;
export const INICIS_CALLBACK_MAX_QUERY_BYTES = 16 * 1024;
export const INICIS_CALLBACK_MAX_FIELDS = 128;
export const INICIS_CALLBACK_MAX_KEY_BYTES = 128;
export const INICIS_CALLBACK_MAX_VALUE_BYTES = 8 * 1024;

type CallbackFormResult =
  | { ok: true; form: FormData }
  | { ok: false; reason: "invalid" | "too_large" };

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const hasValidFields = (entries: Iterable<[string, string]>) => {
  let count = 0;
  for (const [key, value] of entries) {
    count += 1;
    if (
      count > INICIS_CALLBACK_MAX_FIELDS ||
      byteLength(key) > INICIS_CALLBACK_MAX_KEY_BYTES ||
      byteLength(value) > INICIS_CALLBACK_MAX_VALUE_BYTES
    ) {
      return false;
    }
  }
  return true;
};

export const validateInicisCallbackQuery = (
  url: string,
): { ok: true; params: URLSearchParams } | { ok: false; reason: "too_large" } => {
  const parsed = new URL(url);
  if (byteLength(parsed.search) > INICIS_CALLBACK_MAX_QUERY_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (!hasValidFields(parsed.searchParams.entries())) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, params: parsed.searchParams };
};

export const readBoundedInicisCallbackForm = async (
  request: Request,
): Promise<CallbackFormResult> => {
  const query = validateInicisCallbackQuery(request.url);
  if (!query.ok) return query;

  const body = await readBoundedBodyBytes(
    request,
    INICIS_CALLBACK_MAX_BODY_BYTES,
  );
  if (!body.ok) return body;

  const contentType = request.headers.get("content-type") ?? "";
  let form: FormData;
  try {
    if (contentType.toLowerCase().includes("multipart/form-data")) {
      const boundedBody = new Uint8Array(body.bytes.byteLength);
      boundedBody.set(body.bytes);
      const boundedRequest = new Request(request.url, {
        method: "POST",
        headers: { "content-type": contentType },
        body: boundedBody.buffer,
      });
      form = await boundedRequest.formData();
    } else {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
      const params = new URLSearchParams(text);
      form = new FormData();
      params.forEach((value, key) => form.append(key, value));
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const stringEntries: Array<[string, string]> = [];
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") {
      return { ok: false, reason: "invalid" };
    }
    stringEntries.push([key, value]);
  }
  if (!hasValidFields(stringEntries)) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, form };
};

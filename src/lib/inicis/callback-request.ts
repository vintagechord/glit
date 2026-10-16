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
): { ok: true; params: URLSearchParams } | { ok: false; reason: "invalid" | "too_large" } => {
  const parsed = new URL(url);
  if (byteLength(parsed.search) > INICIS_CALLBACK_MAX_QUERY_BYTES) {
    return { ok: false, reason: "too_large" };
  }
  if (!hasValidFields(parsed.searchParams.entries())) {
    return { ok: false, reason: "too_large" };
  }
  const keys = Array.from(parsed.searchParams.keys());
  if (new Set(keys).size !== keys.length) return { ok: false, reason: "invalid" };
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
      form = new FormData();
      for (const field of text.split("&")) {
        if (!field) continue;
        const separator = field.indexOf("=");
        const key = separator < 0 ? field : field.slice(0, separator);
        const value = separator < 0 ? "" : field.slice(separator + 1);
        // URLSearchParams replaces malformed UTF-8/percent escapes silently.
        // Authentication tokens must survive decoding without normalization.
        form.append(
          decodeURIComponent(key.replace(/\+/g, " ")),
          decodeURIComponent(value.replace(/\+/g, " ")),
        );
      }
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const stringEntries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" || seen.has(key)) {
      return { ok: false, reason: "invalid" };
    }
    seen.add(key);
    stringEntries.push([key, value]);
  }
  if (!hasValidFields(stringEntries)) {
    return { ok: false, reason: "too_large" };
  }
  return { ok: true, form };
};

/**
 * Onside file downloads through Cloudflare.
 *
 * Backblaze does not charge egress to Cloudflare, so customer files are
 * served by this Worker instead of B2 presigned URLs. The bucket stays
 * private: Onside signs a short-lived link (HMAC over key, expiry, filename
 * and type), this Worker checks it, then fetches the object from the B2 S3
 * API with SigV4 and streams it back as an attachment. Range requests pass
 * through so players and resumable downloads keep working.
 *
 * Secrets (wrangler secret put): B2_S3_ENDPOINT, B2_REGION, B2_BUCKET,
 * B2_KEY_ID, B2_APPLICATION_KEY (read access is enough), FILES_SIGNING_SECRET.
 * Var: ALLOWED_ORIGINS (comma separated, for CORS).
 */

const encoder = new TextEncoder();
const MAX_LINK_SECONDS = 7 * 24 * 60 * 60;
const SIGNATURE_VERSION = "onside-file-v1";

const toBase64Url = (bytes) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64UrlText = (value) => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("bad encoding");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};
const hex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (text) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const hmac = async (key, text) => {
  const imported = await crypto.subtle.importKey("raw", typeof key === "string" ? encoder.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(text));
};

/** The exact bytes Onside signs. Keep in sync with src/lib/file-cdn.ts and the desk. */
export const signedPayload = ({ key, expires, filename, contentType }) =>
  [SIGNATURE_VERSION, key, String(expires), filename, contentType].join("\n");

const sameText = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
};

/** RFC 3986 encoding per path segment, as S3 canonical URIs require. */
export const encodeObjectKey = (key) =>
  key.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");

/** AWS Signature V4 for a path-style GET/HEAD on the B2 S3 API (unsigned payload). */
export async function signB2Request({ method, endpoint, region, bucket, key, accessKeyId, secretAccessKey, now = new Date() }) {
  const origin = new URL(endpoint);
  const path = `/${encodeObjectKey(bucket)}/${encodeObjectKey(key)}`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = "UNSIGNED-PAYLOAD";
  const headers = { host: origin.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  let signingKey = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  for (const part of [region, "s3", "aws4_request"]) signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, stringToSign));
  return {
    url: `${origin.origin}${path}`,
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

const attachmentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
};

const plain = (status, message, extra = {}) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

const corsHeaders = (request, env) => {
  const origin = request.headers.get("origin");
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return origin && allowed.includes(origin)
    ? { "access-control-allow-origin": origin, "access-control-expose-headers": "content-disposition, content-length, content-range, accept-ranges", vary: "origin" }
    : {};
};

export async function handle(request, env, { now = Date.now(), fetchImpl = fetch } = {}) {
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET, HEAD", "access-control-allow-headers": "range", "access-control-max-age": "600" } });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "Method not allowed", { allow: "GET, HEAD, OPTIONS" });
  for (const name of ["B2_S3_ENDPOINT", "B2_REGION", "B2_BUCKET", "B2_KEY_ID", "B2_APPLICATION_KEY", "FILES_SIGNING_SECRET"]) {
    if (!env[name]) return plain(503, "File service is not configured.");
  }
  const url = new URL(request.url);
  if (url.pathname === "/healthz") return plain(200, "ok");
  const match = url.pathname.match(/^\/f\/([A-Za-z0-9_-]{1,2048})$/);
  if (!match) return plain(404, "Not found");

  let key; let filename; let contentType;
  const expires = Number(url.searchParams.get("e"));
  const signature = url.searchParams.get("s") || "";
  try {
    key = fromBase64UrlText(match[1]);
    filename = fromBase64UrlText(url.searchParams.get("n") || "");
    contentType = fromBase64UrlText(url.searchParams.get("t") || "");
  } catch {
    return plain(400, "This download link is malformed.");
  }
  if (!key || key.startsWith("/") || key.includes("\0") || key.split("/").some((part) => part === ".." || part === ".") || !filename || filename.length > 300 || contentType.length > 200 || /[\r\n]/.test(filename + contentType)) {
    return plain(400, "This download link is malformed.");
  }
  if (!Number.isSafeInteger(expires) || expires * 1000 < now || expires * 1000 > now + (MAX_LINK_SECONDS + 60) * 1000) {
    return plain(403, "This download link has expired. Open the file again from Onside.");
  }
  const expected = toBase64Url(await hmac(env.FILES_SIGNING_SECRET, signedPayload({ key, expires, filename, contentType })));
  if (!sameText(expected, signature)) return plain(403, "This download link is not valid.");

  const signed = await signB2Request({
    method: request.method, endpoint: env.B2_S3_ENDPOINT, region: env.B2_REGION, bucket: env.B2_BUCKET, key,
    accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY, now: new Date(now),
  });
  const upstreamHeaders = { ...signed.headers };
  for (const name of ["range", "if-range", "if-none-match", "if-modified-since"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders[name] = value;
  }
  const upstream = await fetchImpl(signed.url, { method: request.method, headers: upstreamHeaders, redirect: "manual" });
  if (upstream.status === 404) return plain(404, "The file was not found. It may have been removed after the storage period.");
  if (upstream.status === 416) return plain(416, "Requested range not satisfiable", { "content-range": upstream.headers.get("content-range") || "" });
  if (upstream.status === 304) return new Response(null, { status: 304, headers: { ...cors, etag: upstream.headers.get("etag") || "" } });
  if (upstream.status !== 200 && upstream.status !== 206) {
    const detail = request.method === "HEAD" ? "" : await upstream.text().catch(() => "");
    console.log(JSON.stringify({ event: "b2_error", status: upstream.status, cap: /cap exceeded/i.test(detail) }));
    return /cap exceeded/i.test(detail)
      ? plain(503, "File storage has reached its daily download limit. Please try again later.", { "retry-after": "3600" })
      : plain(502, "The file could not be read from storage. Please try again.");
  }
  const headers = new Headers({
    ...cors,
    "content-type": contentType || upstream.headers.get("content-type") || "application/octet-stream",
    "content-disposition": attachmentDisposition(filename),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "accept-ranges": "bytes",
  });
  for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}

const worker = {
  fetch(request, env) {
    return handle(request, env);
  },
};
export default worker;

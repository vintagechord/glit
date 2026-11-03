import { createHmac } from "node:crypto";

/**
 * Download links through the Onside Cloudflare Worker (services/files-cdn).
 * Backblaze does not charge egress to Cloudflare, so these links avoid the
 * B2 daily download cap that blocked presigned B2 URLs. The Worker checks
 * this HMAC, then reads the private bucket itself.
 *
 * Enabled when FILES_CDN_BASE_URL (https) and FILES_CDN_SIGNING_SECRET
 * (at least 32 characters, same value as the Worker's FILES_SIGNING_SECRET)
 * are set; otherwise callers keep using B2 presigned URLs.
 */
const SIGNATURE_VERSION = "onside-file-v1";
const MAX_LINK_SECONDS = 7 * 24 * 60 * 60;

export function getFileCdnConfig() {
  const base = process.env.FILES_CDN_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = process.env.FILES_CDN_SIGNING_SECRET?.trim() ?? "";
  if (!base || secret.length < 32) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.search || url.hash) return null;
    return { base: url.origin + url.pathname.replace(/\/+$/, ""), secret };
  } catch {
    return null;
  }
}

const base64Url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The exact bytes the Worker verifies (services/files-cdn/src/index.mjs). */
export const fileCdnSignedPayload = (input: { key: string; expires: number; filename: string; contentType: string }) =>
  [SIGNATURE_VERSION, input.key, String(input.expires), input.filename, input.contentType].join("\n");

export function signFileCdnUrl(
  config: { base: string; secret: string },
  input: { objectKey: string; filename: string; contentType?: string | null; expiresInSeconds: number; now?: number },
) {
  const filename = input.filename.replace(/[\r\n]/g, " ").slice(0, 300);
  const contentType = (input.contentType ?? "").replace(/[\r\n]/g, "").slice(0, 200);
  const seconds = Math.min(MAX_LINK_SECONDS, Math.max(60, Math.trunc(input.expiresInSeconds)));
  const expires = Math.floor((input.now ?? Date.now()) / 1000) + seconds;
  const signature = base64Url(
    createHmac("sha256", config.secret)
      .update(fileCdnSignedPayload({ key: input.objectKey, expires, filename, contentType }))
      .digest(),
  );
  const params = new URLSearchParams({ e: String(expires), n: base64Url(filename), t: base64Url(contentType), s: signature });
  return `${config.base}/f/${base64Url(input.objectKey)}?${params.toString()}`;
}

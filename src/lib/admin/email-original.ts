import { EMAIL_OPERATIONS_WITHOUT_KEPT_BODY } from "@/lib/admin/submission-emails";

/**
 * The original of a sent mail, as the administrator opens it from the mail
 * history. The stored body is the message before delivery added the open
 * image and click redirects, so opening it here never counts as the
 * customer's opening or click.
 */

const BASE = '<base target="_blank">';

/** The body as an iframe document. Every link targets a new window, which
 * the iframe's sandbox (no allow-popups) blocks: a guest's result link opened
 * from here would otherwise be recorded as the customer's visit. */
export function originalMailDocument(html: string) {
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${BASE}`);
  return `<!doctype html><html><head><meta charset="utf-8">${BASE}</head><body style="margin:0">${html}</body></html>`;
}

/** Why a mail has no body to show. */
export function missingOriginalReason(operation: string) {
  return EMAIL_OPERATIONS_WITHOUT_KEPT_BODY.has(operation)
    ? "로그인·인증 링크가 담긴 메일이라 보안을 위해 발송 후 원문을 보관하지 않습니다."
    : "원문 보관을 시작하기 전에 발송된 메일이라 본문이 남아 있지 않습니다.";
}

export type OriginalMailAttachment = { filename: string; bytes: number | null };

/** File names and sizes of the result files attached to the mail. */
export function originalMailAttachments(refs: unknown): OriginalMailAttachment[] {
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((ref) => {
    if (!ref || typeof ref !== "object") return [];
    const { filename, bytes } = ref as { filename?: unknown; bytes?: unknown };
    if (typeof filename !== "string" || !filename.trim()) return [];
    return [{ filename, bytes: typeof bytes === "number" && Number.isFinite(bytes) ? bytes : null }];
  });
}

export const formatAttachmentSize = (bytes: number | null) =>
  bytes === null ? "" : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

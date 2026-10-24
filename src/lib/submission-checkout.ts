import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  addGuestSubmissionCartEntries,
  SUBMISSION_CART_UPDATED_EVENT,
  SUBMISSION_ORDERS_UPDATED_EVENT,
} from "@/lib/guest-submission-cart";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const checkoutLimit = 100;

/** Invalid query entries are ignored, but an oversized set must never become
 * a partial order merely because its first hundred identifiers are valid. */
export function parseCheckoutSubmissionIds(value: string | null): string[] {
  if (!value || value.length > 8192) return [];
  const ids = [...new Set(value.split(",").map(id => id.trim().toLowerCase()).filter(id => uuidPattern.test(id)))];
  return ids.length <= checkoutLimit ? ids : [];
}

export function buildSubmissionCheckoutHref(ids: string[], localePrefix: "" | "/en" = ""): string {
  const normalized = parseCheckoutSubmissionIds(ids.join(","));
  if (!normalized.length) throw new Error("결제할 신청서를 확인해주세요.");
  const prefix = localePrefix === "/en" ? "/en" : "";
  return `${prefix}/mypage/cart?step=payment&items=${encodeURIComponent(normalized.join(","))}`;
}

export async function prepareOrderCheckout({ orderId, guestTokensBySubmissionId, localePrefix = "" }: {
  orderId: string;
  guestTokensBySubmissionId: Record<string, string>;
  localePrefix?: "" | "/en";
}): Promise<{ href: string; submissionIds: string[] }> {
  const proofs = Object.entries(guestTokensBySubmissionId);
  if (!uuidPattern.test(orderId) || proofs.length > checkoutLimit || proofs.some(([id, token]) =>
    !uuidPattern.test(id) || typeof token !== "string" || token.length < 8 || token.length > 120 || token !== token.trim() || /[\u0000-\u001f\u007f]/.test(token))) {
    throw new Error("주문과 비회원 조회 정보를 확인해주세요. 주문내역에서 다시 진행해주세요.");
  }
  const normalizedProofs = Object.fromEntries(proofs.map(([id, token]) => [id.toLowerCase(), token]));
  if (Object.keys(normalizedProofs).length !== proofs.length) {
    throw new Error("중복된 비회원 조회 정보를 확인해주세요. 주문내역에서 다시 진행해주세요.");
  }
  let response: Response;
  let payload: { ok?: unknown; submissionIds?: unknown };
  try {
    // This explicit action closes only a returnable, unapproved order. The
    // existing server RPC retains ownership, snapshot and uncertain-PG locks.
    response = await fetchWithTimeout("/api/orders/return", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, guestTokensBySubmissionId: normalizedProofs }),
    });
    const body: unknown = await response.json().catch(() => ({}));
    payload = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    // The response can be lost after the order changed. Never repeat a
    // financial preparation request automatically or guess it was cancelled.
    throw new Error("결제 준비 응답을 확인하지 못했습니다. 주문내역을 새로고침한 뒤 다시 확인해주세요.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("주문 소유권을 확인할 수 없습니다. 로그인하거나 비회원 조회 정보를 확인해주세요.");
    if (response.status === 409) throw new Error("결제 상태가 바뀌었거나 승인 확인 중입니다. 주문내역을 새로고침해 확인해주세요.");
    if (response.status === 429) throw new Error("결제 요청이 많습니다. 잠시 후 다시 시도해주세요.");
    throw new Error("결제 준비를 완료하지 못했습니다. 주문내역을 새로고침한 뒤 다시 시도해주세요.");
  }
  const ids = payload.submissionIds;
  if (payload.ok !== true || !Array.isArray(ids) || !ids.length || ids.length > checkoutLimit || ids.some(id => typeof id !== "string" || !uuidPattern.test(id))) {
    throw new Error("변경된 주문 정보를 확인하지 못했습니다. 주문내역을 새로고침해주세요.");
  }
  const submissionIds = [...new Set((ids as string[]).map(id => id.toLowerCase()))];
  const entries = submissionIds.flatMap(submissionId => normalizedProofs[submissionId]
    ? [{ submissionId, guestToken: normalizedProofs[submissionId] }] : []);
  if (proofs.length) {
    if (entries.length !== submissionIds.length || !addGuestSubmissionCartEntries(entries)) {
      throw new Error("비회원 결제 정보를 이 브라우저에 저장하지 못했습니다. 조회 코드를 보관하고 브라우저 저장을 허용한 뒤 다시 확인해주세요.");
    }
    // addGuestSubmissionCartEntries already publishes both update events.
  } else if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SUBMISSION_CART_UPDATED_EVENT));
    window.dispatchEvent(new Event(SUBMISSION_ORDERS_UPDATED_EVENT));
  }
  return { href: buildSubmissionCheckoutHref(submissionIds, localePrefix), submissionIds };
}

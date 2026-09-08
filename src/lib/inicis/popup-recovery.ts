const localeKey = (submissionId: string) => `onside:payment-locale:${submissionId}`;

export const rememberPaymentReturnLocale = (submissionId: string, locale?: "ko" | "en") => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(localeKey(submissionId), locale ?? (window.location.pathname.startsWith("/en/") ? "en" : "ko"));
  } catch {
    // Browser storage restrictions must not prevent checkout.
  }
};

export const submissionOrderReturnHref = (submissionId: string) => {
  let prefix = "";
  if (typeof window !== "undefined") {
    try {
      if (window.sessionStorage.getItem(localeKey(submissionId)) === "en") prefix = "/en";
    } catch {
      if (window.location.pathname.startsWith("/en/")) prefix = "/en";
    }
  }
  return `${prefix}/mypage/orders?focus=${encodeURIComponent(submissionId)}`;
};

/** Use only the authenticated close URL returned for this exact order. Fetch
 * does not execute its bridge HTML. Failed cleanup leaves the order visible
 * for reconciliation instead of claiming the payment was cancelled. */
export async function cancelUnopenedInicisOrder(init: { orderId: string; closeUrl?: string; stdParams?: Record<string, string> }): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(init.closeUrl ?? init.stdParams?.closeUrl ?? "", window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== "/api/inicis/close" || url.searchParams.get("oid") !== init.orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(url.searchParams.get("state") ?? "")) return false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url.toString(), { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
      return response.ok && response.headers.get("X-Inicis-Cancellation-Persisted") === "true";
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

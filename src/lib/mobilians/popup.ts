import { type InicisPaymentContext } from "@/lib/inicis/context";

type OpenPopupOptions = {
  context: InicisPaymentContext;
  submissionId?: string;
  guestToken?: string;
  orderId?: string;
  requestId?: string;
  popupName?: string;
  preferRedirectOnMobile?: boolean;
};

const isMobileUa = (ua: string) =>
  /iphone|ipad|ipod|android|windows phone|mobile/i.test(ua);

export const openMobiliansCardPopup = (options: OpenPopupOptions) => {
  if (typeof window === "undefined") {
    return { ok: false, error: "window is not available" };
  }

  const {
    context,
    submissionId,
    guestToken,
    orderId,
    requestId,
    popupName = "MOBILIANS_PAY",
    preferRedirectOnMobile = true,
  } = options;

  const params = new URLSearchParams({ mode: "card", context });
  if (submissionId) params.set("submissionId", submissionId);
  if (guestToken) params.set("guestToken", guestToken);
  if (orderId) params.set("orderId", orderId);
  if (requestId) params.set("requestId", requestId);

  const url = `/pay/mobilians/popup?${params.toString()}`;

  if (preferRedirectOnMobile && isMobileUa(window.navigator.userAgent || "")) {
    window.location.assign(url);
    return { ok: true, popup: null, redirected: true };
  }

  const availW = Math.max(window.screen.availWidth || 0, window.innerWidth || 0);
  const availH = Math.max(window.screen.availHeight || 0, window.innerHeight || 0);
  const width = Math.round(Math.min(Math.max(availW * 0.92, 980), 1120));
  const height = Math.round(Math.min(Math.max(availH * 0.92, 720), 880));
  const screenX =
    typeof window.screenX === "number" ? window.screenX : window.screenLeft ?? 0;
  const screenY =
    typeof window.screenY === "number" ? window.screenY : window.screenTop ?? 0;
  const left = screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = screenY + Math.max(0, (window.outerHeight - height) / 2);
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    "resizable=yes",
    "scrollbars=yes",
    "status=no",
    "toolbar=no",
    "menubar=no",
    "location=no",
  ].join(",");

  const popup = window.open(url, popupName, features);
  if (!popup) {
    return {
      ok: false,
      error: "팝업이 차단되었습니다. 팝업 차단을 해제한 후 다시 시도해주세요.",
    };
  }

  try {
    popup.resizeTo(width, height);
    popup.moveTo(Math.max(0, Math.round(left)), Math.max(0, Math.round(top)));
  } catch {
    // 일부 브라우저에서는 move/resize가 막힐 수 있으므로 무시
  }

  popup.focus();
  return { ok: true, popup };
};


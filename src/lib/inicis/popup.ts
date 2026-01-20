import { type InicisPaymentContext } from "@/lib/inicis/context";

export type InicisPopupContext = InicisPaymentContext;

type OpenPopupOptions = {
  context: InicisPopupContext;
  submissionId?: string;
  guestToken?: string;
  orderId?: string;
  popupName?: string;
};

export const openInicisCardPopup = (options: OpenPopupOptions) => {
  if (typeof window === "undefined") {
    return { ok: false, error: "window is not available" };
  }

  const { context, submissionId, guestToken, orderId, popupName = "INICIS_STD_PAY" } = options;

  const params = new URLSearchParams({ mode: "card", context });
  if (submissionId) params.set("submissionId", submissionId);
  if (guestToken) params.set("guestToken", guestToken);
  if (orderId) params.set("orderId", orderId);

  const url = `/pay/inicis/popup?${params.toString()}`;

  const availW = Math.max(window.screen.availWidth || 0, window.innerWidth || 0);
  const availH = Math.max(window.screen.availHeight || 0, window.innerHeight || 0);
  const width = Math.round(Math.min(Math.max(availW * 0.92, 1100), 1200));
  const height = Math.round(Math.min(Math.max(availH * 0.92, 760), 900));
  const screenX = typeof window.screenX === "number" ? window.screenX : window.screenLeft ?? 0;
  const screenY = typeof window.screenY === "number" ? window.screenY : window.screenTop ?? 0;
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

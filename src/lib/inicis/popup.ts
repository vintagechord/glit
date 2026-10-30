import { getInicisMobileBrowser, INICIS_MOBILE_UNAVAILABLE_MESSAGE } from "@/lib/inicis/device";
import { type InicisPaymentContext } from "@/lib/inicis/context";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  type InicisPopupHandoffPayload,
} from "@/lib/inicis/popup-handoff";
import { rememberGuestSubmissionOrderEntries } from "@/lib/guest-submission-cart";
import { cancelUnopenedInicisOrder, rememberPaymentReturnLocale } from "@/lib/inicis/popup-recovery";

export type InicisPopupContext = InicisPaymentContext;

type StdPayInit = {
  ok?: boolean;
  orderId: string;
  channel?: "pc" | "mobile";
  stdParams?: Record<string, string>;
  stdJsUrl?: string;
  mobile?: { actionUrl: string; params: Record<string, string> };
  amount?: number;
  returnUrl?: string;
  closeUrl?: string;
  error?: string;
};

type OpenPopupOptions = InicisPopupHandoffPayload & {
  popupName?: string;
};

type OpenPopupResult = {
  ok: boolean;
  error?: string;
  orderId?: string;
  redirected?: boolean;
};

declare global {
  interface Window {
    INIStdPay?: {
      pay: (formId: string) => void;
      close?: () => void;
      destroy?: () => void;
    };
  }
}

const FORM_ID = "SendPayForm";
const SCRIPT_TIMEOUT_MS = 7000;
const inicisLayerPattern =
  /inicis|inipay|inistdpay|inipaystd|stdpay|ini_std|iniwebstd/i;

const isLikelyPaymentElement = (element: Element) => {
  const attrText = [
    element.id,
    element.getAttribute("name"),
    element.getAttribute("class"),
    element.getAttribute("src"),
  ]
    .filter(Boolean)
    .join(" ");
  return inicisLayerPattern.test(attrText);
};

const isLikelyFullscreenLayer = (element: Element) => {
  if (typeof window === "undefined") return false;
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const zIndex = Number.parseInt(style.zIndex || "0", 10);
  const coversViewport =
    rect.width >= window.innerWidth * 0.7 &&
    rect.height >= window.innerHeight * 0.7;
  return (
    (style.position === "fixed" || style.position === "absolute") &&
    coversViewport &&
    (Number.isFinite(zIndex) ? zIndex >= 100 : true)
  );
};

const removeElement = (element: Element | null | undefined) => {
  if (!element || element === document.documentElement || element === document.body) {
    return;
  }
  try {
    element.remove();
  } catch {
    element.parentNode?.removeChild(element);
  }
};

const removePaymentElementWithShell = (element: Element) => {
  let target: Element = element;
  let current: Element | null = element;

  for (let depth = 0; depth < 4; depth += 1) {
    const parentElement: HTMLElement | null = current?.parentElement ?? null;
    if (
      !parentElement ||
      parentElement === document.body ||
      parentElement === document.documentElement
    ) {
      break;
    }
    if (
      isLikelyPaymentElement(parentElement) ||
      isLikelyFullscreenLayer(parentElement)
    ) {
      target = parentElement;
      current = parentElement;
      continue;
    }
    break;
  }

  removeElement(target);
};

export const cleanupInicisPaymentLayer = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  try {
    window.INIStdPay?.close?.();
  } catch {
    // The SDK does not guarantee a close method.
  }
  try {
    window.INIStdPay?.destroy?.();
  } catch {
    // The SDK does not guarantee a destroy method.
  }

  const selectors = [
    `#${FORM_ID}`,
    "iframe[src*='inicis']",
    "iframe[src*='/api/inicis/close']",
    "iframe[src*='/pay/inicis/return']",
    "iframe[id*='inicis' i]",
    "iframe[name*='inicis' i]",
    "iframe[class*='inicis' i]",
    "iframe[id*='INI' i]",
    "iframe[name*='INI' i]",
    "iframe[class*='INI' i]",
    "div[id*='inicis' i]",
    "div[class*='inicis' i]",
    "div[id*='INIpay' i]",
    "div[class*='INIpay' i]",
    "div[id*='stdpay' i]",
    "div[class*='stdpay' i]",
    "form[id*='inicis' i]",
    "form[id*='INI' i]",
    "form[name*='inicis' i]",
    "form[name*='INI' i]",
  ];

  for (const selector of selectors) {
    try {
      document
        .querySelectorAll(selector)
        .forEach((element) => removePaymentElementWithShell(element));
    } catch {
      // Ignore unsupported selector variants in older browsers.
    }
  }

  document.querySelectorAll("iframe, div, form").forEach((element) => {
    if (!isLikelyPaymentElement(element)) return;
    removePaymentElementWithShell(element);
  });

  document.documentElement.style.removeProperty("overflow");
  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("position");
};

const MOBILE_FORM_ID = "SendMobilePayForm";

const fetchStdPayInit = async (
  options: OpenPopupOptions,
  channel: "pc" | "mobile" = "pc",
): Promise<StdPayInit> => {
  let response: Response;

  if (options.context === "test1000") {
    response = await fetchWithTimeout("/api/inicis/test-100", { method: "POST" });
  } else if (options.context === "karaoke") {
    if (!options.requestId) {
      throw new Error("결제 요청 ID가 필요합니다.");
    }
    response = await fetchWithTimeout("/api/inicis/karaoke/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: options.requestId,
        context: options.context,
      }),
    });
  } else {
    if (!options.submissionId) {
      throw new Error("접수 ID가 필요합니다.");
    }
    response = await fetchWithTimeout("/api/inicis/submission/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId: options.submissionId,
        submissionIds: options.submissionIds,
        guestToken: options.guestToken,
        guestTokensBySubmissionId: options.guestTokensBySubmissionId,
        context: options.context,
        channel,
        locale: window.location.pathname.startsWith("/en/") || window.location.pathname === "/en" ? "en" : "ko",
      }),
    });
  }

  const raw = await response.text();
  const json = raw ? ((JSON.parse(raw) as StdPayInit) || null) : null;

  if (!response.ok || !json || json.error) {
    throw new Error(json?.error ?? `결제 초기화 실패 (status ${response.status})`);
  }
  if (channel === "mobile") {
    if (!json.mobile?.actionUrl || !json.mobile.params) {
      throw new Error("모바일 결제 초기화 정보가 올바르지 않습니다.");
    }
    return json;
  }
  if (!json.stdJsUrl || !json.stdParams) {
    throw new Error("결제 모듈 초기화 정보가 올바르지 않습니다.");
  }

  return json;
};

/** INIpayMobile is a top-level navigation (never an iframe or popup). The
 * gateway documents an EUC-KR request form and returns to P_NEXT_URL. */
export const submitInicisMobileForm = (request: { actionUrl: string; params: Record<string, string> }) => {
  if (!/^https:\/\/(?:stg)?mobile\.inicis\.com\/smart\/payment\/$/.test(request.actionUrl)) {
    throw new Error("모바일 결제 요청 주소가 유효하지 않습니다.");
  }
  document.getElementById(MOBILE_FORM_ID)?.remove();
  const form = document.createElement("form");
  form.id = MOBILE_FORM_ID;
  form.method = "post";
  form.action = request.actionUrl;
  form.acceptCharset = "EUC-KR";
  form.target = "_self";
  form.style.display = "none";
  Object.entries(request.params).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
};

export const ensureStdPayScript = async (src: string) =>
  await new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("window is not available"));
      return;
    }
    if (window.INIStdPay?.pay) {
      resolve();
      return;
    }

    let settled = false;
    let script = document.querySelector(
      `script[src="${src}"]`,
    ) as HTMLScriptElement | null;

    const cleanup = () => {
      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
      window.clearTimeout(timeoutId);
    };

    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok && window.INIStdPay?.pay) {
        resolve();
        return;
      }
      // A failed script must be replaced on retry; its load/error event will not fire again.
      script?.remove();
      reject(new Error("결제 모듈 로딩에 실패했습니다. 잠시 후 다시 시도해주세요."));
    };

    const handleLoad = () => done(true);
    const handleError = () => done(false);
    const timeoutId = window.setTimeout(() => done(false), SCRIPT_TIMEOUT_MS);

    if (!script) {
      script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.type = "text/javascript";
      script.addEventListener("load", handleLoad);
      script.addEventListener("error", handleError);
      document.body.appendChild(script);
      return;
    }

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
  });

const mountStdPayForm = (stdParams: Record<string, string>) => {
  const existing = document.getElementById(FORM_ID);
  existing?.remove();

  const form = document.createElement("form");
  form.id = FORM_ID;
  form.method = "post";
  form.acceptCharset = "UTF-8";
  form.style.display = "none";

  Object.entries(stdParams).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  return FORM_ID;
};

export const openInicisCardPopup = async (
  options: OpenPopupOptions,
): Promise<OpenPopupResult> => {
  if (typeof window === "undefined") {
    return { ok: false, error: "window is not available" };
  }

  const isSubmission = options.context !== "karaoke" && options.context !== "test1000";
  const isMobile = getInicisMobileBrowser();
  // INIStdPay is the PC protocol. Submission checkouts on mobile use the
  // INIpayMobile top-level flow; other contexts have no mobile flow yet.
  if (isMobile && !isSubmission) {
    return { ok: false, error: INICIS_MOBILE_UNAVAILABLE_MESSAGE };
  }
  if (isSubmission && options.submissionId) {
    rememberPaymentReturnLocale(options.submissionId);
    rememberGuestSubmissionOrderEntries(Object.entries({
      ...(options.guestToken ? { [options.submissionId]: options.guestToken } : {}),
      ...options.guestTokensBySubmissionId,
    }).map(([submissionId, guestToken]) => ({ submissionId, guestToken })));
  }

  let initData: StdPayInit | null = null;
  try {
    cleanupInicisPaymentLayer();
    if (isMobile) {
      initData = await fetchStdPayInit(options, "mobile");
      submitInicisMobileForm(initData.mobile!);
      return { ok: true, orderId: initData.orderId, redirected: true };
    }
    initData = await fetchStdPayInit(options);
    await ensureStdPayScript(initData.stdJsUrl!);
    const formId = mountStdPayForm(initData.stdParams!);
    window.INIStdPay?.pay(formId);
    return { ok: true, orderId: initData.orderId };
  } catch (error) {
    if (initData && isSubmission) await cancelUnopenedInicisOrder(initData);
    console.error("[Inicis][STDPay][direct-open-error]", error);
    return {
      ok: false,
      ...(initData ? { orderId: initData.orderId } : {}),
      error:
        error instanceof Error && error.message
          ? error.message
          : "결제 모듈을 실행하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
};

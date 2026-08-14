import { type InicisPaymentContext } from "@/lib/inicis/context";
import {
  createInicisPopupHandoff,
  type InicisPopupHandoffPayload,
} from "@/lib/inicis/popup-handoff";

export type InicisPopupContext = InicisPaymentContext;

type StdPayInit = {
  ok?: boolean;
  orderId: string;
  stdParams: Record<string, string>;
  stdJsUrl: string;
  amount?: number;
  returnUrl?: string;
  closeUrl?: string;
  error?: string;
};

type OpenPopupOptions = InicisPopupHandoffPayload & {
  popupName?: string;
  preferRedirectOnMobile?: boolean;
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

const isMobileUa = (ua: string) =>
  /iphone|ipad|ipod|android|windows phone|mobile/i.test(ua);

const buildPopupUrl = (options: OpenPopupOptions) => {
  const handoff = createInicisPopupHandoff({
    context: options.context,
    submissionId: options.submissionId,
    submissionIds: options.submissionIds,
    guestToken: options.guestToken,
    guestTokensBySubmissionId: options.guestTokensBySubmissionId,
    orderId: options.orderId,
    requestId: options.requestId,
  });
  return `/pay/inicis/popup?handoff=${encodeURIComponent(handoff)}`;
};

const fetchStdPayInit = async (
  options: OpenPopupOptions,
): Promise<StdPayInit> => {
  let response: Response;

  if (options.context === "test1000") {
    response = await fetch("/api/inicis/test-100", { method: "POST" });
  } else if (options.context === "karaoke") {
    if (!options.requestId) {
      throw new Error("결제 요청 ID가 필요합니다.");
    }
    response = await fetch("/api/inicis/karaoke/order", {
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
    response = await fetch("/api/inicis/submission/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId: options.submissionId,
        submissionIds: options.submissionIds,
        guestToken: options.guestToken,
        guestTokensBySubmissionId: options.guestTokensBySubmissionId,
        context: options.context,
      }),
    });
  }

  const raw = await response.text();
  const json = raw ? ((JSON.parse(raw) as StdPayInit) || null) : null;

  if (!response.ok || !json || json.error) {
    throw new Error(json?.error ?? `결제 초기화 실패 (status ${response.status})`);
  }
  if (!json.stdJsUrl || !json.stdParams) {
    throw new Error("결제 모듈 초기화 정보가 올바르지 않습니다.");
  }

  return json;
};

const ensureStdPayScript = async (src: string) =>
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

  const { preferRedirectOnMobile = true } = options;
  if (preferRedirectOnMobile && isMobileUa(window.navigator.userAgent || "")) {
    try {
      window.location.assign(buildPopupUrl(options));
      return { ok: true, redirected: true };
    } catch {
      return {
        ok: false,
        error: "모바일 결제 정보를 안전하게 전달하지 못했습니다. 다시 시도해주세요.",
      };
    }
  }

  try {
    cleanupInicisPaymentLayer();
    const initData = await fetchStdPayInit(options);
    await ensureStdPayScript(initData.stdJsUrl);
    const formId = mountStdPayForm(initData.stdParams);
    window.INIStdPay?.pay(formId);
    return { ok: true, orderId: initData.orderId };
  } catch (error) {
    console.error("[Inicis][STDPay][direct-open-error]", error);
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : "결제 모듈을 실행하지 못했습니다. 잠시 후 다시 시도해주세요.",
    };
  }
};

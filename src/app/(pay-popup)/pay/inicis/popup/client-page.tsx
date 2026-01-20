"use client";

import React from "react";
import { useSearchParams } from "next/navigation";

import { parseInicisContext, type InicisPaymentContext } from "@/lib/inicis/context";

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

declare global {
  interface Window {
    INIStdPay?: { pay: (formId: string) => void };
  }
}

const FORM_ID = "SendPayForm";

const useStdPayScript = (src: string | null, onReady: () => void, onError: (message: string) => void) => {
  React.useEffect(() => {
    if (!src) return;
    let cancelled = false;

    const ensureScript = async () =>
      await new Promise<boolean>((resolve) => {
        if (typeof window === "undefined") return resolve(false);
        if (window.INIStdPay?.pay) return resolve(true);

        let script = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;

        const done = (ok: boolean) => {
          script?.removeEventListener("load", handleLoad);
          script?.removeEventListener("error", handleError);
          resolve(ok);
        };

        const handleLoad = () => {
          const ok = Boolean(window.INIStdPay?.pay);
          done(ok);
        };

        const handleError = () => done(false);

        if (!script) {
          script = document.createElement("script");
          script.src = src;
          script.async = true;
          script.type = "text/javascript";
          script.addEventListener("load", handleLoad);
          script.addEventListener("error", handleError);
          document.body.appendChild(script);
        } else {
          if (window.INIStdPay?.pay) return done(true);
          script.addEventListener("load", handleLoad);
          script.addEventListener("error", handleError);
        }
      });

    void (async () => {
      const ok = await ensureScript();
      if (cancelled) return;
      if (!ok) {
        onError("결제 모듈 로딩에 실패했습니다. 팝업 허용 후 다시 시도해주세요.");
        return;
      }
      onReady();
    })();

    return () => {
      cancelled = true;
    };
  }, [src, onError, onReady]);
};

const usePopupChromeStyles = () => {
  React.useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRootStyle = root.getAttribute("style");
    const prevBodyStyle = body.getAttribute("style");

    root.setAttribute(
      "style",
      `${prevRootStyle ? `${prevRootStyle};` : ""}width:100%;height:100%;margin:0;padding:0;overflow:auto;background:#fff;`,
    );
    body.setAttribute(
      "style",
      `${prevBodyStyle ? `${prevBodyStyle};` : ""}width:100%;height:100%;margin:0;padding:0;overflow:auto;background:#fff;`,
    );

    return () => {
      if (prevRootStyle) root.setAttribute("style", prevRootStyle);
      else root.removeAttribute("style");
      if (prevBodyStyle) body.setAttribute("style", prevBodyStyle);
      else body.removeAttribute("style");
    };
  }, []);
};

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default function InicisPopupClientPage({ searchParams }: Props) {
  usePopupChromeStyles();

  const runtimeSearchParams = useSearchParams();
  const ctxValue = runtimeSearchParams.get("context") ?? (Array.isArray(searchParams.context) ? searchParams.context[0] : searchParams.context);
  const modeValue = runtimeSearchParams.get("mode") ?? (Array.isArray(searchParams.mode) ? searchParams.mode[0] : searchParams.mode);
  const submissionId = runtimeSearchParams.get("submissionId") ?? (Array.isArray(searchParams.submissionId) ? searchParams.submissionId[0] : searchParams.submissionId);
  const guestToken = runtimeSearchParams.get("guestToken") ?? (Array.isArray(searchParams.guestToken) ? searchParams.guestToken[0] : searchParams.guestToken);
  const debug = runtimeSearchParams.get("debug") === "1";

  const context: InicisPaymentContext | null = parseInicisContext(ctxValue);

  const [initData, setInitData] = React.useState<StdPayInit | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadingBarVisible, setLoadingBarVisible] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const triggerPay = React.useCallback(() => {
    if (!initData) return;
    const form = document.getElementById(FORM_ID) as HTMLFormElement | null;
    if (!form) {
      setError("결제 폼을 찾을 수 없습니다.");
      return;
    }
    if (!window.INIStdPay?.pay) {
      setError("결제 모듈 로딩 실패, 다시 시도해주세요.");
      return;
    }

    try {
      window.INIStdPay.pay(FORM_ID);
      setLoadingBarVisible(false);
    } catch (err) {
      console.error("[Inicis][STDPay][popup][pay-error]", err);
      setError("결제 모듈 실행 실패, 다시 시도해주세요.");
    }
  }, [initData]);

  useStdPayScript(initData?.stdJsUrl ?? null, triggerPay, setError);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (!context) {
      const rawParams = Object.fromEntries(runtimeSearchParams.entries());
      console.error("[Inicis][STDPay][popup] invalid context", { ctxValue, rawParams });
      setError("알 수 없는 결제 컨텍스트입니다.");
      setLoading(false);
      setLoadingBarVisible(false);
      return;
    }

    const fetchInit = async () => {
      try {
        let res: Response;
        if (context === "test1000") {
          res = await fetch("/api/inicis/test-100", { method: "POST" });
        } else {
          if (!submissionId) {
            throw new Error("submissionId가 필요합니다.");
          }
          res = await fetch("/api/inicis/submission/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submissionId, guestToken, context }),
          });
        }

        const raw = await res.text();
        const json = raw ? ((JSON.parse(raw) as StdPayInit) || null) : null;

        if (cancelled) return;

        if (!res.ok || !json || json.error) {
          const message = json?.error ?? `초기화 실패 (status ${res.status})`;
          console.error("[Inicis][STDPay][popup][init-error]", {
            status: res.status,
            body: raw,
            context,
            submissionId,
            guestToken: Boolean(guestToken),
          });
          setError(message);
          setLoading(false);
          setLoadingBarVisible(false);
          return;
        }

        setInitData(json);
        setLoading(false);
        window.setTimeout(() => setLoadingBarVisible(false), 1200);
      } catch (err) {
        if (cancelled) return;
        console.error("[Inicis][STDPay][popup][init-error]", err);
        setError("결제 초기화에 실패했습니다. 팝업 허용 후 다시 시도해주세요.");
        setLoading(false);
        setLoadingBarVisible(false);
      }
    };

    void fetchInit();

    return () => {
      cancelled = true;
    };
  }, [context, submissionId, guestToken, runtimeSearchParams, ctxValue]);

  React.useEffect(() => {
    if (error) setLoadingBarVisible(false);
  }, [error]);

  return (
    <div className="min-h-screen w-full bg-white">
      <style jsx global>{`
        html,
        body {
          width: 100% !important;
          height: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: auto !important;
          background: #fff !important;
        }
        *,
        *::before,
        *::after {
          box-sizing: border-box !important;
        }
        #wrapper,
        .wrapper,
        .kgLayer,
        #kg_layer,
        #container,
        #content,
        #body_wrapper,
        #overlay_popup,
        #overlay_popups,
        .popWrap,
        #popWrap,
        #popWrapLogo {
          width: 100% !important;
          max-width: none !important;
          height: 100% !important;
          min-height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        #body_wrapper,
        #content,
        #container {
          overflow: auto !important;
          -webkit-overflow-scrolling: touch;
        }
        #popWrapLogo > *,
        #popWrap > *,
        .popWrap > * {
          margin: 0 auto !important;
          padding: 0 !important;
        }
        #wrapper,
        .wrapper,
        #kg_layer,
        #body_wrapper {
          padding: 0 !important;
        }
        #overlay_popup,
        #overlay_popups,
        .overlay,
        .kgOverlay {
          background: #fff !important;
          height: 100% !important;
        }
      `}</style>

      {loadingBarVisible && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center">
          <div className="mt-0.5 rounded-b-lg bg-black/85 px-4 py-2 text-xs font-medium text-white shadow-md">
            이니시스 결제창을 준비 중입니다...
          </div>
        </div>
      )}

      {error && (
        <div className="p-4">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <p className="font-semibold">결제 준비에 실패했습니다.</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      )}

      {debug ? (
        <div className="p-3 text-[11px] text-muted-foreground">
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2">
            raw searchParams: {JSON.stringify(Object.fromEntries(runtimeSearchParams.entries()), null, 2)}
          </pre>
          <p className="mt-1">context: {context ?? "unknown"} · mode: {modeValue ?? "unknown"}</p>
        </div>
      ) : null}

      <form id={FORM_ID} method="post" className="hidden">
        {initData &&
          Object.entries(initData.stdParams ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} readOnly aria-hidden />
          ))}
        {initData ? (
          <>
            <input
              type="hidden"
              name="returnUrl"
              value={initData.returnUrl ?? initData.stdParams?.returnUrl ?? ""}
              readOnly
              aria-hidden
            />
            <input
              type="hidden"
              name="closeUrl"
              value={initData.closeUrl ?? initData.stdParams?.closeUrl ?? ""}
              readOnly
              aria-hidden
            />
          </>
        ) : null}
      </form>
    </div>
  );
}

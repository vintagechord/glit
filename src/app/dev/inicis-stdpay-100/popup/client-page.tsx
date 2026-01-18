"use client";

import React from "react";

type InitResponse = {
  ok: boolean;
  orderId: string;
  amount: number;
  stdParams: Record<string, string>;
  stdJsUrl: string;
  returnUrl: string;
  closeUrl: string;
  error?: string;
};

declare global {
  interface Window {
    INIStdPay?: { pay: (formId: string) => void };
  }
}

const FORM_ID = "SendPayForm";

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
        onError("결제 모듈 로딩 실패, 다시 시도해주세요.");
        return;
      }
      onReady();
    })();

    return () => {
      cancelled = true;
    };
  }, [src, onError, onReady]);
};

export default function InicisStdPayPopupClientPage() {
  usePopupChromeStyles();

  const [initData, setInitData] = React.useState<InitResponse | null>(null);
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

    void (async () => {
      try {
        const res = await fetch("/api/inicis/test-100", { method: "POST" });
        const json = (await res.json()) as InitResponse;

        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          const message = json?.error ?? `초기화 실패 (status ${res.status})`;
          setError(message);
          setLoadingBarVisible(false);
          setLoading(false);
          return;
        }

        setInitData(json);
        setLoading(false);
        window.setTimeout(() => setLoadingBarVisible(false), 1800);
      } catch (err) {
        if (cancelled) return;
        console.error("[Inicis][STDPay][popup][init-error]", err);
        setError("결제 모듈 로딩 실패, 다시 시도해주세요.");
        setLoadingBarVisible(false);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (error) setLoadingBarVisible(false);
  }, [error]);

  return (
    <div
      className="min-h-screen w-full bg-white text-foreground"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
    >
      {loadingBarVisible && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center">
          <div className="mt-0.5 rounded-b-lg bg-black/85 px-4 py-2 text-xs font-medium text-white shadow-md">
            이니시스 결제창을 준비 중입니다...
          </div>
        </div>
      )}

      <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 py-5">
        <div className="rounded-xl border border-border/60 bg-card/80 px-4 py-3 text-sm text-foreground shadow-sm">
          <div className="flex items-center justify-between">
            <p className="font-semibold">KG 이니시스 STDPay</p>
            {initData?.amount ? <p className="text-xs text-muted-foreground">{initData.amount.toLocaleString()}원</p> : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            팝업에서 스크롤이 가능한지 확인하고, 화면이 잘리지 않는지 확인하세요.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <p className="font-semibold">결제 준비에 실패했습니다.</p>
            <p className="mt-1">결제 모듈 로딩 실패, 다시 시도해주세요.</p>
            <p className="mt-2 text-xs text-red-500">{error}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-4 text-sm text-foreground shadow-sm">
            {loading && <p className="text-muted-foreground">결제 파라미터를 준비 중입니다...</p>}
            {!loading && !initData && <p className="text-muted-foreground">결제 정보를 불러오지 못했습니다.</p>}
            {!loading && initData && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>주문번호: {initData.orderId}</li>
                <li>금액: {initData.amount.toLocaleString()}원</li>
                <li>리턴: {initData.returnUrl}</li>
              </ul>
            )}
          </div>
        )}

        <form id={FORM_ID} method="post" className="hidden">
          {initData &&
            Object.entries(initData.stdParams ?? {}).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} readOnly aria-hidden />
            ))}
          {initData ? (
            <>
              <input type="hidden" name="returnUrl" value={initData.returnUrl} readOnly aria-hidden />
              <input type="hidden" name="closeUrl" value={initData.closeUrl} readOnly aria-hidden />
            </>
          ) : null}
        </form>
      </main>
    </div>
  );
}

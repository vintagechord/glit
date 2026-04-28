/* eslint-disable @next/next/no-sync-scripts */
"use client";

import React from "react";

type StdPayParams = Record<string, string>;
type MobileParams = Record<string, string>;

declare global {
  interface Window {
    INIStdPay?: {
      pay: (formId: string) => void;
    };
  }
}

type Props = {
  stdJsUrl: string;
  stdParams: StdPayParams;
  mobileParams: MobileParams;
  orderId: string;
  amountLabel: string;
};

export function SubscriptionPayButtons({
  stdJsUrl,
  stdParams,
  mobileParams,
  orderId,
  amountLabel,
}: Props) {
  const stdFormId = React.useId().replace(/:/g, "");
  const mobileFormId = React.useId().replace(/:/g, "");
  const [loading, setLoading] = React.useState(false);

  const logStdPayParams = React.useCallback(
    (params: Record<string, string>) => {
      const len = (key: keyof typeof params) => String(params[key] ?? "").length;
      const mask = (value?: string) =>
        value ? `${value.slice(0, 2)}***${value.slice(-2)}` : "";
      console.info("[Inicis][STDPay][params-check]", {
        mid: { masked: mask(params.mid), length: len("mid") },
        oid: { present: Boolean(params.oid), length: len("oid") },
        price: { present: Boolean(params.price), length: len("price") },
        timestamp: { present: Boolean(params.timestamp), length: len("timestamp") },
        returnUrl: { present: Boolean(params.returnUrl), length: len("returnUrl") },
        closeUrl: { present: Boolean(params.closeUrl), length: len("closeUrl") },
        signature: { present: Boolean(params.signature), length: len("signature") },
        mKey: { present: Boolean(params.mKey), length: len("mKey") },
        iniStdPay: Boolean(typeof window !== "undefined" && window.INIStdPay),
        stdJsUrl,
      });
    },
    [stdJsUrl],
  );

  const ensureStdPayReady = React.useCallback(async () => {
    if (typeof window === "undefined") return false;
    if (window.INIStdPay) return true;
    let script = document.querySelector(`script[src="${stdJsUrl}"]`) as
      | HTMLScriptElement
      | null;
    if (!script) {
      script = document.createElement("script");
      script.src = stdJsUrl;
      script.type = "text/javascript";
      script.async = true;
      document.body.appendChild(script);
    }
    return new Promise<boolean>((resolve) => {
      const onReady = () => cleanup(Boolean(window.INIStdPay));
      const onError = () => cleanup(false);
      const cleanup = (value: boolean) => {
        script?.removeEventListener("load", onReady);
        script?.removeEventListener("error", onError);
        window.clearTimeout(timeout);
        window.clearTimeout(poll);
        resolve(value);
      };
      const timeout = window.setTimeout(() => cleanup(Boolean(window.INIStdPay)), 2000);
      const poll = window.setInterval(() => {
        if (window.INIStdPay) {
          cleanup(true);
        }
      }, 200);
      script?.addEventListener("load", onReady);
      script?.addEventListener("error", onError);
    });
  }, [stdJsUrl]);

  const handleStdPay = () => {
    const run = async () => {
      setLoading(true);
      const ready = await ensureStdPayReady();
      logStdPayParams(stdParams);
      if (!ready || !window.INIStdPay) {
        alert("결제 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
        setLoading(false);
        return;
      }
      try {
        window.INIStdPay.pay(stdFormId);
      } finally {
        setLoading(false);
      }
    };
    void run();
  };

  const handleMobilePay = () => {
    const form = document.getElementById(mobileFormId) as HTMLFormElement | null;
    if (!form) {
      alert("모바일 결제 폼을 찾을 수 없습니다.");
      return;
    }
    setLoading(true);
    form.submit();
  };

  return (
    <>
      <script src={stdJsUrl} type="text/javascript" />
      <div className="rounded-[10px] border-2 border-[#111111] bg-card p-4 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            주문번호
          </p>
          <p className="font-mono text-sm text-foreground">{orderId}</p>
          <p className="text-xs font-black uppercase tracking-normal text-muted-foreground">
            결제금액
          </p>
          <p className="text-lg font-black text-foreground">{amountLabel}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleStdPay}
            className="bauhaus-button px-4 py-2 text-xs uppercase disabled:opacity-60"
            disabled={loading}
          >
            PC · 카드 정기결제
          </button>
          <button
            type="button"
            onClick={handleMobilePay}
            className="rounded-[8px] border-2 border-border px-4 py-2 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-[#111111] hover:bg-[#111111] hover:text-white disabled:opacity-60 dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
            disabled={loading}
          >
            모바일 INIBill
          </button>
        </div>
      </div>

      <form
        id={stdFormId}
        method="POST"
        acceptCharset="UTF-8"
        className="hidden"
      >
        {Object.entries(stdParams).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      </form>

      <form
        id={mobileFormId}
        method="POST"
        action="https://inilite.inicis.com/inibill/inibill_card.jsp"
        acceptCharset="UTF-8"
        className="hidden"
      >
        {Object.entries(mobileParams).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
      </form>
    </>
  );
}

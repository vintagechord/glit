"use client";

import React from "react";

import { parseInicisContext, type InicisPaymentContext } from "@/lib/inicis/context";

type MobiliansInit = {
  provider?: "mobilians";
  orderId: string;
  tid: string;
  payUrl: string;
  amount?: number;
  error?: string;
};

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
};

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

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

export default function MobiliansPopupClientPage({ searchParams }: Props) {
  usePopupChromeStyles();

  const ctxValue = firstParam(searchParams.context);
  const submissionId = firstParam(searchParams.submissionId);
  const requestId = firstParam(searchParams.requestId);
  const guestToken = firstParam(searchParams.guestToken);
  const debug = firstParam(searchParams.debug) === "1";

  const context: InicisPaymentContext | null = parseInicisContext(ctxValue);
  const isKaraoke = context === "karaoke";

  const [error, setError] = React.useState<string | null>(null);
  const [payUrl, setPayUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    setPayUrl(null);

    if (!context) {
      setError("알 수 없는 결제 컨텍스트입니다.");
      return;
    }

    const fetchInit = async () => {
      try {
        let res: Response;
        if (isKaraoke) {
          if (!requestId) throw new Error("requestId가 필요합니다.");
          res = await fetch("/api/mobilians/karaoke/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId, context }),
          });
        } else {
          if (!submissionId) throw new Error("submissionId가 필요합니다.");
          res = await fetch("/api/mobilians/submission/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submissionId, guestToken, context }),
          });
        }

        const raw = await res.text();
        const json = raw ? ((JSON.parse(raw) as MobiliansInit) || null) : null;
        if (cancelled) return;

        if (!res.ok || !json || json.error || !json.payUrl) {
          const message = json?.error ?? `초기화 실패 (status ${res.status})`;
          console.error("[Mobilians][popup][init-error]", {
            status: res.status,
            body: raw,
            context,
            submissionId,
            requestId,
          });
          setError(message);
          return;
        }

        setPayUrl(json.payUrl);
        window.location.assign(json.payUrl);
      } catch (initError) {
        if (cancelled) return;
        console.error("[Mobilians][popup][init-error]", initError);
        setError("결제 초기화에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    };

    void fetchInit();

    return () => {
      cancelled = true;
    };
  }, [context, guestToken, isKaraoke, requestId, submissionId]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-10">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">
          Mobilians Payment
        </p>
        <h1 className="mt-3 text-lg font-semibold text-slate-900">
          모빌리언스 결제창을 준비 중입니다.
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          결제창으로 이동하지 않으면 잠시 후 다시 시도해주세요.
        </p>

        {error ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-600">
            <p className="font-semibold">결제 준비에 실패했습니다.</p>
            <p className="mt-1">{error}</p>
          </div>
        ) : null}

        {payUrl ? (
          <a
            href={payUrl}
            className="mt-6 inline-flex rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
          >
            결제창 다시 열기
          </a>
        ) : null}

        {debug ? (
          <pre className="mt-6 whitespace-pre-wrap break-words rounded-md bg-slate-100 p-3 text-left text-[11px] text-slate-600">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(searchParams).map(([key, value]) => [
                  key,
                  firstParam(value),
                ]),
              ),
              null,
              2,
            )}
          </pre>
        ) : null}
      </div>
    </div>
  );
}


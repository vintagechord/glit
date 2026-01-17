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

type InicisResult =
  | { status: "idle" }
  | { status: "init" }
  | { status: "popup"; orderId: string }
  | { status: "success"; orderId: string; message?: string }
  | { status: "fail"; orderId: string; message?: string }
  | { status: "cancel"; orderId: string; message?: string }
  | { status: "error"; message: string };

const POPUP_NAME = "INICIS_STD_PAY_TEST_100";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export default function InicisStdPay100Page() {
  const [result, setResult] = React.useState<InicisResult>({ status: "idle" });
  const [loading, setLoading] = React.useState(false);
  const lastOrderIdRef = React.useRef<string>("");

  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; payload?: Record<string, unknown> };
      if (!data?.type || !data.type.startsWith("INICIS:")) return;

      const orderId = String(data.payload?.orderId ?? "") || lastOrderIdRef.current;

      if (data.type === "INICIS:SUCCESS") {
        lastOrderIdRef.current = orderId;
        setResult({
          status: "success",
          orderId,
          message: String(data.payload?.resultMsg ?? "결제가 완료되었습니다."),
        });
      } else if (data.type === "INICIS:FAIL") {
        lastOrderIdRef.current = orderId;
        setResult({
          status: "fail",
          orderId,
          message: String(data.payload?.resultMsg ?? data.payload?.message ?? "결제에 실패했습니다."),
        });
      } else if (data.type === "INICIS:CANCEL") {
        lastOrderIdRef.current = orderId;
        setResult({
          status: "cancel",
          orderId,
          message: String(data.payload?.message ?? "사용자가 결제를 취소했습니다."),
        });
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const startPayment = async () => {
    if (loading) return;
    setLoading(true);
    setResult({ status: "init" });

    const popup = window.open(
      "",
      POPUP_NAME,
      "width=430,height=750,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes",
    );

    if (!popup) {
      setResult({
        status: "error",
        message: "팝업이 차단되었습니다. 팝업을 허용한 후 다시 시도하세요.",
      });
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/inicis/test-100", { method: "POST" });
      const json = (await res.json()) as InitResponse;

      if (!res.ok || !json.ok) {
        setResult({
          status: "error",
          message: json?.error ?? `초기화 실패 (status ${res.status})`,
        });
        popup.close();
        return;
      }

      const inputs = Object.entries(json.stdParams ?? {})
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`)
        .join("");

      const html = `
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>이니시스 결제 진행</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px;">
    <p>이니시스 결제창을 여는 중입니다...</p>
    <form id="SendPayForm" method="post">
      ${inputs}
      <input type="hidden" name="returnUrl" value="${escapeHtml(json.returnUrl)}" />
      <input type="hidden" name="closeUrl" value="${escapeHtml(json.closeUrl)}" />
    </form>
    <script src="${escapeHtml(json.stdJsUrl)}"></script>
    <script>
      (function() {
        function go() {
          try {
            if (!window.INIStdPay || !window.INIStdPay.pay) {
              return setTimeout(go, 50);
            }
            window.INIStdPay.pay("SendPayForm");
          } catch (e) {
            document.body.insertAdjacentHTML("beforeend", "<pre style='color:red'>" + String(e) + "</pre>");
          }
        }
        go();
      })();
    </script>
  </body>
</html>`;

      popup.document.open();
      popup.document.write(html);
      popup.document.close();

      lastOrderIdRef.current = json.orderId;
      setResult({ status: "popup", orderId: json.orderId });
    } catch (error) {
      console.error("[Inicis][STDPay][test-100][page][error]", error);
      popup.close();
      setResult({
        status: "error",
        message: "결제 창을 여는 중 오류가 발생했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">100원 카드 결제 테스트</h1>
      <p className="text-sm text-muted-foreground">
        이 페이지는 KG 이니시스 STDPay 팝업 플로우를 검증하기 위한 100원 테스트 결제용입니다. 버튼을 누르면 새 팝업에서
        결제창이 열리고, 완료/취소 결과는 이 페이지에 표시됩니다.
      </p>

      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm text-foreground">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">테스트 금액</p>
        <p className="mt-2 text-lg font-semibold text-foreground">100원 (Card)</p>
        <button
          type="button"
          onClick={startPayment}
          disabled={loading}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-foreground/90 disabled:opacity-60"
        >
          {loading ? "준비 중..." : "결제창 열기"}
        </button>

        <div className="mt-4 space-y-1 text-sm text-muted-foreground">
          <p>· 팝업이 차단된 경우 브라우저 설정에서 허용 후 다시 시도하세요.</p>
          <p>· 결제 완료/취소 후 팝업이 닫히고 결과가 아래에 표시됩니다.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/50 p-4 text-sm text-foreground">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">결과</p>
        {result.status === "idle" && <p className="mt-2 text-muted-foreground">아직 결제를 시작하지 않았습니다.</p>}
        {result.status === "init" && <p className="mt-2 text-muted-foreground">파라미터 생성 중...</p>}
        {result.status === "popup" && (
          <p className="mt-2 text-foreground">
            결제창을 열었습니다. 주문번호 <span className="font-mono text-xs">{result.orderId}</span>
          </p>
        )}
        {result.status === "success" && (
          <p className="mt-2 text-emerald-500">
            결제 완료! 주문번호 <span className="font-mono text-xs">{result.orderId}</span>{" "}
            {result.message ? `(${result.message})` : ""}
          </p>
        )}
        {result.status === "fail" && (
          <p className="mt-2 text-red-500">
            결제 실패. 주문번호 <span className="font-mono text-xs">{result.orderId}</span>{" "}
            {result.message ? `(${result.message})` : ""}
          </p>
        )}
        {result.status === "cancel" && (
          <p className="mt-2 text-amber-500">
            사용자가 결제를 취소했습니다. 주문번호 <span className="font-mono text-xs">{result.orderId}</span>{" "}
            {result.message ? `(${result.message})` : ""}
          </p>
        )}
        {result.status === "error" && (
          <p className="mt-2 text-red-500">{result.message ?? "오류가 발생했습니다."}</p>
        )}
      </div>
    </div>
  );
}

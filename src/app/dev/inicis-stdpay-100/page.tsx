"use client";

import React from "react";

type InicisResult =
  | { status: "idle" }
  | { status: "init" }
  | { status: "popup"; orderId?: string }
  | { status: "success"; orderId: string; message?: string }
  | { status: "fail"; orderId: string; message?: string }
  | { status: "cancel"; orderId: string; message?: string }
  | { status: "error"; message: string };

const POPUP_NAME = "INICIS_STD_PAY_TEST_1000";

export default function InicisStdPay1000Page() {
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

    const baseWidth = 520;
    const baseHeight = 900;
    const width = Math.max(520, Math.round(baseWidth));
    const height = Math.max(900, Math.round(baseHeight));
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

    const popup = window.open("/dev/inicis-stdpay-100/popup", POPUP_NAME, features);

    if (!popup) {
      setResult({
        status: "error",
        message: "팝업이 차단되었습니다. 팝업 차단을 해제한 후 다시 시도해주세요.",
      });
      setLoading(false);
      return;
    }

    popup.focus();
    setResult({ status: "popup" });
    setLoading(false);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">1000원 카드 결제 테스트</h1>
      <p className="text-sm text-muted-foreground">
        이 페이지는 KG 이니시스 STDPay 팝업 플로우를 검증하기 위한 1000원 테스트 결제용입니다. 버튼을 누르면 새 팝업에서
        결제창이 열리고, 완료/취소 결과는 이 페이지에 표시됩니다.
      </p>

      <div className="rounded-2xl border border-border/70 bg-card/80 p-4 text-sm text-foreground">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">테스트 금액</p>
        <p className="mt-2 text-lg font-semibold text-foreground">1000원 (Card)</p>
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
            결제창을 열었습니다.{" "}
            {result.orderId ? (
              <>
                주문번호 <span className="font-mono text-xs">{result.orderId}</span>
              </>
            ) : (
              "결제 완료/취소 후 결과가 표시됩니다."
            )}
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

"use client";

import React from "react";

type InitResponse = {
  orderId: string;
  stdParams: Record<string, string>;
  stdJsUrl: string;
  returnUrl: string;
  closeUrl: string;
};

declare global {
  interface Window {
    INIStdPay?: { pay: (formId: string) => void };
  }
}

export default function DevInicisStdPayPage() {
  const [amount, setAmount] = React.useState(100);
  const [productName, setProductName] = React.useState("STDPay Test");
  const [buyerName, setBuyerName] = React.useState("Tester");
  const [buyerEmail, setBuyerEmail] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [initData, setInitData] = React.useState<InitResponse | null>(null);
  const [scriptReady, setScriptReady] = React.useState(false);

  // React 18 useId는 ":"가 포함될 수 있어서 안전하게 제거
  const formId = React.useId().replace(/:/g, "");
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.INIStdPay) {
      setScriptReady(true);
    }
  }, []);

  /**
   * ✅ 중요: script 로드 이벤트를 놓치지 않도록
   * - 이벤트 리스너를 먼저 걸고
   * - 그 다음 DOM에 append
   * - 이미 존재하는 script는 재사용
   */
  const ensureScript = React.useCallback(async (src: string) => {
    if (typeof window === "undefined") return false;
    if (window.INIStdPay) {
      setScriptReady(true);
      return true;
    }

    let script = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;

    return await new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        script?.removeEventListener("load", onLoad);
        script?.removeEventListener("error", onError);
        window.clearTimeout(timeout);
        resolve(ok);
      };

      const onLoad = () => {
        const ok = Boolean(window.INIStdPay);
        console.info("[Dev][STDPay] script loaded", { src, ok });
        if (ok) setScriptReady(true);
        done(ok);
      };

      const onError = (e: Event) => {
        console.error("[Dev][STDPay] script load error", { src, e });
        done(false);
      };

      const timeout = window.setTimeout(() => {
        const ok = Boolean(window.INIStdPay);
        console.warn("[Dev][STDPay] script load timeout", { src, ok });
        done(ok);
      }, 8000);

      // script가 없으면 새로 만들고, 리스너 먼저 → append 나중
      if (!script) {
        script = document.createElement("script");
        script.src = src;
        script.type = "text/javascript";
        script.async = true;

        script.addEventListener("load", onLoad);
        script.addEventListener("error", onError);

        document.body.appendChild(script);
        console.info("[Dev][STDPay] script appended", { src });
        return;
      }

      // 이미 DOM에 있는 script면, 이미 로드 완료됐을 수도 있으니 즉시 체크
      if (window.INIStdPay) return done(true);

      // 아직 로딩 중일 수 있으니 이벤트 대기
      script.addEventListener("load", onLoad);
      script.addEventListener("error", onError);
      console.info("[Dev][STDPay] script reused", { src });
    });
  }, []);

  const handleInit = async () => {
    setLoading(true);
    setInitData(null);
    try {
      const res = await fetch("/api/dev/inicis/stdpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, productName, buyerName, buyerEmail }),
      });

      const raw = await res.text();
      let json: (InitResponse & { error?: string }) | null = null;

      try {
        json = raw ? (JSON.parse(raw) as InitResponse & { error?: string }) : null;
      } catch (parseError) {
        console.error("[Dev][STDPay] init parse error", parseError, { raw });
      }

      if (!res.ok || !json || json.error) {
        console.error("[Dev][STDPay] init failed", { status: res.status, body: raw });
        alert(json?.error ?? `초기화 실패 (status ${res.status})`);
        return;
      }

      setInitData(json);
      void ensureScript(json.stdJsUrl).then((ok) => setScriptReady(ok));

      console.info("[Dev][STDPay] init OK", {
        orderId: json.orderId,
        stdJsUrl: json.stdJsUrl,
        returnUrl: json.returnUrl,
        closeUrl: json.closeUrl,
      });
    } catch (error) {
      console.error("[Dev][STDPay] init error", error);
      alert("초기화 오류");
    } finally {
      setLoading(false);
    }
  };

  const handlePay = () => {
    if (!initData) return;

    console.info("[Dev][STDPay] try pay", { orderId: initData.orderId, stdJsUrl: initData.stdJsUrl });

    if (!scriptReady && typeof window !== "undefined" && window.INIStdPay) {
      setScriptReady(true);
    }

    const form = document.getElementById(formId) as HTMLFormElement | null;
    const requiredKeys = ["mid", "oid", "price", "timestamp", "mKey", "signature", "returnUrl"];
    const missing = requiredKeys.filter((k) => !initData.stdParams[k]);
    console.info("[Dev][STDPay] calling INIStdPay.pay()", {
      formId,
      formExists: Boolean(form),
      iniStdPay: Boolean(typeof window !== "undefined" && window.INIStdPay),
      scriptReady,
      missingParams: missing,
    });
    if (!scriptReady) {
      alert("INIStdPay.js 로딩을 먼저 완료해주세요. (파라미터 생성 후 잠시 대기)");
      return;
    }
    if (!form) {
      alert("결제 폼을 찾을 수 없습니다.");
      return;
    }
    if (missing.length > 0) {
      alert(`필수 파라미터 누락: ${missing.join(", ")}`);
      return;
    }

    // window.INIStdPay.pay(formId) 는 "form id" 문자열을 받음 (INIStdPay.js 내부에서 form 탐색)
    console.info("[Dev][STDPay] invoking pay - Network 탭에서 payMain/pay 요청 발생 여부 확인");
    window.INIStdPay.pay(formId);

    window.setTimeout(() => {
      const iframes = Array.from(
        document.querySelectorAll<HTMLIFrameElement>('iframe[src*="inicis"], iframe[id*="INI"], iframe[name*="INI"]'),
      );
      console.info("[Dev][STDPay] iframe check after pay()", {
        count: iframes.length,
        srcs: iframes.map((f) => f.src),
      });
    }, 300);
  };

  // 프로덕션에서 dev 페이지 숨김
  if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-red-500">이 페이지는 프로덕션에서 비활성화되어 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Dev · Inicis STDPay 테스트</h1>
      <p className="text-sm text-muted-foreground">
        테스트 MID(stg)로 결제창 호출만 검증합니다. DB 기록 없이 파라미터만 생성합니다. 로컬에서는 https 퍼블릭
        URL(ngrok 등)을 NEXT_PUBLIC_SITE_URL에 넣어야 콜백/승인이 정상 동작합니다.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">금액(KRW)</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-foreground"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">상품명</span>
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-foreground"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">구매자명</span>
          <input
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-foreground"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">이메일(선택)</span>
          <input
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-foreground"
          />
        </label>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleInit}
          disabled={loading}
          className="rounded-full bg-foreground px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background disabled:opacity-60"
        >
          {loading ? "생성 중..." : "파라미터 생성"}
        </button>

        {initData ? (
          <button
            type="button"
            onClick={handlePay}
            className="rounded-full border border-border/70 px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            결제창 열기
          </button>
        ) : null}
      </div>

      {initData ? (
        <div className="rounded-2xl border border-border/60 bg-card/80 p-4 text-sm text-foreground">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">생성 결과</p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">orderId: {initData.orderId}</p>
          <p className="font-mono text-xs text-muted-foreground">returnUrl: {initData.returnUrl}</p>
          <p className="font-mono text-xs text-muted-foreground">closeUrl: {initData.closeUrl}</p>
          <p className="font-mono text-xs text-muted-foreground">stdJsUrl: {initData.stdJsUrl}</p>

          <div className="mt-3">
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">stdParams</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-background/60 p-3 text-xs text-foreground">
                {JSON.stringify(initData.stdParams, null, 2)}
              </pre>
            </details>
          </div>

          {/* ✅ 주의: React JSX <script>로 로드하지 말고 ensureScript()로만 로드 */}
          <form id={formId} method="POST" acceptCharset="UTF-8" className="hidden">
            {Object.entries(initData.stdParams).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          </form>
        </div>
      ) : null}
    </div>
  );
}

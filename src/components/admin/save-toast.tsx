"use client";

import * as React from "react";

/**
 * 화면 우상단 토스트로 “저장 완료”를 띄우고 2.5초 뒤 자동 닫힘.
 * 팝업 차단에 영향받지 않도록 window.alert 대신 DOM 렌더링 사용.
 */
export function AdminSaveToast({ message }: { message: string }) {
  const [show, setShow] = React.useState(Boolean(message));

  React.useEffect(() => {
    if (!message) return;
    setShow(true);
    const timer = setTimeout(() => setShow(false), 2500);
    const url = new URL(window.location.href);
    url.searchParams.delete("saved");
    window.history.replaceState({}, "", url.toString());
    return () => clearTimeout(timer);
  }, [message]);

  if (!show || !message) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-end px-4 py-6 pointer-events-none">
      <div className="pointer-events-auto mt-2 w-full max-w-sm overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-2xl backdrop-blur">
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">저장 완료</p>
            <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="h-[3px] bg-emerald-500/60">
          <div className="h-full w-full animate-[toastbar_2.5s_linear] bg-emerald-500" />
        </div>
      </div>

      <style jsx global>{`
        @keyframes toastbar {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
}

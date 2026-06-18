"use client";

import * as React from "react";

/**
 * 저장/반영 완료를 중앙 팝업으로 띄우고 2.5초 뒤 자동 닫힘.
 * 팝업 차단에 영향받지 않도록 window.alert 대신 DOM 렌더링 사용.
 */
export function AdminSaveToast({ message }: { message: string }) {
  const [show, setShow] = React.useState(Boolean(message));

  React.useEffect(() => {
    if (!message) return;
    setShow(true);
    const timer = setTimeout(() => setShow(false), 2500);
    const url = new URL(window.location.href);
    if (url.searchParams.has("saved")) {
      url.searchParams.delete("saved");
      url.searchParams.delete("savedWarning");
      window.history.replaceState({}, "", url.toString());
    }
    return () => clearTimeout(timer);
  }, [message]);

  if (!show || !message) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/35 px-4 py-6">
      <div
        role="status"
        aria-live="polite"
        className="w-full max-w-sm overflow-hidden rounded-[10px] border-2 border-[#111111] bg-background shadow-[8px_8px_0_#111111] dark:border-[#f2cf27] dark:shadow-[8px_8px_0_#f2cf27]"
      >
        <div className="px-5 py-5 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#111111] bg-[#f2cf27] text-lg font-black text-[#111111] dark:border-[#f2cf27]">
            ✓
          </div>
          <p className="mt-4 text-base font-black text-foreground">저장 완료</p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">{message}</p>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#111111] px-5 text-xs font-black text-white transition hover:bg-[#1556a4] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111]"
          >
            확인
          </button>
        </div>
        <div className="h-[4px] bg-border">
          <div className="h-full w-full animate-[adminsavepopup_2.5s_linear] bg-[#f2cf27]" />
        </div>
      </div>

      <style jsx global>{`
        @keyframes adminsavepopup {
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

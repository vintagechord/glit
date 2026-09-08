"use client";

import * as React from "react";

const submissionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reuses the live, owner-authorized Onside result view; no archived result copy. */
export function OnsideResultPopup({ submissionIds, onClose, title = "심의 결과", localePrefix = "" }: {
  submissionIds: string[]; onClose: () => void; title?: string; localePrefix?: string;
}) {
  const ids = [...new Set(submissionIds.filter(id => submissionIdPattern.test(id)))];
  const [selected, setSelected] = React.useState(ids[0] ?? "");
  const dialog = React.useRef<HTMLDialogElement>(null);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const selectedId = ids.includes(selected) ? selected : ids[0];
  React.useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={dialog} aria-label={title} onCancel={onClose} onClose={onClose}
    className="m-auto h-[min(850px,92dvh)] max-h-[92dvh] w-[calc(100%-2rem)] max-w-5xl overflow-hidden rounded-xl border-2 border-foreground bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50">
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <h2 className="font-black">{title}</h2>
        <div className="flex items-center gap-2">
          {ids.length > 1 ? <select aria-label="심의 내역 선택" value={selectedId} onChange={event => setSelected(event.target.value)} className="min-h-10 max-w-40 rounded-lg border border-border bg-background px-3 text-sm">{ids.map((id, index) => <option key={id} value={id}>심의 내역 {index + 1}</option>)}</select> : null}
          <button ref={closeButton} type="button" onClick={onClose} className="min-h-10 rounded-lg border border-border px-4 text-sm font-bold hover:bg-muted">닫기</button>
        </div>
      </div>
      {selectedId ? <iframe key={selectedId} title={`${title} 상세`} src={`${localePrefix === "/en" ? "/en" : ""}/mypage/music/results/${selectedId}`} className="min-h-0 w-full flex-1 border-0" /> : <p className="p-6 text-sm">표시할 심의 내역이 없습니다.</p>}
    </div>
  </dialog>;
}

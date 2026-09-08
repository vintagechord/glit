"use client";

import { useEffect, useRef, useId, Children, isValidElement, cloneElement, type ReactNode, type ButtonHTMLAttributes } from "react";
import { X, ExternalLink, Disc3 } from "lucide-react";

export const inputClass = "min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[#1556a4]";
export const panelClass = "min-w-0 rounded-xl border-2 border-border bg-card p-4 sm:p-5";
export function Button({ children, primary = false, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...props} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${primary ? "border-[#111111] bg-[#f2cf27] text-[#111111] hover:bg-[#ffe05b]" : "border-border bg-card text-foreground hover:border-[#1556a4]"} ${className}`}>{children}</button>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  return <div className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold"><label htmlFor={id}>{label}</label>{Children.map(children, (child) => isValidElement<{id?: string; "aria-describedby"?: string}>(child) && ["input", "select", "textarea"].includes(String(child.type)) ? cloneElement(child, { id, ...(hint ? { "aria-describedby": `${id}-hint` } : {}) }) : child)}{hint && <span id={`${id}-hint`} className="text-xs font-normal leading-5 text-muted-foreground">{hint}</span>}</div>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? "alert" : "note"} className={`rounded-lg border p-3 text-sm leading-6 ${error ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100" : "border-[#1556a4]/25 bg-[#1556a4]/5 text-foreground"}`}>{children}</div>;
}
export function Badge({ children, attention = false }: { children: ReactNode; attention?: boolean }) {
  return <span className={`inline-flex max-w-full items-center rounded-md px-2 py-1 text-xs font-semibold ${attention ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "bg-muted text-muted-foreground"}`}>{children}</span>;
}
export function External({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https:\/\//i.test(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 max-w-full items-center gap-1 text-sm font-semibold text-[#1556a4] underline underline-offset-4 dark:text-blue-300">{children}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden /></a>;
}
export function Cover({ small = false }: { small?: boolean }) {
  return <div aria-label="기본 앨범 이미지" className={`flex shrink-0 items-center justify-center rounded-lg border-2 border-[#111111] bg-[#f2cf27] text-[#111111] ${small ? "h-14 w-14" : "h-24 w-24 sm:h-32 sm:w-32"}`}><Disc3 className={small ? "h-8 w-8" : "h-14 w-14"} aria-hidden /></div>;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = dialog.current;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    el?.showModal(); document.body.style.overflow = "hidden";
    return () => { el?.close(); document.body.style.overflow = overflow; focused?.focus(); };
  }, []);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby={titleId} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-y-auto rounded-xl border-2 border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/55"><div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card p-4"><h2 id={titleId} className="text-lg font-black">{title}</h2><Button aria-label="닫기" onClick={onClose}><X className="h-4 w-4" /></Button></div><div className="space-y-4 p-4 sm:p-5">{children}</div></dialog>;
}
export const displayDate = (value?: string | null) => value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "확인 전";

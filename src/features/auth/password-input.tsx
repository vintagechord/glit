"use client";

import { useState, type ComponentPropsWithRef } from "react";

export function PasswordInput({ label, english = false, className, ...props }: ComponentPropsWithRef<"input"> & { label: string; english?: boolean }) {
  const [visible, setVisible] = useState(false);
  const action = english ? (visible ? "Hide" : "Show") : (visible ? "숨기기" : "보기");
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${className ?? ""} pr-20`} />
      <button
        type="button"
        aria-label={`${label} ${action}`}
        aria-pressed={visible}
        aria-controls={props.id}
        disabled={props.disabled}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-1 my-1 min-w-16 rounded-[6px] px-2 text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {action}
      </button>
    </div>
  );
}

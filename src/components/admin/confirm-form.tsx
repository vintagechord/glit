"use client";

import * as React from "react";

type ConfirmFormProps = React.FormHTMLAttributes<HTMLFormElement> & {
  message?: string;
};

export function ConfirmForm({
  message = "저장하시겠습니까?",
  onSubmit,
  children,
  method,
  ...props
}: ConfirmFormProps) {
  return (
    <form
      {...props}
      method={method ?? "post"}
      onSubmit={(event) => {
        if (onSubmit) {
          onSubmit(event);
        }
        if (event.defaultPrevented) return;
        const ok = window.confirm(message);
        if (!ok) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </form>
  );
}

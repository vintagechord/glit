"use client";

import * as React from "react";

import { showCenteredConfirm } from "@/lib/centered-dialog";

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
  const confirmedSubmitRef = React.useRef(false);

  return (
    <form
      {...props}
      method={method ?? "post"}
      onSubmit={async (event) => {
        if (confirmedSubmitRef.current) {
          confirmedSubmitRef.current = false;
          onSubmit?.(event);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const form = event.currentTarget;
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (!(await showCenteredConfirm(message))) return;
        confirmedSubmitRef.current = true;
        if (
          submitter instanceof HTMLButtonElement ||
          submitter instanceof HTMLInputElement
        ) {
          form.requestSubmit(submitter);
        } else {
          form.requestSubmit();
        }
      }}
    >
      {children}
    </form>
  );
}

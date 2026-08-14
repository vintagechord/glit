"use client";

import * as React from "react";

import { showCenteredConfirm } from "@/lib/centered-dialog";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  message?: string;
};

export function ConfirmSubmitButton({ message = "저장하시겠습니까?", onClick, ...props }: Props) {
  return (
    <button
      {...props}
      type={props.type ?? "submit"}
      onClick={async (event) => {
        if (onClick) onClick(event);
        if (event.defaultPrevented) return;
        const button = event.currentTarget;
        const form = button.form;
        event.preventDefault();
        event.stopPropagation();
        if (!(await showCenteredConfirm(message))) return;
        if ((button.type || "submit") === "submit" && form) {
          form.requestSubmit(button);
        }
      }}
    />
  );
}

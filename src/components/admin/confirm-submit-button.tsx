"use client";

import * as React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  message?: string;
};

export function ConfirmSubmitButton({ message = "저장하시겠습니까?", onClick, ...props }: Props) {
  return (
    <button
      {...props}
      type={props.type ?? "submit"}
      onClick={(event) => {
        if (onClick) onClick(event);
        if (event.defaultPrevented) return;
        const ok = window.confirm(message);
        if (!ok) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    />
  );
}

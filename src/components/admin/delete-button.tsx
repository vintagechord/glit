"use client";

import * as React from "react";

import { deleteSubmissionsFormAction } from "@/features/admin/actions";
import { showCenteredConfirm } from "@/lib/centered-dialog";

export function AdminDeleteButton({
  ids,
  redirectTo,
  className,
  label = "삭제",
}: {
  ids: string[];
  redirectTo?: string;
  className?: string;
  label?: string;
}) {
  const confirmedSubmitRef = React.useRef(false);

  return (
    <form
      action={deleteSubmissionsFormAction}
      onSubmit={async (event) => {
        if (confirmedSubmitRef.current) {
          confirmedSubmitRef.current = false;
          return;
        }
        event.preventDefault();
        const form = event.currentTarget;
        if (!(await showCenteredConfirm("삭제하시겠습니까?"))) return;
        confirmedSubmitRef.current = true;
        form.requestSubmit();
      }}
    >
      <input type="hidden" name="ids" value={ids.join(",")} />
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
      <button
        type="submit"
        className={
          className ??
          "rounded-full border border-rose-200/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-600 transition hover:border-rose-500 hover:text-rose-700"
        }
      >
        {label}
      </button>
    </form>
  );
}

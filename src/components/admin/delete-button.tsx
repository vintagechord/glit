"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { deleteSubmissionsAction } from "@/features/admin/actions";
import { showCenteredAlert, showCenteredConfirm } from "@/lib/centered-dialog";

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
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const remove = async () => {
    if (pending || !(await showCenteredConfirm("삭제하시겠습니까?"))) return;
    startTransition(async () => {
      // The reason a delete was refused (a paid order, for example) must reach the admin.
      const result = await deleteSubmissionsAction({ ids }).catch(() => ({ error: "접수 삭제에 실패했습니다. 잠시 후 다시 시도해주세요." }));
      if (result.error) {
        await showCenteredAlert(result.error, { title: "삭제하지 못했습니다" });
        return;
      }
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={pending}
      aria-busy={pending}
      className={
        className ??
        "inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-[#d9362c] bg-background px-3 text-[11px] font-black text-[#d9362c] transition hover:bg-[#d9362c] hover:text-white disabled:cursor-wait disabled:opacity-60"
      }
    >
      {pending ? "삭제 중…" : label}
    </button>
  );
}

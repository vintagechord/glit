"use client";

import { useRef, useState, useTransition, type ComponentProps } from "react";
import { unstable_rethrow } from "next/navigation";
import type { AdminActionState } from "@/features/admin/actions";

type Props = Omit<ComponentProps<"form">, "action" | "onSubmit"> & {
  action: (data: FormData) => Promise<AdminActionState | void>;
};

/** Keeps the form's values available when a server action returns a validation/database error. */
export function AdminActionForm({ action, children, ...props }: Props) {
  const [state, setState] = useState<AdminActionState>({});
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  return (
    <form {...props} aria-busy={pending} onSubmit={event => {
      event.preventDefault();
      if (submitting.current) return;
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const formData = new FormData(event.currentTarget, submitter);
      submitting.current = true;
      setState({});
      startTransition(async () => {
        try { setState(await action(formData) ?? { message: "변경사항이 저장되었습니다." }); }
        catch (error) {
          unstable_rethrow(error);
          setState({ error: error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해주세요." });
        }
        finally { submitting.current = false; }
      });
    }}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {pending && <p role="status" className="col-span-full text-xs text-muted-foreground">저장 중...</p>}
      {state.error && <p role="alert" className="col-span-full rounded-xl bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="col-span-full rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800">{state.message}</p>}
    </form>
  );
}

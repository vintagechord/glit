"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  updatePasswordAction,
  updateProfileAction,
  type ActionState,
} from "@/features/auth/actions";
import { AdminSaveToast } from "@/components/admin/save-toast";

type ProfileFormProps = {
  defaultValues: {
    name: string;
    company: string;
    phone: string;
  };
};

const initialState: ActionState = {};

export function ProfileForm({ defaultValues }: ProfileFormProps) {
  const [state, formAction] = useActionState(updateProfileAction, initialState);
  const [passwordState, passwordFormAction] = useActionState(
    updatePasswordAction,
    initialState,
  );
  const router = useRouter();
  const hasRefreshed = useRef(false);
  const passwordFormRef = useRef<HTMLFormElement | null>(null);
  const saveMessage = state?.message
    ? "저장되었습니다."
    : passwordState?.message
      ? "비밀번호가 변경되었습니다."
      : "";

  // After a successful save, refresh to pull updated profile values back into the form
  useEffect(() => {
    if (state?.message && !hasRefreshed.current) {
      hasRefreshed.current = true;
      router.refresh();
    }
  }, [state?.message, router]);

  useEffect(() => {
    if (passwordState?.message) {
      passwordFormRef.current?.reset();
    }
  }, [passwordState?.message]);

  return (
    <>
      <AdminSaveToast message={saveMessage} />
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              담당자명
            </label>
            <input
              name="name"
              type="text"
              required
              defaultValue={defaultValues.name}
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
            {state.fieldErrors?.name && (
              <p className="text-xs text-red-500">{state.fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              회사/기획사
            </label>
            <input
              name="company"
              type="text"
              defaultValue={defaultValues.company}
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              연락처
            </label>
            <input
              name="phone"
              type="tel"
              required
              defaultValue={defaultValues.phone}
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
            {state.fieldErrors?.phone && (
              <p className="text-xs text-red-500">{state.fieldErrors.phone}</p>
            )}
          </div>
        </div>
        {state.error && (
          <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-600">
            {state.error}
          </p>
        )}
        {state.message && (
          <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-600">
            {state.message}
          </p>
        )}
        <button
          type="submit"
          className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
        >
          프로필 저장
        </button>
      </form>
      <div className="mt-8 rounded-2xl border border-border/60 bg-background/70 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          비밀번호 변경
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          새 비밀번호는 8자 이상 입력해주세요.
        </p>
        <form
          ref={passwordFormRef}
          action={passwordFormAction}
          className="mt-4 space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                새 비밀번호
              </label>
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
              />
              {passwordState.fieldErrors?.newPassword && (
                <p className="text-xs text-red-500">
                  {passwordState.fieldErrors.newPassword}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                새 비밀번호 확인
              </label>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
              />
              {passwordState.fieldErrors?.confirmPassword && (
                <p className="text-xs text-red-500">
                  {passwordState.fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          </div>
          {passwordState.error && (
            <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-600">
              {passwordState.error}
            </p>
          )}
          {passwordState.message && (
            <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-600">
              {passwordState.message}
            </p>
          )}
          <button
            type="submit"
            className="rounded-full border border-border/70 bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
          >
            비밀번호 변경
          </button>
        </form>
      </div>
    </>
  );
}

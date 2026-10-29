"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  updatePasswordAction,
  updateProfileAction,
  type ActionState,
} from "@/features/auth/actions";

type ProfileFormProps = {
  canChangePassword?: boolean;
  canEditNotificationEmail?: boolean;
  english?: boolean;
  defaultValues: {
    name: string;
    company: string;
    phone: string;
    notificationEmail?: string;
  };
};

const initialState: ActionState = {};

export function ProfileForm({ defaultValues, canChangePassword = true, canEditNotificationEmail = false, english = false }: ProfileFormProps) {
  const [state, formAction, profilePending] = useActionState(updateProfileAction, initialState);
  const [values, setValues] = useState({ ...defaultValues, notificationEmail: defaultValues.notificationEmail ?? "" });
  const [passwordState, passwordFormAction, passwordPending] = useActionState(
    updatePasswordAction,
    initialState,
  );
  const router = useRouter();
  const passwordFormRef = useRef<HTMLFormElement | null>(null);

  // After a successful save, refresh to pull updated profile values back into the form
  useEffect(() => {
    if (state.message) {
      router.refresh();
    }
  }, [state, router]);

  useEffect(() => {
    if (passwordState?.message) {
      passwordFormRef.current?.reset();
    }
  }, [passwordState]);

  return (
    <>
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="profile-name" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              담당자명
            </label>
            <input
              id="profile-name"
              name="name"
              disabled={profilePending}
              type="text"
              required
              value={values.name}
              onChange={(event) => setValues(current => ({ ...current, name: event.target.value }))}
              className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
            />
            {state.fieldErrors?.name && (
              <p className="text-xs text-red-500">{state.fieldErrors.name}</p>
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="profile-company" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              회사/기획사
            </label>
            <input
              id="profile-company"
              name="company"
              disabled={profilePending}
              type="text"
              value={values.company}
              onChange={(event) => setValues(current => ({ ...current, company: event.target.value }))}
              className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="profile-phone" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              연락처
            </label>
            <input
              id="profile-phone"
              name="phone"
              disabled={profilePending}
              type="tel"
              required
              value={values.phone}
              onChange={(event) => setValues(current => ({ ...current, phone: event.target.value }))}
              className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
            />
            {state.fieldErrors?.phone && (
              <p className="text-xs text-red-500">{state.fieldErrors.phone}</p>
            )}
          </div>
          {canEditNotificationEmail && <div className="space-y-2 md:col-span-2">
            <label htmlFor="profile-notificationEmail" className="text-xs font-semibold text-foreground">
              {english ? "Review notification email" : "심의 안내 수신 이메일"}
            </label>
            <input
              id="profile-notificationEmail"
              name="notificationEmail"
              type="email"
              autoComplete="email"
              maxLength={254}
              disabled={profilePending}
              value={values.notificationEmail}
              onChange={event => setValues(current => ({ ...current, notificationEmail: event.target.value }))}
              aria-invalid={Boolean(state.fieldErrors?.notificationEmail)}
              aria-describedby={`profile-notificationEmail-help${state.fieldErrors?.notificationEmail ? " profile-notificationEmail-error" : ""}`}
              className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
            />
            <p id="profile-notificationEmail-help" className="text-xs leading-5 text-muted-foreground">
              {english
                ? "Review results, progress updates, supplement requests and payment notices will be sent to this email. If left blank, we use the contact email on each application."
                : "심의 결과, 진행 상황, 보완 요청 및 결제 안내를 이 이메일로 보내드립니다. 등록하지 않으면 신청서에 입력한 연락 이메일로 안내합니다."}
            </p>
            {state.fieldErrors?.notificationEmail && <p id="profile-notificationEmail-error" className="text-xs font-semibold text-[#d9362c]" role="alert">{state.fieldErrors.notificationEmail}</p>}
          </div>}
        </div>
        {state.error && (
          <p role="alert" className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-2 text-xs font-semibold text-[#d9362c]">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="rounded-[8px] border-2 border-[#1f7a5a] bg-[#1f7a5a]/10 px-4 py-2 text-xs font-semibold text-[#1f7a5a]">
            {state.message}
          </p>
        )}
        <button
          type="submit"
          disabled={profilePending}
          className="bauhaus-button px-6 py-3 text-sm"
        >
          {profilePending ? "저장 중..." : "프로필 저장"}
        </button>
      </form>
      {canChangePassword && <div className="mt-8 rounded-[8px] border-2 border-border bg-background/70 p-4">
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
              <label htmlFor="profile-newPassword" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                새 비밀번호
              </label>
              <input
                id="profile-newPassword"
                name="newPassword"
                disabled={passwordPending}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
              />
              {passwordState.fieldErrors?.newPassword && (
                <p className="text-xs text-red-500">
                  {passwordState.fieldErrors.newPassword}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="profile-confirmPassword" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                새 비밀번호 확인
              </label>
              <input
                id="profile-confirmPassword"
                name="confirmPassword"
                disabled={passwordPending}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
              />
              {passwordState.fieldErrors?.confirmPassword && (
                <p className="text-xs text-red-500">
                  {passwordState.fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          </div>
          {passwordState.error && (
            <p role="alert" className="rounded-[8px] border-2 border-[#d9362c] bg-[#d9362c]/10 px-4 py-2 text-xs font-semibold text-[#d9362c]">
              {passwordState.error}
            </p>
          )}
          {passwordState.message && (
            <p role="status" className="rounded-[8px] border-2 border-[#1f7a5a] bg-[#1f7a5a]/10 px-4 py-2 text-xs font-semibold text-[#1f7a5a]">
              {passwordState.message}
            </p>
          )}
          <button
            type="submit"
            disabled={passwordPending}
            className="bauhaus-button px-6 py-3 text-sm"
          >
            {passwordPending ? "변경 중..." : "비밀번호 변경"}
          </button>
        </form>
      </div>}
    </>
  );
}

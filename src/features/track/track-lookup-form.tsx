"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

export function TrackLookupForm({
  onSuccess,
}: {
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState("");
  const [validating, setValidating] = React.useState(false);
  const [lookupName, setLookupName] = React.useState("");
  const [lookupEmail, setLookupEmail] = React.useState("");
  const [lookupError, setLookupError] = React.useState("");
  const [lookupMessage, setLookupMessage] = React.useState("");
  const [lookupBusy, setLookupBusy] = React.useState(false);

  const openTrack = React.useCallback(
    (value: string) => {
      onSuccess?.();
      router.push(`${localePrefix}/track/${encodeURIComponent(value)}`);
    },
    [localePrefix, onSuccess, router],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = token.trim();
    if (!value) {
      setError("조회 코드를 입력해주세요.");
      return;
    }
    setValidating(true);
    try {
      const res = await fetch("/api/track/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!payload.ok) {
        setError("코드가 올바르지 않습니다. 다시 입력해주세요.");
        return;
      }
      setError("");
      openTrack(value);
    } catch {
      setError("코드를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setValidating(false);
    }
  };

  const handleLookupCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = lookupName.trim();
    const email = lookupEmail.trim();
    if (!name || !email) {
      setLookupError("이름과 이메일을 입력해주세요.");
      setLookupMessage("");
      return;
    }

    setLookupBusy(true);
    setLookupError("");
    setLookupMessage("");
    try {
      const response = await fetch("/api/track/lookup-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            message?: string;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        setLookupError(
          payload?.error ??
            "조회 코드를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
        );
        return;
      }

      setLookupError("");
      setLookupMessage(
        payload.message ??
          "입력한 정보와 일치하는 접수가 있으면 해당 이메일로 조회 코드를 보내드립니다.",
      );
    } catch {
      setLookupMessage("");
      setLookupError("조회 코드를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLookupBusy(false);
    }
  };

  return (
    <div className="mt-6 space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label
          htmlFor="guest-track-token"
          className="text-[11px] font-black uppercase tracking-normal text-muted-foreground"
        >
          조회 코드
        </label>
        <input
          id="guest-track-token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="비회원 조회 코드 입력"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "guest-track-token-error" : undefined}
          className={`w-full rounded-[8px] border-2 ${
            error ? "border-[#d9362c] bg-[#d9362c]/10" : "border-border bg-background"
          } px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]`}
        />
        {error ? (
          <p id="guest-track-token-error" className="text-xs text-black">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={validating}
          className="bauhaus-button w-full px-4 py-3 text-xs uppercase disabled:cursor-not-allowed disabled:bg-muted"
        >
          {validating ? "확인 중..." : "진행상황 조회"}
        </button>
      </form>

      <div className="rounded-[8px] border-2 border-border bg-background/70 p-4">
        <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
          조회 코드 찾기
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          조회 코드를 잊은 경우 접수자 이름과 이메일을 확인한 뒤 등록된 이메일로 조회 코드를 보내드립니다.
        </p>
        <form onSubmit={handleLookupCode} className="mt-3 space-y-3">
          <label
            htmlFor="lookup-name"
            className="text-[11px] font-black uppercase tracking-normal text-muted-foreground"
          >
            접수자 이름
          </label>
          <input
            id="lookup-name"
            value={lookupName}
            onChange={(event) => setLookupName(event.target.value)}
            placeholder="접수자 이름"
            aria-invalid={Boolean(lookupError)}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          <label
            htmlFor="lookup-email"
            className="text-[11px] font-black uppercase tracking-normal text-muted-foreground"
          >
            접수자 이메일
          </label>
          <input
            id="lookup-email"
            type="email"
            value={lookupEmail}
            onChange={(event) => setLookupEmail(event.target.value)}
            placeholder="접수자 이메일"
            aria-invalid={Boolean(lookupError)}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#1556a4]"
          />
          <button
            type="submit"
            disabled={lookupBusy}
            className="w-full rounded-[8px] border-2 border-border bg-background px-4 py-3 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-[#111111] hover:bg-[#111111] hover:text-white disabled:cursor-not-allowed disabled:opacity-60 dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
          >
            {lookupBusy ? "조회 중..." : "조회 코드 찾기"}
          </button>
        </form>
        {lookupError ? (
          <p className="mt-3 text-xs text-red-500" role="alert">
            {lookupError}
          </p>
        ) : null}
        {lookupMessage ? (
          <p
            className="mt-3 rounded-[8px] border-2 border-[#1556a4] bg-[#1556a4]/10 px-3 py-3 text-xs font-semibold leading-5 text-foreground"
            role="status"
          >
            {lookupMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

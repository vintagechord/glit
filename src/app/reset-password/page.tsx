"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

type Status =
  | { state: "idle" }
  | { state: "verifying" }
  | { state: "ready" }
  | { state: "error"; message: string }
  | { state: "success"; message: string };

function ResetPasswordContent() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>({ state: "verifying" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      if (typeof window === "undefined") return;

      // Supabase recovery 링크는 ?token 또는 ?code 쿼리로 전달되거나,
      // #access_token/#refresh_token 해시로 전달될 수 있음.
      const code =
        searchParams.get("code") || searchParams.get("token") || null;
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (!exchangeError) {
          setStatus({ state: "ready" });
          return;
        }

        // 일부 릴리즈에서 recovery 토큰은 verifyOtp로 처리해야 할 수 있음
        const { data: verifyData, error: verifyError } =
          await supabase.auth.verifyOtp({
            type: "recovery",
            token_hash: code,
          });
        if (verifyError || !verifyData.session) {
          setStatus({
            state: "error",
            message:
              "세션을 확인할 수 없습니다. 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해주세요.",
          });
          return;
        }

        setStatus({ state: "ready" });
        return;
      }

      const hash = window.location.hash || "";
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) {
        setStatus({
          state: "error",
          message:
            "유효한 비밀번호 재설정 링크가 아닙니다. 메일의 링크를 다시 클릭해주세요.",
        });
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        setStatus({
          state: "error",
          message:
            "세션을 확인할 수 없습니다. 링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해주세요.",
        });
        return;
      }
      setStatus({ state: "ready" });
    };
    void run();
  }, [searchParams, supabase]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!password || password.length < 8) {
      setError("비밀번호는 8자 이상 입력해주세요.");
      return;
    }
    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setStatus({ state: "verifying" });
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    if (updateError) {
      setStatus({ state: "ready" });
      setError("비밀번호를 변경할 수 없습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    setSuccess("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.");
    setStatus({ state: "success", message: "비밀번호가 변경되었습니다." });
    setTimeout(() => router.push("/login"), 1500);
  };

  const heading =
    status.state === "error"
      ? "링크를 확인해주세요"
      : status.state === "success"
        ? "완료되었습니다"
        : "새 비밀번호 설정";

  return (
    <div className="relative mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6 py-16">
      <div className="absolute left-8 top-12 h-40 w-40 rounded-full bg-emerald-400/15 blur-[100px] dark:bg-emerald-500/20" />
      <div className="w-full max-w-xl space-y-6 rounded-[32px] border border-border/60 bg-card/80 p-8 shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Reset Password
          </p>
          <h1 className="font-display text-2xl text-foreground">{heading}</h1>
          <p className="text-sm text-muted-foreground">
            비밀번호를 재설정한 뒤 새 비밀번호로 로그인해주세요.
          </p>
        </div>

        {status.state === "error" && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
            {status.message}
          </div>
        )}
        {success && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              새 비밀번호
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              새 비밀번호 확인
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
          </div>
          {error && (
            <p className="text-xs text-red-500">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={status.state === "verifying"}
            className="w-full rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status.state === "verifying" ? "처리 중..." : "비밀번호 변경하기"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="px-6 py-16 text-center text-sm text-muted-foreground">로딩 중...</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}

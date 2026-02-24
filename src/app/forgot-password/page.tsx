"use client";

import { useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const redirectBase = useMemo(() => {
    if (typeof window !== "undefined") return window.location.origin;
    return process.env.NEXT_PUBLIC_APP_URL ?? "https://glit-b1yn.onrender.com";
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!email.trim()) {
      setError("이메일을 입력해주세요.");
      return;
    }
    setIsSending(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      {
        redirectTo: `${redirectBase}/reset-password`,
      },
    );
    if (sendError) {
      setError(sendError.message || "비밀번호 재설정 메일을 보낼 수 없습니다. 잠시 후 다시 시도해주세요.");
    } else {
      setMessage("비밀번호 재설정 메일을 발송했습니다.");
    }
    setIsSending(false);
  };

  return (
    <div className="relative mx-auto flex w-full max-w-4xl flex-1 items-center justify-center px-6 py-16">
      <div className="absolute right-8 top-12 h-40 w-40 rounded-full bg-[#f6d64a] blur-[100px] dark:bg-[#f6d64a]" />
      <div className="w-full max-w-xl space-y-6 rounded-[32px] border border-border/60 bg-card/80 p-8 shadow-[0_30px_100px_rgba(15,23,42,0.12)]">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Forgot Password
          </p>
          <h1 className="font-display text-2xl text-foreground">비밀번호 찾기</h1>
          <p className="text-sm text-muted-foreground">
            회원가입시 입력한 이메일로 비밀번호 재설정 링크를 보내드립니다.
          </p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              이메일
            </label>
            <input
              name="resetEmail"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="이메일을 입력하세요"
              className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
            />
          </div>
          <button
            type="submit"
            disabled={isSending}
            className="w-full rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
          >
            {isSending ? "발송 중..." : "비밀번호 재설정 메일 발송"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            메일 수신이 안된 경우 메일함(스팸 포함)을 확인해주세요.
          </p>
        </form>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export function TrackLookupForm({
  onSuccess,
}: {
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState("");
  const [validating, setValidating] = React.useState(false);

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
      onSuccess?.();
      router.push(`/track/${encodeURIComponent(value)}`);
    } catch {
      setError("코드를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setValidating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-3">
      <input
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="비회원 조회 코드 입력"
        className={`w-full rounded-2xl border ${
          error ? "border-[#f6d64a] bg-[#f6d64a]" : "border-border/70 bg-background"
        } px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground`}
      />
      {error ? (
        <p className="text-xs text-black">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={validating}
        className="w-full rounded-full bg-foreground px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:bg-[#f6d64a] hover:text-black disabled:cursor-not-allowed disabled:bg-muted"
      >
        {validating ? "확인 중..." : "진행상황 조회"}
      </button>
    </form>
  );
}

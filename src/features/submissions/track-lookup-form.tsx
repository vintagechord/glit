"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export function TrackLookupForm() {
  const router = useRouter();
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError("조회 코드를 입력해주세요.");
      return;
    }
    setError("");
    router.push(`/track/${encodeURIComponent(trimmed)}`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          조회 코드
        </label>
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
      <button
        type="submit"
        className="w-full rounded-full bg-foreground px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
      >
        진행 상황 조회
      </button>
    </form>
  );
}

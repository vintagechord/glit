"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export function TrackLookupForm({
  onSuccess,
}: {
  onSuccess?: () => void;
}) {
  const noMatchLookupError = "일치하는 접수 내역이 없습니다. 입력값을 다시 확인해주세요.";
  const router = useRouter();
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState("");
  const [validating, setValidating] = React.useState(false);
  const [lookupName, setLookupName] = React.useState("");
  const [lookupEmail, setLookupEmail] = React.useState("");
  const [lookupError, setLookupError] = React.useState("");
  const [noMatchAttemptCount, setNoMatchAttemptCount] = React.useState(0);
  const [lookupBusy, setLookupBusy] = React.useState(false);
  const [lookupResults, setLookupResults] = React.useState<
    Array<{
      token: string;
      title?: string | null;
      type?: string | null;
      createdAt?: string | null;
    }>
  >([]);

  const openTrack = React.useCallback(
    (value: string) => {
      onSuccess?.();
      router.push(`/track/${encodeURIComponent(value)}`);
    },
    [onSuccess, router],
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
      setNoMatchAttemptCount(0);
      return;
    }

    setLookupBusy(true);
    setLookupError("");
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
            items?: Array<{
              token?: string;
              title?: string | null;
              type?: string | null;
              createdAt?: string | null;
            }>;
          }
        | null;

      if (!response.ok || !payload?.ok) {
        setLookupResults([]);
        setNoMatchAttemptCount(0);
        setLookupError(
          payload?.error ??
            "조회 코드를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
        );
        return;
      }

      const rows =
        payload.items
          ?.filter((item) => typeof item.token === "string")
          .map((item) => ({
            token: String(item.token),
            title: item.title ?? null,
            type: item.type ?? null,
            createdAt: item.createdAt ?? null,
          })) ?? [];

      setLookupResults(rows);
      if (rows.length === 0) {
        setLookupError(noMatchLookupError);
        setNoMatchAttemptCount((prev) => prev + 1);
      } else {
        setLookupError("");
        setNoMatchAttemptCount(0);
      }
    } catch {
      setLookupResults([]);
      setNoMatchAttemptCount(0);
      setLookupError("조회 코드를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLookupBusy(false);
    }
  };

  const formatCreatedAt = (value?: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("ko-KR");
  };

  return (
    <div className="mt-6 space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
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

      <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          조회 코드 찾기
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          조회 코드를 잊은 경우 접수자 이름과 이메일로 조회 코드를 확인할 수 있습니다.
        </p>
        <form onSubmit={handleLookupCode} className="mt-3 space-y-3">
          <input
            value={lookupName}
            onChange={(event) => setLookupName(event.target.value)}
            placeholder="접수자 이름"
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
          <input
            type="email"
            value={lookupEmail}
            onChange={(event) => setLookupEmail(event.target.value)}
            placeholder="접수자 이메일"
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-foreground"
          />
          <button
            type="submit"
            disabled={lookupBusy}
            className="w-full rounded-full border border-border/70 bg-background px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            {lookupBusy ? "조회 중..." : "조회 코드 찾기"}
          </button>
        </form>
        {lookupError ? (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-red-500">{lookupError}</p>
            {lookupError === noMatchLookupError && noMatchAttemptCount >= 2 ? (
              <p className="text-xs text-muted-foreground">
                접수 정보를 잊었다면, 관리자(help@vhouse.co.kr)에게 문의해주세요.
              </p>
            ) : null}
          </div>
        ) : null}

        {lookupResults.length > 0 ? (
          <div className="mt-3 space-y-2">
            {lookupResults.map((item, index) => (
              <div
                key={`${item.token}-${index}`}
                className="rounded-xl border border-border/60 bg-card/80 px-3 py-3 text-xs"
              >
                <p className="font-semibold text-foreground">
                  {item.title?.trim() || `접수 ${index + 1}`}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {(item.type ?? "").startsWith("MV") ? "MV" : "ALBUM"}
                  {item.createdAt ? ` · ${formatCreatedAt(item.createdAt)}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="rounded-md bg-black/5 px-2 py-1 text-[11px] text-foreground dark:bg-white/10">
                    {item.token}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(item.token).catch(() => null)
                    }
                    className="rounded-full border border-border/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-black hover:bg-black hover:text-white"
                  >
                    복사
                  </button>
                  <button
                    type="button"
                    onClick={() => openTrack(item.token)}
                    className="rounded-full border border-border/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-black hover:bg-black hover:text-white"
                  >
                    조회
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

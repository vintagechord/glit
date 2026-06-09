"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export function EnglishTrackLookupForm() {
  const router = useRouter();
  const [token, setToken] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = token.trim();
    if (!value) {
      setError("Enter your lookup code.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/track/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean }
        | null;

      if (!payload?.ok) {
        setError("The lookup code does not match any submission.");
        return;
      }

      router.push(`/en/track/${encodeURIComponent(value)}`);
    } catch {
      setError("We could not validate the lookup code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label
        htmlFor="english-track-token"
        className="text-[11px] font-black uppercase tracking-normal text-muted-foreground"
      >
        Lookup code
      </label>
      <input
        id="english-track-token"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        placeholder="Enter your guest lookup code"
        aria-invalid={Boolean(error)}
        className={`w-full rounded-[8px] border-2 ${
          error ? "border-[#d9362c] bg-[#d9362c]/10" : "border-border bg-background"
        } px-4 py-3 text-sm font-semibold text-foreground outline-none transition focus:border-[#1556a4]`}
      />
      {error ? <p className="text-xs font-semibold text-[#d9362c]">{error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="bauhaus-button w-full px-4 py-3 text-xs uppercase disabled:cursor-not-allowed disabled:bg-muted"
      >
        {busy ? "Checking..." : "Check Progress"}
      </button>
    </form>
  );
}

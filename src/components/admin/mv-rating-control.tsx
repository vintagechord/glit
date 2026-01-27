"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

const ratingOptions = [
  { value: "", label: "결과 미입력" },
  { value: "ALL", label: "전체연령" },
  { value: "12", label: "12세 이상" },
  { value: "15", label: "15세 이상" },
  { value: "19", label: "19세 이상" },
  { value: "REJECT", label: "심의 불가" },
];

export function MvRatingControl({
  submissionId,
  initialRating,
}: {
  submissionId: string;
  initialRating?: string | null;
}) {
  const router = useRouter();
  const [rating, setRating] = React.useState(initialRating ?? "");
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleSave = async () => {
    if (!rating) {
      setError("등급을 선택하세요.");
      setNotice(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/submissions/${submissionId}/mv-rating`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string };
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `저장 실패 (status ${res.status})`);
      }
      setNotice("저장 완료");
      setError(null);
      // 즉시 화면 반영
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "저장에 실패했습니다.";
      setError(message);
      setNotice(null);
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          결과 등급
        </span>
        <select
          value={rating}
          onChange={(e) => setRating(e.target.value)}
          className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm"
          disabled={loading}
        >
          {ratingOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        선택한 등급은 사용자 상세 화면에 표시되며, 해당 등급 이미지·가이드·필증 다운로드에 사용됩니다.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "저장 중…" : "등급 저장"}
        </button>
      </div>
      {notice ? (
        <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-xs text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

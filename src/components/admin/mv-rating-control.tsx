"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

const ratingOptions = [
  { value: "", label: "결과 미입력" },
  { value: "ALL", label: "전체연령" },
  { value: "12", label: "12세 이상" },
  { value: "15", label: "15세 이상" },
  { value: "REJECT", label: "심의 불가" },
  { value: "18", label: "청소년불가(18세)" },
];

const ratingLabelMap = Object.fromEntries(
  ratingOptions.map((option) => [option.value, option.label]),
);

export function MvRatingControl({
  submissionId,
  initialRating,
}: {
  submissionId: string;
  initialRating?: string | null;
}) {
  const router = useRouter();
  const [rating, setRating] = React.useState(initialRating ?? "");
  const [savedRating, setSavedRating] = React.useState(initialRating ?? "");
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const hasChanges = rating !== savedRating;

  React.useEffect(() => {
    const nextRating = initialRating ?? "";
    setRating(nextRating);
    setSavedRating(nextRating);
  }, [initialRating]);

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
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        rating?: string;
        error?: string;
      } | null;
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `저장 실패 (status ${res.status})`);
      }
      setSavedRating(json?.rating ?? rating);
      setNotice("MV 등급과 결과통보 상태가 저장되었습니다.");
      setError(null);
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
      <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
        현재 저장된 등급:{" "}
        <span className="font-semibold text-foreground">
          {ratingLabelMap[savedRating] ?? savedRating}
        </span>
        {hasChanges ? (
          <span className="ml-2 font-semibold text-[#1556a4]">
            저장 전 변경사항 있음
          </span>
        ) : null}
      </div>
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
        저장하면 사용자 상세의 진행표가 결과통보 상태로 마감되고, 등급 이미지·가이드·필증 다운로드에 사용됩니다.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || !hasChanges}
          className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "저장 중..." : "MV 등급 설정 저장"}
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

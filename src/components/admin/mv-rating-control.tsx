"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

import * as React from "react";
import { useRouter } from "next/navigation";

import { AdminSaveToast } from "@/components/admin/save-toast";

const ratingOptions = [
  { value: "", label: "결과 미입력" },
  { value: "ALL", label: "전체관람가" },
  { value: "12", label: "12세이상관람가" },
  { value: "15", label: "15세이상관람가" },
  { value: "19", label: "청소년관람불가" },
  { value: "18", label: "청소년관람불가(기존 코드)" },
  { value: "REJECT", label: "심의 불가" },
];

const ratingLabelMap = Object.fromEntries(
  ratingOptions.map((option) => [option.value, option.label]),
);

// This legacy column holds both applicants' free-text wishes and result codes.
// Only a stored official result code may preselect an administrator's result.
const getInitialResultRating = (value?: string | null) =>
  ratingOptions.some((option) => option.value === value) ? value ?? "" : "";

export function MvRatingControl({
  submissionId,
  initialRating,
  expectedUpdatedAt,
  isResultSaved,
  isResultNotified = false,
}: {
  submissionId: string;
  initialRating?: string | null;
  expectedUpdatedAt: string;
  isResultSaved?: boolean;
  isResultNotified?: boolean;
}) {
  const router = useRouter();
  const [rating, setRating] = React.useState(() => getInitialResultRating(initialRating));
  const [savedRating, setSavedRating] = React.useState(() => getInitialResultRating(initialRating));
  const [resultNotified, setResultNotified] = React.useState(isResultNotified);
  const [hasSavedResult, setHasSavedResult] = React.useState(isResultSaved ?? isResultNotified);
  const [loading, setLoading] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [savePopup, setSavePopup] = React.useState<{
    id: number;
    message: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const hasChanges = rating !== savedRating;
  const requestedRating = initialRating?.trim() && !getInitialResultRating(initialRating)
    ? initialRating.trim()
    : "";

  React.useEffect(() => {
    const nextRating = getInitialResultRating(initialRating);
    setRating(nextRating);
    setSavedRating(nextRating);
    setResultNotified(isResultNotified);
    setHasSavedResult(isResultSaved ?? isResultNotified);
  }, [initialRating, isResultNotified, isResultSaved]);

  const handleSave = async () => {
    if (!rating) {
      setError("등급을 선택하세요.");
      setNotice(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/admin/submissions/${submissionId}/mv-rating`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, expectedUpdatedAt }),
      }, 300_000);
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        rating?: string;
        error?: string;
        warning?: string;
        deliveredCount?: number;
        queuedCount?: number;
        pendingAssets?: boolean;
      } | null;
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `저장 실패 (status ${res.status})`);
      }
      setSavedRating(json?.rating ?? rating);
      setRating(json?.rating ?? rating);
      setResultNotified(false);
      setHasSavedResult(true);
      const successMessage = "결과 등급을 저장했습니다. 이메일은 결과 안내에서 따로 발송해주세요.";
      setNotice(successMessage);
      setSavePopup({ id: Date.now(), message: successMessage });
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
      {savePopup ? (
        <AdminSaveToast
          key={savePopup.id}
          message={savePopup.message}
        />
      ) : null}
      {requestedRating ? (
        <div className="rounded-2xl border border-border/60 px-4 py-3 text-xs text-muted-foreground">
          <p>
            신청 희망등급: <span className="font-semibold text-foreground">{requestedRating}</span>
          </p>
          <p className="mt-1 leading-5">
            희망등급은 심의 결과가 아닙니다. 확정된 결과 등급을 아래에서 선택해주세요.
          </p>
        </div>
      ) : null}
      <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-xs text-muted-foreground">
        결과 등급:{" "}
        <span className="font-semibold text-foreground">
          {ratingLabelMap[savedRating] ?? (savedRating || "결과 미입력")}
        </span>
        {hasChanges ? (
          <span className="ml-2 font-semibold text-[#1556a4]">
            저장 전 변경사항 있음
          </span>
        ) : !resultNotified && savedRating ? (
          <span className="ml-2 font-semibold text-[#1556a4]">
            저장됨 · 이메일 별도 발송
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
        저장한 등급은 사용자 결과 페이지에 반영됩니다. 등급과 필증을 저장한 뒤 결과 안내에서 이메일 내용을 확인하고 발송해주세요.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || !rating || (!hasChanges && hasSavedResult)}
          className="rounded-full bg-foreground px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "저장 중..." : "등급 저장"}
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

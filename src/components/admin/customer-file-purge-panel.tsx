"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PURGE_BATCH_LIMIT } from "@/lib/admin/customer-file-purge-limits";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export type PurgeListItem = {
  submissionId: string;
  title: string | null;
  artistName: string | null;
  type: string | null;
  finishedAt: string | null;
  fileCount: number;
  totalBytes: number;
};

type PurgeResult = {
  submissionId: string;
  ok: boolean;
  deletedFiles: number;
  failedFiles: number;
  freedBytes: number;
  error?: string;
};

const typeLabels: Record<string, string> = {
  ALBUM: "음반",
  MV_DISTRIBUTION: "온라인 뮤직비디오",
  MV_BROADCAST: "방송 뮤직비디오",
};

const ageFilters = [
  ["0", "전체"],
  ["30", "결과 30일 경과"],
  ["90", "결과 90일 경과"],
  ["180", "결과 180일 경과"],
] as const;

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.ceil(bytes / 1024)}KB`;
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";

const buttonClass =
  "inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] px-3 text-xs font-black shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

export function CustomerFilePurgePanel({ items }: { items: PurgeListItem[] }) {
  const router = useRouter();
  const [minDays, setMinDays] = React.useState("0");
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = React.useState<PurgeResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const running = progress !== null;

  const visible = React.useMemo(() => {
    const days = Number(minDays);
    if (!days) return items;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return items.filter((item) => item.finishedAt && new Date(item.finishedAt).getTime() <= cutoff);
  }, [items, minDays]);
  const chosen = visible.filter((item) => selected.has(item.submissionId));
  const chosenFiles = chosen.reduce((sum, item) => sum + item.fileCount, 0);
  const chosenBytes = chosen.reduce((sum, item) => sum + item.totalBytes, 0);
  const allVisibleSelected = visible.length > 0 && chosen.length === visible.length;

  const toggle = (submissionId: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(submissionId)) next.delete(submissionId);
      else next.add(submissionId);
      return next;
    });

  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((item) => item.submissionId)));

  const purge = async () => {
    if (!chosen.length || running) return;
    const confirmed = window.confirm(
      `선택한 ${chosen.length}건의 고객 업로드 파일 ${chosenFiles}개(${formatBytes(chosenBytes)})를 저장소에서 영구 삭제합니다.\n\n` +
        "필증, 연령등급 이미지, 표기 가이드와 신청·결과 기록은 유지됩니다.\n삭제한 파일은 되돌릴 수 없습니다. 계속할까요?",
    );
    if (!confirmed) return;

    const ids = chosen.map((item) => item.submissionId);
    const collected: PurgeResult[] = [];
    setError(null);
    setResults(null);
    setProgress({ done: 0, total: ids.length });
    try {
      for (let index = 0; index < ids.length; index += PURGE_BATCH_LIMIT) {
        const batch = ids.slice(index, index + PURGE_BATCH_LIMIT);
        const response = await fetchWithTimeout(
          "/api/admin/customer-files/purge",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ submissionIds: batch }),
          },
          295_000,
        );
        const payload = (await response.json().catch(() => null)) as
          | { results?: PurgeResult[]; error?: string }
          | null;
        if (!response.ok || !payload?.results) {
          throw new Error(payload?.error || "삭제 요청을 처리하지 못했습니다.");
        }
        collected.push(...payload.results);
        setProgress({ done: Math.min(index + batch.length, ids.length), total: ids.length });
      }
    } catch (purgeError) {
      setError(
        `${purgeError instanceof Error ? purgeError.message : "삭제 요청을 처리하지 못했습니다."} ` +
          "처리된 건은 아래 결과에 반영되며, 남은 건은 목록에서 다시 시도할 수 있습니다.",
      );
    } finally {
      setResults(collected);
      setProgress(null);
      setSelected(new Set());
      router.refresh();
    }
  };

  const deletedFiles = results?.reduce((sum, result) => sum + result.deletedFiles, 0) ?? 0;
  const freedBytes = results?.reduce((sum, result) => sum + result.freedBytes, 0) ?? 0;
  const failures = results?.filter((result) => !result.ok) ?? [];
  const titleOf = (submissionId: string) =>
    items.find((item) => item.submissionId === submissionId)?.title || submissionId;

  return (
    <div className="space-y-4">
      {results ? (
        <div role="status" className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-background p-4 text-sm leading-6">
          <p className="font-black">
            {results.length}건 처리 · 파일 {deletedFiles}개 삭제 · {formatBytes(freedBytes)} 확보
            {failures.length ? ` · ${failures.length}건 확인 필요` : ""}
          </p>
          {failures.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {failures.map((failure) => (
                <li key={failure.submissionId}>
                  <span data-no-translate>{titleOf(failure.submissionId)}</span>: {failure.error}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] p-4 text-sm font-semibold text-white">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="결과 경과 기간">
          {ageFilters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={minDays === value}
              onClick={() => setMinDays(value)}
              disabled={running}
              className={`${buttonClass} ${minDays === value ? "bg-[#111111] text-white" : "bg-background text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm font-semibold text-muted-foreground">
          대상 {visible.length}건 · {formatBytes(visible.reduce((sum, item) => sum + item.totalBytes, 0))}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[10px] border-2 border-dashed border-border p-6 text-sm text-muted-foreground">
          지금 삭제할 수 있는 고객 파일이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border-2 border-[var(--bauhaus-ink)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[#111111] text-white">
              <tr>
                <th className="w-12 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="목록 전체 선택"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    disabled={running}
                    className="h-4 w-4"
                  />
                </th>
                <th className="px-3 py-2 font-black">신청</th>
                <th className="px-3 py-2 font-black">유형</th>
                <th className="px-3 py-2 font-black">결과일</th>
                <th className="px-3 py-2 text-right font-black">파일</th>
                <th className="px-3 py-2 text-right font-black">용량</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.submissionId} className="border-t-2 border-border">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${item.title || "제목 없음"} 선택`}
                      checked={selected.has(item.submissionId)}
                      onChange={() => toggle(item.submissionId)}
                      disabled={running}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/submissions/detail?id=${item.submissionId}`}
                      className="font-semibold underline underline-offset-4"
                    >
                      <span data-no-translate>{item.title || "제목 없음"}</span>
                    </Link>
                    {item.artistName ? (
                      <span data-no-translate className="block text-xs text-muted-foreground">{item.artistName}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{typeLabels[item.type ?? ""] ?? item.type ?? "-"}</td>
                  <td className="px-3 py-2">{formatDate(item.finishedAt)}</td>
                  <td className="px-3 py-2 text-right">{item.fileCount}개</td>
                  <td className="px-3 py-2 text-right">{formatBytes(item.totalBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border-2 border-[var(--bauhaus-ink)] bg-background p-4 shadow-[4px_4px_0_#111111]">
        <p className="text-sm font-semibold">
          {running
            ? `삭제 중… ${progress.done}/${progress.total}건`
            : `선택 ${chosen.length}건 · 파일 ${chosenFiles}개 · ${formatBytes(chosenBytes)}`}
        </p>
        <button
          type="button"
          onClick={() => void purge()}
          disabled={!chosen.length || running}
          className={`${buttonClass} bg-[var(--bauhaus-red)] text-white`}
        >
          {running ? "삭제 중…" : "선택한 신청의 고객 파일 삭제"}
        </button>
      </div>
    </div>
  );
}

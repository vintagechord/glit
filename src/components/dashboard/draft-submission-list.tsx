"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { formatDateTime } from "@/lib/format";

export type DraftSubmissionItem = {
  id: string;
  type: string;
  status: string;
  title: string | null;
  artistName: string | null;
  updatedAt: string | null;
};

type DraftGroupType = "ALBUM" | "MV";
type FilterType = "ALL" | DraftGroupType;

const draftStatusMap: Record<string, { label: string; tone: string }> = {
  DRAFT: {
    label: "작성중",
    tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  },
  PRE_REVIEW: {
    label: "파일/결제 진행중",
    tone: "bg-[#f6d64a] text-black dark:text-black",
  },
};

const getDraftGroupType = (type: string): DraftGroupType =>
  type === "ALBUM" ? "ALBUM" : "MV";

const getTypeLabel = (type: DraftGroupType) =>
  type === "ALBUM" ? "앨범" : "뮤직비디오";

const getResumePath = (type: DraftGroupType) =>
  type === "ALBUM" ? "/dashboard/new/album" : "/dashboard/new/mv";

const buildDisplayTitle = (item: DraftSubmissionItem) => {
  const artist = item.artistName?.trim() || "아티스트 미입력";
  const album = item.title?.trim() || "앨범명 미입력";
  return `${artist}-${album}`;
};

const parseErrorMessage = async (response: Response) => {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return payload?.error || "삭제 처리 중 오류가 발생했습니다.";
};

export function DraftSubmissionList({
  userId,
  initialItems,
}: {
  userId: string;
  initialItems: DraftSubmissionItem[];
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<DraftSubmissionItem[]>(initialItems);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [filter, setFilter] = React.useState<FilterType>("ALL");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isDeleting, startDelete] = React.useTransition();

  const filteredItems =
    filter === "ALL"
      ? items
      : items.filter((item) => getDraftGroupType(item.type) === filter);

  const visibleIds = filteredItems.map((item) => item.id);
  const visibleSelectionCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const isAllVisibleSelected =
    visibleIds.length > 0 && visibleSelectionCount === visibleIds.length;

  const handleToggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleVisibleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleResume = (item: DraftSubmissionItem) => {
    const draftGroup = getDraftGroupType(item.type);
    if (typeof window !== "undefined") {
      try {
        if (draftGroup === "ALBUM") {
          window.localStorage.setItem(
            `onside:draft:album:${userId}`,
            JSON.stringify({
              ids: [item.id],
              guestToken: null,
              updatedAt: Date.now(),
            }),
          );
        } else {
          const mvStorageKey = `onside:draft:mv:${userId}`;
          const existingRaw = window.localStorage.getItem(mvStorageKey);
          const existing = existingRaw
            ? (JSON.parse(existingRaw) as {
                id?: string;
                mvType?: string;
                tvStations?: string[];
                onlineOptions?: string[];
                onlineBaseSelected?: boolean;
                emailSubmitConfirmed?: boolean;
              })
            : null;
          const shouldReuseExistingSelection =
            existing != null && existing.id === item.id;
          window.localStorage.setItem(
            mvStorageKey,
            JSON.stringify({
              id: item.id,
              guestToken: null,
              mvType: shouldReuseExistingSelection ? existing?.mvType : undefined,
              tvStations: shouldReuseExistingSelection ? existing?.tvStations : undefined,
              onlineOptions: shouldReuseExistingSelection
                ? existing?.onlineOptions
                : undefined,
              onlineBaseSelected: shouldReuseExistingSelection
                ? existing?.onlineBaseSelected
                : undefined,
              emailSubmitConfirmed: shouldReuseExistingSelection
                ? existing?.emailSubmitConfirmed
                : undefined,
              updatedAt: Date.now(),
            }),
          );
        }
      } catch {
        // ignore storage errors
      }
    }
    router.push(`${getResumePath(draftGroup)}?from=drafts`);
  };

  const handleDelete = () => {
    if (selectedIds.size === 0 || isDeleting) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("선택한 작성중 신청서를 삭제할까요?")
    ) {
      return;
    }

    startDelete(async () => {
      const selectedItems = items.filter((item) => selectedIds.has(item.id));
      if (selectedItems.length === 0) return;

      setNotice(null);

      const albumIds = selectedItems
        .filter((item) => getDraftGroupType(item.type) === "ALBUM")
        .map((item) => item.id);
      const mvIds = selectedItems
        .filter((item) => getDraftGroupType(item.type) === "MV")
        .map((item) => item.id);

      const deletedIds = new Set<string>();

      if (albumIds.length > 0) {
        try {
          const response = await fetch("/api/submissions/drafts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "ALBUM", ids: albumIds }),
          });

          if (!response.ok) {
            setNotice(await parseErrorMessage(response));
          } else {
            albumIds.forEach((id) => deletedIds.add(id));
          }
        } catch {
          setNotice("작성중 신청서 삭제 중 오류가 발생했습니다.");
        }
      }

      if (mvIds.length > 0) {
        try {
          const response = await fetch("/api/submissions/drafts", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "MV", ids: mvIds }),
          });

          if (!response.ok) {
            setNotice(await parseErrorMessage(response));
          } else {
            mvIds.forEach((id) => deletedIds.add(id));
          }
        } catch {
          setNotice("작성중 신청서 삭제 중 오류가 발생했습니다.");
        }
      }

      if (deletedIds.size === 0) {
        return;
      }

      setItems((prev) => prev.filter((item) => !deletedIds.has(item.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        deletedIds.forEach((id) => next.delete(id));
        return next;
      });
    });
  };

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-[28px] border border-dashed border-border/70 bg-background/70 px-5 py-7 text-sm text-muted-foreground">
          작성중 신청서가 없습니다.
        </div>
        <Link
          href="/dashboard/new"
          className="inline-flex rounded-full border border-border/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
        >
          새 신청서 작성
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            className={`rounded-full px-3 py-1 transition ${
              filter === "ALL"
                ? "bg-foreground text-background"
                : "border border-border/70 text-foreground hover:border-foreground"
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setFilter("ALBUM")}
            className={`rounded-full px-3 py-1 transition ${
              filter === "ALBUM"
                ? "bg-foreground text-background"
                : "border border-border/70 text-foreground hover:border-foreground"
            }`}
          >
            앨범
          </button>
          <button
            type="button"
            onClick={() => setFilter("MV")}
            className={`rounded-full px-3 py-1 transition ${
              filter === "MV"
                ? "bg-foreground text-background"
                : "border border-border/70 text-foreground hover:border-foreground"
            }`}
          >
            뮤직비디오
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleVisibleAll}
            className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
          >
            {isAllVisibleSelected ? "선택 해제" : "전체 선택"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={selectedIds.size === 0 || isDeleting}
            className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-700 transition hover:border-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            선택 삭제
          </button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs text-rose-700">
          {notice}
        </div>
      ) : null}

      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
            선택한 유형의 작성중 신청서가 없습니다.
          </div>
        ) : (
          filteredItems.map((item) => {
            const draftGroup = getDraftGroupType(item.type);
            const statusInfo =
              draftStatusMap[item.status] ?? {
                label: item.status,
                tone: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
              };
            return (
              <div
                key={item.id}
                className="grid gap-3 rounded-2xl border border-border/60 bg-card/80 px-4 py-3 md:grid-cols-[24px_1fr_auto] md:items-center"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => handleToggleItem(item.id)}
                  className="mt-1 h-4 w-4 rounded border-border md:mt-0"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {buildDisplayTitle(item)}
                    </p>
                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground">
                      {getTypeLabel(draftGroup)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${statusInfo.tone}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    최근 수정 {formatDateTime(item.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 md:justify-end">
                  <button
                    type="button"
                    onClick={() => handleResume(item)}
                    className="rounded-full bg-foreground px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-background transition hover:-translate-y-0.5 hover:bg-[#f6d64a] hover:text-black"
                  >
                    이어쓰기
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

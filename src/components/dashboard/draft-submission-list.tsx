"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { CheckSquare, CreditCard, FilePenLine, Plus, Trash2 } from "lucide-react";

import { showCenteredConfirm } from "@/lib/centered-dialog";
import { formatDateTime, formatShortDate } from "@/lib/format";

export type DraftSubmissionItem = {
  id: string;
  type: string;
  status: string;
  paymentStatus?: string | null;
  title: string | null;
  artistName: string | null;
  updatedAt: string | null;
};

type DraftGroupType = "ALBUM" | "MV";
type FilterType = "ALL" | DraftGroupType;

const filterButtonClass = (active: boolean) =>
  `inline-flex h-8 items-center justify-center rounded-[8px] border-2 px-3 text-[11px] font-black tracking-normal shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
    active
      ? "border-[var(--bauhaus-ink)] bg-[var(--foreground)] text-[var(--background)]"
      : "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]"
  }`;

const outlineControlClass =
  "inline-flex h-8 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-3 text-[11px] font-black tracking-normal text-[var(--foreground)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

const dangerControlClass =
  "inline-flex h-8 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] px-3 text-[11px] font-black tracking-normal text-white shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:text-[#06111f]";

const chipClass =
  "inline-flex min-h-7 items-center justify-center rounded-[6px] border-2 px-2.5 py-1 text-[11px] font-black leading-none tracking-normal shadow-[1.5px_1.5px_0_var(--bauhaus-shadow)]";

const getDraftGroupType = (type: string): DraftGroupType =>
  type === "ALBUM" ? "ALBUM" : "MV";

const getTypeLabel = (type: DraftGroupType) =>
  type === "ALBUM" ? "앨범" : "뮤직비디오";

const getResumePath = (type: DraftGroupType, localePrefix = "") =>
  type === "ALBUM"
    ? `${localePrefix}/dashboard/new/album`
    : `${localePrefix}/dashboard/new/mv`;

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
  const pathname = usePathname();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
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

  const handleResume = (item: DraftSubmissionItem, updatedAt: number) => {
    const draftGroup = getDraftGroupType(item.type);
    if (typeof window !== "undefined") {
      try {
        if (draftGroup === "ALBUM") {
          window.localStorage.setItem(
            `onside:draft:album:${userId}`,
            JSON.stringify({
              ids: [item.id],
              guestToken: null,
              updatedAt,
            }),
          );
        } else {
          const mvStorageKey = `onside:draft:mv:${userId}`;
          const existingRaw = window.localStorage.getItem(mvStorageKey);
          let existing: {
            id?: string;
            mvType?: string;
            tvStations?: string[];
            onlineOptions?: string[];
            onlineBaseSelected?: boolean;
            emailSubmitConfirmed?: boolean;
          } | null = null;
          if (existingRaw) {
            try {
              existing = JSON.parse(existingRaw) as {
                id?: string;
                mvType?: string;
                tvStations?: string[];
                onlineOptions?: string[];
                onlineBaseSelected?: boolean;
                emailSubmitConfirmed?: boolean;
              };
            } catch {
              existing = null;
            }
          }
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
              updatedAt,
            }),
          );
        }
      } catch {
        // ignore storage errors
      }
    }
    router.push(`${getResumePath(draftGroup, localePrefix)}?from=drafts`);
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0 || isDeleting) return;
    if (!(await showCenteredConfirm("선택한 작성중 신청서를 삭제할까요?"))) {
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
        <div className="rounded-[8px] border-2 border-dashed border-[var(--bauhaus-ink)] bg-[var(--background)] px-5 py-7 text-sm text-muted-foreground">
          작성중인 신청서가 없습니다.
        </div>
        <Link
          href={`${localePrefix}/dashboard/new`}
          className="inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] px-4 text-xs font-black tracking-normal text-[#111111] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5"
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
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
            className={filterButtonClass(filter === "ALL")}
          >
            전체 {items.length}
          </button>
          <button
            type="button"
            onClick={() => setFilter("ALBUM")}
            className={filterButtonClass(filter === "ALBUM")}
          >
            앨범 {items.filter((item) => getDraftGroupType(item.type) === "ALBUM").length}
          </button>
          <button
            type="button"
            onClick={() => setFilter("MV")}
            className={filterButtonClass(filter === "MV")}
          >
            MV {items.filter((item) => getDraftGroupType(item.type) === "MV").length}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleVisibleAll}
            className={outlineControlClass}
          >
            <CheckSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {isAllVisibleSelected ? "선택 해제" : "전체 선택"}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={selectedIds.size === 0 || isDeleting}
            className={dangerControlClass}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            선택 삭제
          </button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-[8px] border-2 border-[var(--bauhaus-red)] bg-[var(--background)] px-4 py-2 text-xs font-bold text-[var(--bauhaus-red)]">
          {notice}
        </div>
      ) : null}

      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <div className="rounded-[8px] border-2 border-dashed border-[var(--bauhaus-ink)] bg-[var(--background)] px-4 py-6 text-sm text-muted-foreground">
            해당 유형의 신청서가 없습니다.
          </div>
        ) : (
          filteredItems.map((item) => {
            const draftGroup = getDraftGroupType(item.type);
            const shouldOpenPayment =
              item.paymentStatus !== "PAID" &&
              !["DRAFT", "PRE_REVIEW"].includes(item.status);
            return (
              <div
                key={item.id}
                className="grid gap-3 rounded-[8px] border-2 border-border bg-[var(--card)] px-4 py-3 transition hover:border-[var(--bauhaus-ink)] md:grid-cols-[24px_1fr_auto] md:items-center"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => handleToggleItem(item.id)}
                  aria-label={`${buildDisplayTitle(item)} 선택`}
                  className="mt-1 h-4 w-4 rounded border-border accent-[var(--bauhaus-ink)] md:mt-0"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {buildDisplayTitle(item)}
                    </p>
                    <span className={`${chipClass} border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]`}>
                      {getTypeLabel(draftGroup)}
                    </span>
                  </div>
                  <p
                    className="mt-1 text-xs text-muted-foreground"
                    title={`최근 수정 ${formatDateTime(item.updatedAt)}`}
                    aria-label={`최근 수정 ${formatDateTime(item.updatedAt)}`}
                  >
                    {formatShortDate(item.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 md:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (shouldOpenPayment) {
                        router.push(`${localePrefix}/dashboard/pay/${item.id}`);
                        return;
                      }
                      handleResume(item, Date.now());
                    }}
                    className={`inline-flex h-8 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] px-3 text-[11px] font-black tracking-normal shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
                      shouldOpenPayment
                        ? "bg-[var(--bauhaus-red)] text-white hover:bg-[#b92d25] dark:text-[#06111f] dark:hover:bg-[#ff7a72]"
                        : "bg-[var(--foreground)] text-[var(--background)] hover:bg-[var(--bauhaus-yellow)] hover:text-[#111111]"
                    }`}
                  >
                    {shouldOpenPayment ? (
                      <CreditCard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <FilePenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {shouldOpenPayment ? "결제하기" : "이어쓰기"}
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

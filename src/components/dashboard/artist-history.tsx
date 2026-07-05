"use client";

import Image from "next/image";
import Link from "next/link";
import * as React from "react";

import { formatDate } from "@/lib/format";

type SubmissionItem = {
  id: string;
  title: string | null;
  status: string;
  payment_status?: string | null;
  created_at: string;
  updated_at: string | null;
  type: string;
};

type ArtistGroup = {
  artistId: string | null;
  artistName: string;
  thumbnail: string | null;
  submissions: SubmissionItem[];
};

type DeletePayload = {
  ok?: boolean;
  deletedIds?: string[];
  error?: string;
};

const stageTone: Record<string, string> = {
  "결제 대기": "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111]",
  "접수 완료": "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]",
  "결제 확인": "border-[var(--bauhaus-blue)] bg-[var(--bauhaus-blue)] text-white dark:text-[#06111f]",
  "심의 진행": "border-[var(--bauhaus-ink)] bg-[var(--foreground)] text-[var(--background)]",
  "결과 전달": "border-[var(--bauhaus-green)] bg-[var(--bauhaus-green)] text-white dark:text-[#06111f]",
};

const outlineControlClass =
  "inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-3 text-[11px] font-black tracking-normal text-[var(--foreground)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

const dangerControlClass =
  "inline-flex h-9 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] px-3 text-[11px] font-black tracking-normal text-white shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:text-[#06111f]";

const smallDangerControlClass =
  "inline-flex h-8 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] px-2.5 text-[11px] font-black tracking-normal text-white shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:text-[#06111f]";

const getStageLabel = (item: SubmissionItem) => {
  if (["RESULT_READY", "COMPLETED"].includes(item.status)) {
    return "결과 전달";
  }
  if (item.status === "IN_PROGRESS") {
    return "심의 진행";
  }
  if (item.payment_status === "PAYMENT_PENDING") {
    return "결제 대기";
  }
  if (item.payment_status !== "PAID") {
    return "결제 대기";
  }
  if (["SUBMITTED", "PRE_REVIEW"].includes(item.status)) {
    return "접수 완료";
  }
  if (item.payment_status === "PAID") {
    return "결제 확인";
  }
  return "접수 완료";
};

function StatusChip({ label }: { label: string }) {
  const tone =
    stageTone[label] ??
    "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]";
  return (
    <span className={`inline-flex min-h-7 items-center justify-center rounded-[6px] border-2 px-2.5 py-1 text-[11px] font-black leading-none tracking-normal shadow-[1.5px_1.5px_0_var(--bauhaus-shadow)] ${tone}`}>
      {label}
    </span>
  );
}

function Thumbnail({ name, src }: { name: string; src: string | null }) {
  const initial = (name || "A").trim().charAt(0).toUpperCase() || "A";
  if (!src) {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-lg font-black text-[#111111] shadow-[3px_3px_0_var(--bauhaus-shadow)]">
        {initial}
      </div>
    );
  }
  return (
    <div className="relative h-14 w-14 overflow-hidden rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] shadow-[3px_3px_0_var(--bauhaus-shadow)]">
      <Image src={src} alt={name} fill sizes="56px" unoptimized className="object-cover" />
    </div>
  );
}

function SubmissionManagementRow({
  item,
  selected,
  deleting,
  onToggleSelection,
  onDelete,
}: {
  item: SubmissionItem;
  selected: boolean;
  deleting: boolean;
  onToggleSelection: (id: string) => void;
  onDelete: (item: SubmissionItem) => void;
}) {
  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-[8px] border-2 px-3 py-2 text-sm transition sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${
        selected
          ? "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-panel)] shadow-[3px_3px_0_var(--bauhaus-shadow)]"
          : "border-border bg-[var(--background)] hover:border-[var(--bauhaus-ink)]"
      }`}
    >
      <label className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5">
        <span className="sr-only">
          {item.title || "제목 미입력"} 선택
        </span>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelection(item.id)}
          disabled={deleting}
          className="h-4 w-4 rounded border-border accent-[var(--bauhaus-ink)]"
        />
      </label>
      <Link
        href={`/dashboard/submissions/${encodeURIComponent(item.id)}`}
        prefetch={false}
        className="min-w-0"
      >
        <p className="truncate font-semibold text-foreground">
          {item.title || "제목 미입력"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          접수일 {formatDate(item.created_at)}
        </p>
      </Link>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-start-auto sm:justify-end">
        <StatusChip label={getStageLabel(item)} />
        <button
          type="button"
          onClick={() => onDelete(item)}
          disabled={deleting}
          className={smallDangerControlClass}
          aria-label={`${item.title || "제목 미입력"} 심의 내역 삭제`}
        >
          {deleting ? "삭제 중" : "삭제"}
        </button>
      </div>
    </div>
  );
}

const removeSubmissionsFromGroups = (
  groups: ArtistGroup[],
  submissionIds: Set<string>,
) =>
  groups
    .map((group) => ({
      ...group,
      submissions: group.submissions.filter((item) => !submissionIds.has(item.id)),
    }))
    .filter((group) => group.submissions.length > 0);

function ArtistCard({
  group,
  selectedIds,
  deletingIds,
  onToggleSelection,
  onDelete,
}: {
  group: ArtistGroup;
  selectedIds: Set<string>;
  deletingIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onDelete: (item: SubmissionItem) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--card)] p-4 shadow-[5px_5px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Thumbnail name={group.artistName} src={group.thumbnail} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">
              {group.artistName}
            </p>
            <p className="text-sm text-muted-foreground">총 {group.submissions.length}건 접수</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {group.artistId ? (
            <Link
              href={`/dashboard/artists/${group.artistId}`}
              className={`${outlineControlClass} whitespace-nowrap`}
            >
              아티스트 상세
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-3 space-y-2 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] p-3">
        {group.submissions.map((item) => (
          item.id ? (
            <SubmissionManagementRow
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              deleting={deletingIds.has(item.id)}
              onToggleSelection={onToggleSelection}
              onDelete={onDelete}
            />
          ) : (
            <div
              key={`${group.artistName}-${item.title ?? "unknown"}`}
              className="flex items-center justify-between gap-3 rounded-[8px] border-2 border-dashed border-[var(--bauhaus-red)] bg-[var(--background)] px-3 py-2 text-sm font-bold text-[var(--bauhaus-red)]"
            >
              <span className="truncate">
                ID가 없는 항목입니다. 관리자에게 문의해주세요.
              </span>
            </div>
          )
        ))}
      </div>
    </div>
  );
}

export function ArtistHistoryTabs({
  albumGroups,
  mvGroups,
}: {
  albumGroups: ArtistGroup[];
  mvGroups: ArtistGroup[];
}) {
  const initialTab =
    albumGroups.length > 0 ? "ALBUM" : mvGroups.length > 0 ? "MV" : "ALBUM";
  const [albumItems, setAlbumItems] = React.useState<ArtistGroup[]>(albumGroups);
  const [mvItems, setMvItems] = React.useState<ArtistGroup[]>(mvGroups);
  const [tab, setTab] = React.useState<"ALBUM" | "MV">(initialTab);
  const [deletingIds, setDeletingIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAlbumItems(albumGroups);
  }, [albumGroups]);

  React.useEffect(() => {
    setMvItems(mvGroups);
  }, [mvGroups]);

  React.useEffect(() => {
    const validIds = new Set(
      [...albumItems, ...mvItems].flatMap((group) =>
        group.submissions.map((item) => item.id),
      ),
    );
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [albumItems, mvItems]);

  React.useEffect(() => {
    setTab((prev) => {
      if (prev === "ALBUM" && albumItems.length === 0 && mvItems.length > 0) {
        return "MV";
      }
      if (prev === "MV" && mvItems.length === 0 && albumItems.length > 0) {
        return "ALBUM";
      }
      return prev;
    });
  }, [albumItems.length, mvItems.length]);

  const updateDeletedItems = React.useCallback((ids: Set<string>) => {
    setAlbumItems((prev) => removeSubmissionsFromGroups(prev, ids));
    setMvItems((prev) => removeSubmissionsFromGroups(prev, ids));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const deleteSubmissionIds = React.useCallback(
    async (ids: string[], successMessage: string) => {
      const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
      if (uniqueIds.length === 0) return;

      setNotice(null);
      setDeletingIds((prev) => {
        const next = new Set(prev);
        uniqueIds.forEach((id) => next.add(id));
        return next;
      });

      try {
        const response = await fetch("/api/submissions/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids: uniqueIds }),
        });
        const payload = (await response.json().catch(() => ({}))) as DeletePayload;
        const deletedIds = new Set(payload.deletedIds ?? []);

        if (!response.ok || deletedIds.size === 0) {
          setNotice(
            payload.error ??
              "심의 내역 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.",
          );
          return;
        }

        updateDeletedItems(deletedIds);
        setNotice(successMessage);
      } catch (error) {
        console.error(error);
        setNotice("심의 내역 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          uniqueIds.forEach((id) => next.delete(id));
          return next;
        });
      }
    },
    [updateDeletedItems],
  );

  const handleDelete = React.useCallback(async (item: SubmissionItem) => {
    if (!item.id || deletingIds.has(item.id)) return;
    const label = item.title || "제목 미입력";
    if (
      typeof window !== "undefined" &&
      !window.confirm(`"${label}" 심의 내역을 삭제할까요?`)
    ) {
      return;
    }

    await deleteSubmissionIds([item.id], "심의 내역을 삭제했습니다.");
  }, [deleteSubmissionIds, deletingIds]);

  const visibleIds = React.useMemo(
    () =>
      (tab === "ALBUM" ? albumItems : mvItems).flatMap((group) =>
        group.submissions.map((item) => item.id),
      ),
    [albumItems, mvItems, tab],
  );
  const selectedVisibleIds = React.useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)),
    [selectedIds, visibleIds],
  );
  const allVisibleSelected =
    visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;

  const toggleSelection = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleVisibleSelection = React.useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [allVisibleSelected, visibleIds]);

  const handleDeleteSelected = React.useCallback(async () => {
    const ids = selectedVisibleIds;
    if (ids.length === 0) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`선택한 심의 내역 ${ids.length}건을 삭제할까요?`)
    ) {
      return;
    }
    await deleteSubmissionIds(
      ids,
      `${ids.length}건의 심의 내역을 삭제했습니다.`,
    );
  }, [deleteSubmissionIds, selectedVisibleIds]);

  const groups = tab === "ALBUM" ? albumItems : mvItems;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <button
            type="button"
            onClick={() => setTab("ALBUM")}
            className={`inline-flex h-9 items-center justify-center rounded-[8px] border-2 px-4 text-[11px] font-black tracking-normal shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
              tab === "ALBUM"
                ? "border-[var(--bauhaus-ink)] bg-[var(--foreground)] text-[var(--background)]"
                : "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]"
            }`}
          >
            앨범
          </button>
          <button
            type="button"
            onClick={() => setTab("MV")}
            className={`inline-flex h-9 items-center justify-center rounded-[8px] border-2 px-4 text-[11px] font-black tracking-normal shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
              tab === "MV"
                ? "border-[var(--bauhaus-ink)] bg-[var(--foreground)] text-[var(--background)]"
                : "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]"
            }`}
          >
            뮤직비디오
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
          <button
            type="button"
            onClick={toggleVisibleSelection}
            disabled={visibleIds.length === 0}
            className={outlineControlClass}
          >
            {allVisibleSelected ? "전체 해제" : "전체 선택"}
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteSelected()}
            disabled={selectedVisibleIds.length === 0 || deletingIds.size > 0}
            className={dangerControlClass}
          >
            선택 삭제
            {selectedVisibleIds.length > 0 ? ` ${selectedVisibleIds.length}` : ""}
          </button>
        </div>
      </div>

      {notice ? (
        <div
          className="rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-4 py-3 text-sm font-bold text-[var(--foreground)] shadow-[3px_3px_0_var(--bauhaus-shadow)]"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-[8px] border-2 border-dashed border-[var(--bauhaus-ink)] bg-[var(--background)] px-4 py-6 text-sm text-muted-foreground">
          아직 접수된 내역이 없습니다.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <ArtistCard
              key={`${group.artistId ?? group.artistName}`}
              group={group}
              selectedIds={selectedIds}
              deletingIds={deletingIds}
              onToggleSelection={toggleSelection}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

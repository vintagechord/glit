"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  Check,
  CheckSquare,
  ExternalLink,
  LoaderCircle,
  Trash2,
} from "lucide-react";

import { showCenteredConfirm } from "@/lib/centered-dialog";
import { formatDate } from "@/lib/format";
import { brandStatusTones } from "@/lib/brand-status-tones";

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
  "임시 저장": brandStatusTones.neutral,
  "접수예정": brandStatusTones.warning,
  "자료 확인 중": brandStatusTones.warning,
  "심의 진행": brandStatusTones.progress,
  "결과 확인 가능": brandStatusTones.success,
  "심의 완료": brandStatusTones.success,
};

const outlineControlClass =
  "inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] px-3 text-[11px] font-black tracking-normal text-[var(--foreground)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

const dangerControlClass =
  "inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] px-3 text-[11px] font-black tracking-normal text-white shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-[var(--background)] disabled:text-[var(--foreground)] disabled:opacity-100 disabled:shadow-none disabled:hover:translate-y-0 dark:text-[#06111f]";

const smallDangerControlClass =
  "inline-flex h-11 w-11 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] text-white shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-[var(--background)] disabled:text-[var(--foreground)] disabled:opacity-100 disabled:shadow-none disabled:hover:translate-y-0 dark:text-[#06111f]";

const getStageLabel = (item: SubmissionItem) => {
  return ({
    DRAFT: "임시 저장", SUBMITTED: "접수예정", PRE_REVIEW: "접수예정",
    WAITING_PAYMENT: "접수예정", IN_PROGRESS: "심의 진행",
    RESULT_READY: "결과 확인 가능", COMPLETED: "심의 완료",
  } as Record<string, string>)[item.status] ?? "접수예정";
};

function StatusChip({ label, href }: { label: string; href: string }) {
  const tone =
    stageTone[label] ??
    "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]";
  return (
    <Link href={href} prefetch={false} className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-[8px] border-2 px-3 py-2 text-center text-xs font-black leading-4 tracking-normal shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${tone}`}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </Link>
  );
}

function Thumbnail({ name, src }: { name: string; src: string | null }) {
  const initial = (name || "A").trim().charAt(0).toUpperCase() || "A";
  if (!src) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-lg font-black text-[#111111] shadow-[3px_3px_0_var(--bauhaus-shadow)]">
        {initial}
      </div>
    );
  }
  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--background)] shadow-[3px_3px_0_var(--bauhaus-shadow)]">
      <Image data-no-translate-attributes="alt" src={src} alt={name} fill sizes="56px" unoptimized className="object-cover" />
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
  const pathname = usePathname();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";
  const [prefetchDetail, setPrefetchDetail] = React.useState(false);
  const detailHref = `${localePrefix}/dashboard/submissions/${encodeURIComponent(item.id)}`;
  return (
    <div
      role="group"
      aria-label={item.title || "제목 미입력"}
      data-no-translate-attributes={item.title ? "aria-label" : undefined}
      className={`grid grid-cols-[44px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 border-t border-black/15 px-2 py-3 text-sm transition dark:border-white/15 ${
        selected
          ? "rounded-[8px] bg-[var(--bauhaus-yellow)] text-[#111111] shadow-[2px_2px_0_var(--bauhaus-shadow)]"
          : "rounded-[8px] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      }`}
    >
      <label
        className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] border-2 border-[var(--bauhaus-ink)] shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
          selected
            ? "bg-[var(--foreground)] text-[var(--background)]"
            : "bg-[var(--background)] text-[var(--foreground)]"
        }`}
      >
        <span className="sr-only">
          {item.title || "제목 미입력"} 선택
        </span>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelection(item.id)}
          disabled={deleting}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={`flex h-5 w-5 items-center justify-center rounded-[4px] border-2 text-[13px] font-black leading-none transition peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--bauhaus-blue)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--background)] peer-disabled:opacity-50 ${
            selected
              ? "border-[var(--background)] bg-[var(--foreground)] text-[var(--background)]"
              : "border-[var(--bauhaus-ink)] bg-[var(--card)] text-transparent"
          }`}
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      </label>
      <div className="flex min-w-0 items-start justify-end gap-2">
        <StatusChip label={getStageLabel(item)} href={detailHref} />
        <button
          type="button"
          onClick={() => onDelete(item)}
          disabled={deleting}
          className={`${smallDangerControlClass} shrink-0`}
          aria-label={`${item.title || "제목 미입력"} 심의 내역 삭제`}
          title="삭제"
        >
          {deleting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <Link
        href={detailHref}
        prefetch={prefetchDetail ? true : false}
        onMouseEnter={() => setPrefetchDetail(true)}
        onFocus={() => setPrefetchDetail(true)}
        className="col-span-2 flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        <p className={`font-semibold leading-6 [overflow-wrap:anywhere] ${selected ? "text-[#111111]" : "text-foreground"}`}>
          {item.title ? <span data-no-translate>{item.title}</span> : "제목 미입력"}
        </p>
        <p className={`text-xs ${selected ? "text-[#111111]" : "text-muted-foreground"}`}>
          {formatDate(item.created_at)}
        </p>
      </Link>
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
  const pathname = usePathname();
  const localePrefix =
    pathname === "/en" || pathname.startsWith("/en/") ? "/en" : "";

  return (
    <div className="@container min-w-0 rounded-[8px] border-2 border-[var(--bauhaus-ink)] bg-[var(--card)] p-4 shadow-[5px_5px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5">
      <div className="grid gap-3 @sm:grid-cols-[minmax(0,1fr)_auto] @sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <Thumbnail name={group.artistName} src={group.thumbnail} />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <p className="text-base font-semibold leading-6 text-foreground [overflow-wrap:anywhere]">
              <span data-no-translate>{group.artistName}</span>
            </p>
            <span className="shrink-0 rounded-full border border-[#111111] bg-[var(--bauhaus-yellow)] px-2 py-0.5 text-[11px] font-black text-[#111111]">
              {group.submissions.length}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 @sm:justify-end">
          {group.artistId ? (
            <Link
              href={`${localePrefix}/dashboard/artists/${encodeURIComponent(group.artistId)}`}
              className={`${outlineControlClass} whitespace-nowrap`}
            >
              상세
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-4">
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
              className="flex items-center justify-between gap-3 border-t border-red-500/40 py-3 text-sm font-bold text-[var(--bauhaus-red)]"
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
        const response = await fetchWithTimeout("/api/submissions/delete", {
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
    if (!(await showCenteredConfirm(`"${label}" 심의 내역을 삭제할까요?`))) {
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
      !(await showCenteredConfirm(
        `선택한 심의 내역 ${ids.length}건을 삭제할까요?`,
      ))
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
            className={`inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 px-4 text-[11px] font-black tracking-normal shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
              tab === "ALBUM"
                ? "border-[var(--bauhaus-ink)] bg-[var(--foreground)] text-[var(--background)]"
                : "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]"
            }`}
          >
            앨범 {albumItems.reduce((count, group) => count + group.submissions.length, 0)}
          </button>
          <button
            type="button"
            onClick={() => setTab("MV")}
            className={`inline-flex min-h-11 items-center justify-center rounded-[8px] border-2 px-4 text-[11px] font-black tracking-normal shadow-[2px_2px_0_var(--bauhaus-shadow)] transition hover:-translate-y-0.5 ${
              tab === "MV"
                ? "border-[var(--bauhaus-ink)] bg-[var(--foreground)] text-[var(--background)]"
                : "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]"
            }`}
          >
            MV {mvItems.reduce((count, group) => count + group.submissions.length, 0)}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
          <button
            type="button"
            onClick={toggleVisibleSelection}
            disabled={visibleIds.length === 0}
            className={outlineControlClass}
          >
            <CheckSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {allVisibleSelected ? "전체 해제" : "전체 선택"}
          </button>
          <button
            type="button"
            onClick={() => void handleDeleteSelected()}
            disabled={selectedVisibleIds.length === 0 || deletingIds.size > 0}
            className={dangerControlClass}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            삭제
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
          심의 내역이 없습니다.
        </div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
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

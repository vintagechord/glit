"use client";

import Link from "next/link";
import * as React from "react";

import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

type HistoryItem = {
  id: string;
  order: number;
  title: string;
  artistName: string;
  typeLabel: string;
  createdAt: string | null;
  status: { label: string; tone: string };
  payment: { label: string; tone: string };
  showPaymentChip: boolean;
};

export function HistoryList({ initialItems }: { initialItems: HistoryItem[] }) {
  const supabase = React.useMemo(() => createClient(), []);
  const [items, setItems] = React.useState<HistoryItem[]>(initialItems);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isDeleting, startDelete] = React.useTransition();

  const toggleSelection = (id: string) => {
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

  const handleDelete = () => {
    if (selectedIds.size === 0 || isDeleting) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("선택한 심의 내역을 삭제할까요?")
    ) {
      return;
    }

    startDelete(async () => {
      setNotice(null);
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("submissions").delete().in("id", ids);

      if (error) {
        setNotice("선택한 내역 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }

      setItems((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
    });
  };

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-xs text-muted-foreground">
        아직 접수된 내역이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={selectedIds.size === 0 || isDeleting}
          className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          선택 삭제
        </button>
      </div>
      {notice && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-600">
          {notice}
        </div>
      )}
      {items.map((submission) => (
        <div
          key={submission.id}
          className="grid items-center gap-4 rounded-2xl border border-border/60 bg-card/80 px-4 py-3 text-sm transition hover:border-foreground md:grid-cols-[28px_28px_1fr_auto]"
        >
          <input
            type="checkbox"
            checked={selectedIds.has(submission.id)}
            onChange={() => toggleSelection(submission.id)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-xs text-muted-foreground">
            {submission.order}
          </span>
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-200/70 via-white/40 to-indigo-200/60 text-xs font-semibold text-foreground">
              ONS
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {submission.title}
                </p>
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${submission.status.tone}`}
                >
                  {submission.status.label}
                </span>
                {submission.showPaymentChip && (
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${submission.payment.tone}`}
                  >
                    {submission.payment.label}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {submission.artistName} · {submission.typeLabel} ·{" "}
                {formatDateTime(submission.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <Link
              href={`/dashboard/submissions/${submission.id}`}
              className="rounded-full border border-border/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground transition hover:border-foreground"
            >
              상세보기
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

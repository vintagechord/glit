"use client";

import Image from "next/image";
import Link from "next/link";
import * as React from "react";

import { formatDate } from "@/lib/format";

type SubmissionItem = {
  id: string;
  title: string | null;
  status: string;
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

const statusTone: Record<string, string> = {
  DRAFT: "bg-slate-500/15 text-slate-700 dark:text-slate-200",
  SUBMITTED: "bg-sky-500/15 text-sky-700 dark:text-sky-200",
  PRE_REVIEW: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  WAITING_PAYMENT: "bg-amber-500/15 text-amber-700 dark:text-amber-200",
  IN_PROGRESS: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-200",
  RESULT_READY: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-200",
};

function StatusChip({ value }: { value: string }) {
  const tone = statusTone[value] ?? "bg-border/60 text-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${tone}`}>
      {value}
    </span>
  );
}

function Thumbnail({ name, src }: { name: string; src: string | null }) {
  const initial = (name || "A").trim().charAt(0).toUpperCase() || "A";
  if (!src) {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-200 via-lime-200 to-emerald-400 text-lg font-bold text-emerald-900 shadow-inner">
        {initial}
      </div>
    );
  }
  return (
    <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-border/70 bg-background">
      <Image src={src} alt={name} fill className="object-cover" />
    </div>
  );
}

function ArtistCard({ group }: { group: ArtistGroup }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-[28px] border border-border/60 bg-card/80 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.12)] transition hover:border-foreground/70">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3">
          <Thumbnail name={group.artistName} src={group.thumbnail} />
          <div>
            <p className="text-base font-semibold text-foreground">{group.artistName}</p>
            <p className="text-xs text-muted-foreground">총 {group.submissions.length}건 접수</p>
          </div>
        </div>
        <span className="rounded-full border border-border/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {open ? "접기" : "보기"}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2 rounded-2xl border border-border/60 bg-background/70 p-3">
          {group.submissions.map((item) => (
            <Link
              key={item.id}
              href={`/admin/submissions/detail?id=${item.id}`}
              prefetch={false}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-sm transition hover:border-foreground"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">
                  {item.title || "제목 미입력"}
                </p>
                <p className="text-xs text-muted-foreground">
                  접수일 {formatDate(item.created_at)}
                </p>
              </div>
              <StatusChip value={item.status} />
            </Link>
          ))}
        </div>
      )}
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
  const [tab, setTab] = React.useState<"ALBUM" | "MV">("ALBUM");
  const groups = tab === "ALBUM" ? albumGroups : mvGroups;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <button
          type="button"
          onClick={() => setTab("ALBUM")}
          className={`rounded-full px-4 py-2 transition ${
            tab === "ALBUM"
              ? "bg-foreground text-background"
              : "border border-border/70 text-foreground hover:border-foreground"
          }`}
        >
          앨범
        </button>
        <button
          type="button"
          onClick={() => setTab("MV")}
          className={`rounded-full px-4 py-2 transition ${
            tab === "MV"
              ? "bg-foreground text-background"
              : "border border-border/70 text-foreground hover:border-foreground"
          }`}
        >
          뮤직비디오
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
          아직 접수된 내역이 없습니다.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <ArtistCard key={`${group.artistId ?? group.artistName}`} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

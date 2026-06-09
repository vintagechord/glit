"use client";

import Link from "next/link";
import * as React from "react";
import { ArrowRight, KeyRound, UserCheck } from "lucide-react";

import { TrackLookupForm } from "@/features/track/track-lookup-form";

type LookupMode = "member" | "guest" | null;

export function TrackLookupSelector({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [mode, setMode] = React.useState<LookupMode>(null);
  const memberHref = isLoggedIn
    ? "/dashboard"
    : `/login?next=${encodeURIComponent("/dashboard")}`;
  const historyHref = isLoggedIn
    ? "/dashboard/history"
    : `/login?next=${encodeURIComponent("/dashboard/history")}`;

  const optionClass = (active: boolean) =>
    [
      "flex min-h-[172px] flex-col justify-between rounded-[10px] border-2 p-5 text-left transition",
      active
        ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[6px_6px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-none"
        : "border-border bg-card text-foreground hover:border-[#111111] hover:shadow-[4px_4px_0_#111111] dark:hover:border-[#f2cf27] dark:hover:shadow-[4px_4px_0_#f2cf27]",
    ].join(" ");

  return (
    <div className="mt-8 space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("member")}
          className={optionClass(mode === "member")}
        >
          <span className="flex items-start justify-between gap-4">
            <span>
              <span className="text-[11px] font-black uppercase tracking-normal opacity-70">
                Member
              </span>
              <span className="mt-2 block text-xl font-black">회원 조회</span>
            </span>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white text-[#111111]">
              <UserCheck size={22} strokeWidth={2.6} />
            </span>
          </span>
          <span className="mt-4 block text-sm font-semibold leading-6 opacity-80">
            로그인한 계정의 접수 현황과 심의 내역을 바로 확인합니다.
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMode("guest")}
          className={optionClass(mode === "guest")}
        >
          <span className="flex items-start justify-between gap-4">
            <span>
              <span className="text-[11px] font-black uppercase tracking-normal opacity-70">
                Guest
              </span>
              <span className="mt-2 block text-xl font-black">비회원 조회</span>
            </span>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white text-[#111111]">
              <KeyRound size={22} strokeWidth={2.6} />
            </span>
          </span>
          <span className="mt-4 block text-sm font-semibold leading-6 opacity-80">
            접수 시 발급받은 조회 코드 또는 이름/이메일로 진행 결과를 확인합니다.
          </span>
        </button>
      </div>

      {mode === "member" ? (
        <div className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
            회원 진행/결과 조회
          </p>
          <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">
            {isLoggedIn
              ? "접수 현황에서는 현재 진행 상태를, 심의 내역에서는 완료된 접수까지 모아서 확인할 수 있습니다."
              : "회원 접수 내역은 로그인 후 확인할 수 있습니다."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={memberHref}
              className="bauhaus-button inline-flex items-center gap-2 px-4 py-3 text-xs uppercase"
            >
              접수 현황 보기
              <ArrowRight size={15} strokeWidth={2.8} />
            </Link>
            <Link
              href={historyHref}
              className="inline-flex items-center gap-2 rounded-[8px] border-2 border-border px-4 py-3 text-xs font-black uppercase tracking-normal text-foreground transition hover:border-[#111111] hover:bg-[#111111] hover:text-white dark:hover:border-[#f2cf27] dark:hover:bg-[#f2cf27] dark:hover:text-[#111111]"
            >
              심의 내역 보기
              <ArrowRight size={15} strokeWidth={2.8} />
            </Link>
          </div>
        </div>
      ) : null}

      {mode === "guest" ? (
        <div className="rounded-[10px] border-2 border-[#111111] bg-card p-5 shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:shadow-[5px_5px_0_#f2cf27]">
          <p className="text-[11px] font-black uppercase tracking-normal text-muted-foreground">
            비회원 진행/결과 조회
          </p>
          <TrackLookupForm />
        </div>
      ) : null}
    </div>
  );
}

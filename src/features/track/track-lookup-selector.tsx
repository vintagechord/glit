"use client";

import Link from "next/link";
import { KeyRound, UserCheck } from "lucide-react";
import { usePathname } from "next/navigation";

export function TrackLookupSelector() {
  const pathname = usePathname();
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const memberHref = isEnglishRoute
    ? `/en/login?next=${encodeURIComponent("/en/dashboard")}`
    : `/login?next=${encodeURIComponent("/dashboard")}`;
  const guestHref = isEnglishRoute ? "/en/track?mode=guest" : "/track?mode=guest";
  const optionClass =
    "flex min-h-[172px] flex-col justify-between rounded-[10px] border-2 border-border bg-card p-5 text-left text-foreground transition hover:border-[#111111] hover:shadow-[4px_4px_0_#111111] dark:hover:border-[#f2cf27] dark:hover:shadow-[4px_4px_0_#f2cf27]";

  return (
    <div className="mt-8 space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href={memberHref}
          className={optionClass}
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
            로그인한 계정의 접수 현황과 심의 내역으로 이동합니다.
          </span>
        </Link>

        <Link
          href={guestHref}
          className={optionClass}
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
        </Link>
      </div>
    </div>
  );
}

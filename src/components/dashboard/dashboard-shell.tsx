import type { ReactNode } from "react";
import Link from "next/link";

export type DashboardTab = { key: string; label: string; href: string };

export const defaultDashboardTabs: DashboardTab[] = [
  { key: "status", label: "접수현황", href: "/mypage" },
  { key: "drafts", label: "작성중 신청서", href: "/mypage/drafts" },
  { key: "history", label: "나의 심의 내역", href: "/mypage/history" },
  { key: "credits", label: "크레딧", href: "/mypage/credits" },
  { key: "profile", label: "계정정보", href: "/mypage/profile" },
];

export const statusDashboardTabs: DashboardTab[] = [
  { key: "history", label: "나의 심의 내역", href: "/dashboard/history" },
];

export function DashboardShell({
  title,
  description,
  activeTab,
  action,
  children,
  tabs,
  contextLabel = "마이페이지",
}: {
  title: string;
  description?: string;
  activeTab: string;
  action?: ReactNode;
  children: ReactNode;
  tabs?: DashboardTab[];
  contextLabel?: string;
}) {
  const tabList = tabs ?? defaultDashboardTabs;
  const shouldRenderTabs = tabList.length > 1;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="relative flex flex-wrap items-start justify-between gap-4 border-b-2 border-[#111111] pb-6 dark:border-[#f2cf27]">
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 hidden h-4 w-28 bg-[#1556a4] sm:block"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-28 hidden h-4 w-12 bg-[#d9362c] sm:block"
        />
        <div className="flex flex-col gap-3">
          <div>
            <p className="bauhaus-kicker">
              {contextLabel}
            </p>
            <h1 className="font-display mt-4 text-2xl font-black leading-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex items-center gap-3">{action}</div> : null}
      </div>

      {shouldRenderTabs ? (
        <nav className="mt-5 flex w-full items-center gap-2 overflow-x-auto text-xs font-black uppercase tracking-normal text-muted-foreground scrollbar-none sm:mt-6 sm:inline-flex sm:w-auto sm:flex-wrap">
          {tabList.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`shrink-0 rounded-[8px] border-2 px-4 py-2 transition ${
                activeTab === tab.key
                  ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
                  : "border-border bg-card text-muted-foreground hover:border-[#111111] hover:text-foreground dark:hover:border-[#f2cf27]"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mt-8">{children}</div>
    </div>
  );
}

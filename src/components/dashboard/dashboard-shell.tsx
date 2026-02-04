import type { ReactNode } from "react";
import Link from "next/link";

export type DashboardTab = { key: string; label: string; href: string };

export const defaultDashboardTabs: DashboardTab[] = [
  { key: "status", label: "접수현황", href: "/mypage" },
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
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
              {contextLabel}
            </p>
            <h1 className="font-display mt-2 text-3xl text-foreground">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex items-center gap-3">{action}</div> : null}
      </div>

      {shouldRenderTabs ? (
        <nav className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-full bg-muted/60 p-1 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {tabList.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`rounded-full px-4 py-2 transition ${
                activeTab === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
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

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Coins,
  FilePenLine,
  History,
  ShoppingCart,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type DashboardTab = { key: string; label: string; href: string };

export const defaultDashboardTabs: DashboardTab[] = [
  { key: "status", label: "접수현황", href: "/mypage" },
  { key: "drafts", label: "작성중", href: "/mypage/drafts" },
  { key: "cart", label: "장바구니", href: "/mypage/cart" },
  { key: "history", label: "심의내역", href: "/mypage/history" },
  { key: "credits", label: "크레딧", href: "/mypage/credits" },
  { key: "profile", label: "계정", href: "/mypage/profile" },
];

export const statusDashboardTabs: DashboardTab[] = [
  { key: "history", label: "심의내역", href: "/dashboard/history" },
];

const prefixTabHrefs = (tabs: DashboardTab[], prefix: string) =>
  tabs.map((tab) => ({
    ...tab,
    href: `${prefix}${tab.href}`,
  }));

export const englishDefaultDashboardTabs: DashboardTab[] = prefixTabHrefs(
  [
    { key: "status", label: "Status", href: "/mypage" },
    { key: "drafts", label: "Drafts", href: "/mypage/drafts" },
    { key: "cart", label: "Cart", href: "/mypage/cart" },
    { key: "history", label: "History", href: "/mypage/history" },
    { key: "credits", label: "Credits", href: "/mypage/credits" },
    { key: "profile", label: "Account", href: "/mypage/profile" },
  ],
  "/en",
);
export const englishStatusDashboardTabs: DashboardTab[] = prefixTabHrefs(
  [{ key: "history", label: "History", href: "/dashboard/history" }],
  "/en",
);

const tabIcons: Record<string, LucideIcon> = {
  status: ClipboardList,
  drafts: FilePenLine,
  cart: ShoppingCart,
  history: History,
  credits: Coins,
  profile: UserRound,
};

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
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-9">
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#111111] pb-4 dark:border-[#f2cf27]">
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 hidden h-4 w-28 bg-[#1556a4] sm:block"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-28 hidden h-4 w-12 bg-[#d9362c] sm:block"
        />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground">
              {contextLabel}
            </span>
            <span aria-hidden="true" className="text-muted-foreground/50">/</span>
            <h1 className="font-display min-w-0 text-2xl font-black leading-tight text-foreground sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="w-full max-w-2xl text-sm font-semibold leading-5 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex items-center gap-3">{action}</div> : null}
      </div>

      {shouldRenderTabs ? (
        <nav
          aria-label={contextLabel}
          className="mt-4 flex w-full items-center gap-2 overflow-x-auto pb-1 text-xs font-black text-muted-foreground scrollbar-none sm:inline-flex sm:w-auto sm:flex-wrap"
        >
          {tabList.map((tab) => {
            const Icon = tabIcons[tab.key];
            return (
              <Link
                key={tab.key}
                href={tab.href}
                aria-current={activeTab === tab.key ? "page" : undefined}
                className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[8px] border-2 px-3 py-2 transition ${
                  activeTab === tab.key
                    ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
                    : "border-border bg-card text-muted-foreground hover:border-[#111111] hover:text-foreground dark:hover:border-[#f2cf27]"
                }`}
              >
                {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
                {tab.label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      <div className="mt-6">{children}</div>
    </div>
  );
}

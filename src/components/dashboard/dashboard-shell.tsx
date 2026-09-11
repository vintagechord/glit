import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Coins,
  FilePenLine,
  History,
  Music2,
  ReceiptText,
  ShoppingCart,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type DashboardTab = { key: string; label: string; href: string };

export const defaultDashboardTabs: DashboardTab[] = [
  { key: "status", label: "접수현황", href: "/mypage" },
  { key: "history", label: "심의내역", href: "/mypage/history" },
  { key: "drafts", label: "작성중", href: "/mypage/drafts" },
  { key: "cart", label: "장바구니", href: "/mypage/cart" },
  { key: "orders", label: "주문내역", href: "/mypage/orders" },
  { key: "music", label: "내 음악 관리", href: "/mypage/music" },
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
    { key: "history", label: "History", href: "/mypage/history" },
    { key: "drafts", label: "Drafts", href: "/mypage/drafts" },
    { key: "cart", label: "Cart", href: "/mypage/cart" },
    { key: "orders", label: "Orders", href: "/mypage/orders" },
    { key: "music", label: "My Music", href: "/mypage/music" },
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
  orders: ReceiptText,
  history: History,
  music: Music2,
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
  const english = tabList.some((tab) => tab.href.startsWith("/en/"));
  const groups = [
    { key: "review", label: english ? "Applications & Reviews" : "접수 · 심의", keys: ["status", "history", "drafts"] },
    { key: "payment", label: english ? "Payments" : "결제 · 주문", keys: ["cart", "orders"] },
    { key: "music", label: english ? "Music & Credits" : "음악 · 크레딧", keys: ["music", "credits"] },
    { key: "account", label: english ? "Account" : "내 계정", keys: ["profile"] },
  ];
  const knownKeys = new Set(groups.flatMap((group) => group.keys));
  const navigationGroups = groups.map((group) => ({
    ...group,
    tabs: group.keys.flatMap((key) => tabList.filter((tab) => tab.key === key)),
  })).filter((group) => group.tabs.length > 0);
  const otherTabs = tabList.filter((tab) => !knownKeys.has(tab.key));
  if (otherTabs.length) navigationGroups.push({ key: "other", label: english ? "More" : "기타", keys: [], tabs: otherTabs });

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
          className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-[1.5fr_1fr_1fr_0.65fr]"
        >
          {navigationGroups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-1.5 rounded-xl border border-border bg-card/60 p-2.5 sm:block sm:p-3">
              <p className="px-1 pt-3 text-[11px] font-bold tracking-wide text-muted-foreground sm:mb-2 sm:pt-0">{group.label}</p>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {group.tabs.map((tab) => {
                  const Icon = tabIcons[tab.key];
                  return (
                    <Link
                      key={tab.key}
                      href={tab.href}
                      aria-current={activeTab === tab.key ? "page" : undefined}
                      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                        activeTab === tab.key
                          ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[2px_2px_0_#111111] dark:border-[#f2cf27] dark:shadow-none"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
                      }`}
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                      {tab.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      ) : null}

      <div className="mt-6">{children}</div>
    </div>
  );
}

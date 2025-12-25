import Link from "next/link";

import { ThemeToggle } from "./theme-toggle";

const navLinks = [
  { label: "음반심의", href: "/guide?tab=album" },
  { label: "M/V심의", href: "/guide?tab=mv" },
  { label: "심의접수", href: "/dashboard/new" },
  { label: "진행상황", href: "/dashboard" },
  { label: "노래방 요청", href: "/karaoke-request" },
  { label: "신청서", href: "/forms" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-lg font-semibold tracking-[0.3em] text-foreground"
          >
            ONSIDE
          </Link>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="transition hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden text-sm text-muted-foreground transition hover:text-foreground sm:inline-flex"
          >
            로그인
          </Link>
          <Link
            href="/dashboard/new"
            className="inline-flex items-center rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-foreground/90"
          >
            온라인 심의 신청
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-4 overflow-x-auto border-t border-border/50 px-6 py-2 text-xs text-muted-foreground md:hidden">
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} className="whitespace-nowrap">
            {link.label}
          </Link>
        ))}
      </div>
    </header>
  );
}

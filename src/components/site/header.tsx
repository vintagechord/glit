import Link from "next/link";

import { APP_CONFIG } from "@/lib/config";
import { createServerSupabase } from "@/lib/supabase/server";

import { ThemeToggle } from "./theme-toggle";

const navLinks = [
  { label: "심의 신청", href: "/dashboard/new" },
  { label: "진행상황", href: "/dashboard" },
  { label: "노래방 등록", href: "/karaoke-request" },
  { label: "이메일 접수", href: "/forms", badge: "Legacy" },
];

export async function SiteHeader() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2">
            {APP_CONFIG.logoPath ? (
              <>
                <img
                  src={APP_CONFIG.logoPath}
                  alt="Onside"
                  className="h-7 w-auto transition dark:invert dark:brightness-200"
                />
                <span className="sr-only">Onside</span>
              </>
            ) : (
              <span className="text-lg font-semibold tracking-[0.3em] text-foreground">
                ONSIDE
              </span>
            )}
          </Link>
          <nav className="hidden items-center gap-3 text-base font-semibold text-foreground/80 md:flex">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group flex items-center gap-2 rounded-full px-3 py-1 transition hover:bg-white hover:text-slate-900"
              >
                <span>{link.label}</span>
                {"badge" in link && link.badge ? (
                  <span className="rounded-full border border-black/20 bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/70 transition group-hover:text-slate-900">
                    {link.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <>
              <form action="/logout" method="post" className="hidden sm:block">
                <button
                  type="submit"
                  className="rounded-full border border-transparent bg-transparent px-3 py-1 text-sm font-semibold text-foreground transition hover:border-black/40 hover:bg-[#f05a28] hover:text-black dark:text-white"
                >
                  로그아웃
                </button>
              </form>
              <Link
                href="/dashboard"
                className="hidden rounded-full border border-transparent bg-transparent px-3 py-1 text-sm font-semibold text-foreground transition hover:border-black/40 hover:bg-[#f05a28] hover:text-black dark:text-white sm:inline-flex"
              >
                마이페이지
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="hidden text-sm text-muted-foreground transition hover:text-foreground sm:inline-flex"
            >
              로그인
            </Link>
          )}
          <Link
            href="/dashboard/new"
            className="inline-flex items-center rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:-translate-y-0.5 hover:bg-amber-200 hover:text-slate-900"
          >
            심의 신청
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto border-t border-border/50 px-6 py-3 text-sm font-semibold text-muted-foreground md:hidden">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 transition hover:bg-white hover:text-slate-900"
          >
            <span>{link.label}</span>
            {"badge" in link && link.badge ? (
            <span className="rounded-full border border-black/20 bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/70 transition group-hover:text-slate-900">
              {link.badge}
            </span>
            ) : null}
          </Link>
        ))}
      </div>
    </header>
  );
}

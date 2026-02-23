import Link from "next/link";

import { createServerSupabase } from "@/lib/supabase/server";

import { ThemeToggle } from "./theme-toggle";
import { SiteLogo } from "./site-logo";

const primaryLinkClass =
  "group flex items-center gap-2 rounded-full border border-transparent bg-foreground/6 px-3.5 py-1.5 text-sm font-semibold text-foreground/80 transition hover:bg-foreground/12 dark:border-white/5 dark:bg-white/5 dark:text-white/85 dark:hover:border-white/15 dark:hover:bg-white/12";
const mobileLinkClass =
  "group flex items-center gap-2 whitespace-nowrap rounded-full border border-transparent bg-foreground/6 px-3.5 py-1.5 text-sm font-semibold text-foreground/80 transition hover:bg-foreground/12 dark:border-white/5 dark:bg-white/5 dark:text-white/85 dark:hover:border-white/15 dark:hover:bg-white/12";
const ghostButtonClass =
  "rounded-full border border-border/70 bg-foreground/5 px-3.5 py-1.5 text-sm font-semibold text-foreground whitespace-nowrap shrink-0 transition hover:bg-foreground/12 dark:border-white/10 dark:bg-white/5 dark:text-white/90 dark:hover:border-white/20 dark:hover:bg-white/12";

const navLinks = [
  { label: "심의 신청", href: "/dashboard/new" },
  { label: "노래방 등록", href: "/karaoke-request" },
  { label: "이메일 접수", href: "/forms", badge: "Legacy" },
];

export async function SiteHeader() {
  const supabase = await createServerSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-md dark:border-white/10 dark:bg-[#0f1727]/78">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <div className="flex items-center gap-4">
          <SiteLogo />
          <nav className="hidden items-center gap-3 text-base font-semibold text-foreground/80 md:flex">
            <Link
              href={navLinks[0].href}
              className={primaryLinkClass}
            >
              <span>{navLinks[0].label}</span>
            </Link>
            <Link
              href="/dashboard"
              className={primaryLinkClass}
            >
              <span>진행상황</span>
            </Link>
            {navLinks.slice(1).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={primaryLinkClass}
              >
                <span>{link.label}</span>
                {"badge" in link && link.badge ? (
                  <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/70 transition group-hover:text-background group-hover:bg-foreground dark:group-hover:bg-white dark:group-hover:text-black">
                    {link.badge}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 flex-nowrap overflow-x-auto">
          <ThemeToggle />
          {user ? (
            <>
              <form action="/logout" method="post">
                <button
                  type="submit"
                  className={ghostButtonClass}
                >
                  로그아웃
                </button>
              </form>
              <Link
                href="/mypage"
                className={ghostButtonClass}
              >
                마이페이지
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={ghostButtonClass}
              >
                로그인
              </Link>
              <Link
                href="/signup"
                className={ghostButtonClass}
              >
                회원가입
              </Link>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto border-t border-border/50 px-6 py-3 text-sm font-semibold text-muted-foreground md:hidden">
        <Link
          href={navLinks[0].href}
          className={mobileLinkClass}
        >
          <span>{navLinks[0].label}</span>
        </Link>
        <Link
          href="/dashboard"
          className={mobileLinkClass}
        >
          <span>진행상황</span>
        </Link>
        {navLinks.slice(1).map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={mobileLinkClass}
          >
            <span>{link.label}</span>
            {"badge" in link && link.badge ? (
              <span className="rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/70 transition group-hover:text-background group-hover:bg-foreground dark:group-hover:bg-white dark:group-hover:text-black">
                {link.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </header>
  );
}

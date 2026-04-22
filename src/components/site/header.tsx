"use client";

import Link from "next/link";
import * as React from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { ThemeToggle } from "./theme-toggle";
import { SiteLogo } from "./site-logo";

const navLinks = [
  { label: "심의 신청", href: "/dashboard/new", match: "prefix" as const },
  { label: "진행상황", href: "/dashboard", match: "exact" as const },
  { label: "노래방 등록", href: "/karaoke-request", match: "prefix" as const },
  { label: "이메일 접수", href: "/forms", badge: "Legacy", match: "prefix" as const },
];

const authStorageKey = "onside:header-auth-state";

type AuthState = "authenticated" | "unauthenticated";

const navLinkClass =
  "inline-flex h-12 items-center rounded-full px-6 text-[15px] font-medium tracking-[-0.01em] transition";
const subtleButtonClass =
  "inline-flex h-12 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white/82 px-6 text-[15px] font-medium tracking-[-0.01em] text-[#1d1d1f] shadow-[0_12px_32px_rgba(0,0,0,0.05)] backdrop-blur-xl transition hover:border-black/12 hover:bg-white dark:border-white/10 dark:bg-white/6 dark:text-white dark:hover:border-white/16 dark:hover:bg-white/10";
const primaryButtonClass =
  "inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-primary px-6 text-[15px] font-medium tracking-[-0.01em] text-primary-foreground shadow-[0_18px_40px_rgba(0,113,227,0.18)] transition hover:bg-[#0077ed] dark:bg-[#2997ff] dark:text-[#00101f] dark:hover:bg-[#45a6ff]";

const isActivePath = (
  pathname: string,
  href: string,
  match: "exact" | "prefix" = "prefix",
) => {
  if (href === "/") return pathname === href;
  if (match === "exact") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

export function SiteHeader() {
  const pathname = usePathname();
  const [authState, setAuthState] = React.useState<AuthState>("unauthenticated");

  React.useEffect(() => {
    const supabase = createClient();
    let active = true;

    const persist = (nextState: AuthState) => {
      if (!active) return;
      setAuthState(nextState);
      try {
        window.sessionStorage.setItem(authStorageKey, nextState);
      } catch {
        // Ignore storage failures.
      }
    };

    try {
      const stored = window.sessionStorage.getItem(authStorageKey);
      if (stored === "authenticated" || stored === "unauthenticated") {
        setAuthState(stored);
      }
    } catch {
      // Ignore storage failures.
    }

    const syncSession = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (!active) return;

      if (error) {
        console.error("[SiteHeader] Failed to read session:", error.message);
        persist("unauthenticated");
        return;
      }

      persist(user ? "authenticated" : "unauthenticated");
    };

    void syncSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      persist(session?.user ? "authenticated" : "unauthenticated");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-black/6 bg-[rgba(250,250,252,0.82)] backdrop-blur-[24px] dark:border-white/10 dark:bg-[rgba(0,0,0,0.82)]">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <SiteLogo />

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1.5 lg:flex">
          {navLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${navLinkClass} ${
                  activeLink
                    ? "bg-primary text-primary-foreground dark:bg-[#2997ff] dark:text-[#00101f]"
                    : "text-foreground/68 hover:bg-black/4 hover:text-foreground dark:text-white/72 dark:hover:bg-white/8 dark:hover:text-white"
                }`}
              >
                <span>{link.label}</span>
                {"badge" in link && link.badge ? (
                  <span className="ml-2 rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-75">
                    {link.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {authState === "authenticated" ? (
            <>
              <form action="/logout" method="post">
                <button type="submit" className={subtleButtonClass}>
                  로그아웃
                </button>
              </form>
              <Link href="/mypage" className={primaryButtonClass}>
                마이페이지
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className={subtleButtonClass}>
                로그인
              </Link>
              <Link href="/signup" className={primaryButtonClass}>
                회원가입
              </Link>
            </>
          )}
        </div>
      </div>

      <nav className="border-t border-black/6 px-4 py-2.5 lg:hidden dark:border-white/10">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 overflow-x-auto scrollbar-none sm:px-2">
          {navLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${navLinkClass} shrink-0 ${
                  activeLink
                    ? "bg-primary text-primary-foreground dark:bg-[#2997ff] dark:text-[#00101f]"
                    : "bg-transparent text-foreground/72 hover:bg-black/4 hover:text-foreground dark:text-white/74 dark:hover:bg-white/8 dark:hover:text-white"
                }`}
              >
                <span>{link.label}</span>
                {"badge" in link && link.badge ? (
                  <span className="ml-2 rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-75">
                    {link.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

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
  "inline-flex h-11 items-center rounded-[8px] border-2 border-transparent px-4 text-[14px] font-black tracking-normal transition";
const subtleButtonClass =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-4 text-[14px] font-black tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27] dark:hover:shadow-[5px_5px_0_#f2cf27]";
const primaryButtonClass =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#1556a4] px-4 text-[14px] font-black tracking-normal text-white shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:bg-[#0f478a] hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[3px_3px_0_#f2cf27] dark:hover:bg-[#ffd93c] dark:hover:shadow-[5px_5px_0_#f2cf27]";

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
  const headerRef = React.useRef<HTMLElement | null>(null);
  const [authState, setAuthState] = React.useState<AuthState>("unauthenticated");

  React.useEffect(() => {
    const element = headerRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      document.documentElement.style.setProperty(
        "--site-header-height",
        `${nextHeight}px`,
      );
    };

    updateHeight();

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [pathname]);

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
        if (!error.message.toLowerCase().includes("auth session missing")) {
          console.error("[SiteHeader] Failed to read session:", error.message);
        }
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
    <header
      ref={headerRef}
      className="sticky top-0 z-[90] isolate border-b-2 border-[#111111] bg-[rgba(247,245,239,0.92)] backdrop-blur-[18px] dark:border-[#f2cf27] dark:bg-[rgba(16,16,16,0.92)]"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <SiteLogo />

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
          {navLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${navLinkClass} ${
                  activeLink
                    ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-none"
                    : "text-foreground/74 hover:border-[#111111] hover:bg-white hover:text-foreground dark:text-white/76 dark:hover:border-[#f2cf27] dark:hover:bg-[#171717] dark:hover:text-white"
                }`}
              >
                <span>{link.label}</span>
                {"badge" in link && link.badge ? (
                  <span className="ml-2 rounded-[6px] border border-current/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-normal opacity-85">
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

      <nav className="border-t-2 border-[#111111] px-4 py-2.5 lg:hidden dark:border-[#f2cf27]">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 overflow-x-auto scrollbar-none sm:px-2">
          {navLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${navLinkClass} shrink-0 ${
                  activeLink
                    ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-none"
                    : "bg-transparent text-foreground/72 hover:border-[#111111] hover:bg-white hover:text-foreground dark:text-white/74 dark:hover:border-[#f2cf27] dark:hover:bg-[#171717] dark:hover:text-white"
                }`}
              >
                <span>{link.label}</span>
                {"badge" in link && link.badge ? (
                  <span className="ml-2 rounded-[6px] border border-current/40 px-2 py-0.5 text-[10px] font-black uppercase tracking-normal opacity-85">
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

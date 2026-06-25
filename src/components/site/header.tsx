"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { ReliableLink } from "./reliable-link";
// import { ThemeToggle } from "./theme-toggle";
import { SiteLogo } from "./site-logo";

const navLinks = [
  { label: "심의 신청", href: "/dashboard/new", match: "prefix" as const },
  { label: "진행/결과 조회", href: "/track", match: "prefix" as const },
  { label: "이용가이드", href: "/guide", match: "prefix" as const },
];

const englishNavLinks = [
  { label: "Apply", href: "/en/dashboard/new", match: "prefix" as const },
  { label: "Results", href: "/en/track", match: "prefix" as const },
  { label: "Guide", href: "/en/guide", match: "prefix" as const },
];

const authStorageKey = "onside:header-auth-state";

type AuthState = "authenticated" | "unauthenticated";

const navLinkClass =
  "inline-flex h-11 items-center rounded-[8px] border-2 border-transparent px-4 text-[14px] font-black tracking-normal transition";
const mobileNavLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-transparent px-2 py-2 text-center text-[12px] font-black leading-tight tracking-normal transition";
const subtleButtonClass =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-3 text-[12px] font-black tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[2px_2px_0_#f2cf27] dark:hover:shadow-[4px_4px_0_#f2cf27] sm:h-11 sm:px-4 sm:text-[14px] sm:shadow-[3px_3px_0_#111111] sm:hover:shadow-[5px_5px_0_#111111] dark:sm:shadow-[3px_3px_0_#f2cf27] dark:sm:hover:shadow-[5px_5px_0_#f2cf27]";
const primaryButtonClass =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-3 text-[12px] font-black tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[2px_2px_0_#f2cf27] dark:hover:bg-white dark:hover:shadow-[4px_4px_0_#f2cf27] sm:h-11 sm:px-4 sm:text-[14px] sm:shadow-[3px_3px_0_#111111] sm:hover:shadow-[5px_5px_0_#111111] dark:sm:shadow-[3px_3px_0_#f2cf27] dark:sm:hover:shadow-[5px_5px_0_#f2cf27]";

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
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const activeNavLinks = isEnglishRoute ? englishNavLinks : navLinks;
  const languageHref = isEnglishRoute ? "/" : "/en";

  const handleLanguageClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();
      window.location.assign(languageHref);
    },
    [languageHref],
  );

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
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6">
        <SiteLogo />

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
          {activeNavLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            return (
              <ReliableLink
                key={link.href}
                href={link.href}
                className={`${navLinkClass} ${
                  activeLink
                    ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-none"
                    : "text-foreground/74 hover:border-[#111111] hover:bg-white hover:text-foreground dark:text-white/76 dark:hover:border-[#f2cf27] dark:hover:bg-[#171717] dark:hover:text-white"
                }`}
              >
                <span>{link.label}</span>
              </ReliableLink>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <a
            href={languageHref}
            data-no-localize="true"
            onClick={handleLanguageClick}
            className={subtleButtonClass}
          >
            {isEnglishRoute ? "KR" : "EN"}
          </a>
          {/* <ThemeToggle /> */}
          {authState === "authenticated" ? (
            <>
              <form action="/logout" method="post">
                <button type="submit" className={subtleButtonClass}>
                  {isEnglishRoute ? "Logout" : "로그아웃"}
                </button>
              </form>
              <ReliableLink
                href={isEnglishRoute ? "/en/mypage" : "/mypage"}
                className={subtleButtonClass}
              >
                {isEnglishRoute ? "My Page" : "마이페이지"}
              </ReliableLink>
            </>
          ) : (
            <>
              <ReliableLink
                href={isEnglishRoute ? "/en/login" : "/login"}
                className={subtleButtonClass}
              >
                {isEnglishRoute ? "Login" : "로그인"}
              </ReliableLink>
              <ReliableLink
                href={isEnglishRoute ? "/en/signup" : "/signup"}
                className={primaryButtonClass}
              >
                {isEnglishRoute ? "Sign Up" : "회원가입"}
              </ReliableLink>
            </>
          )}
        </div>
      </div>

      <nav className="border-t-2 border-[#111111] px-3 py-2.5 lg:hidden dark:border-[#f2cf27]">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-3 gap-1.5 sm:gap-2">
          {activeNavLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            return (
              <ReliableLink
                key={link.href}
                href={link.href}
                className={`${mobileNavLinkClass} ${
                  activeLink
                    ? "border-[#111111] bg-[#f2cf27] text-[#111111] shadow-[3px_3px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-none"
                    : "bg-transparent text-foreground/72 hover:border-[#111111] hover:bg-white hover:text-foreground dark:text-white/74 dark:hover:border-[#f2cf27] dark:hover:bg-[#171717] dark:hover:text-white"
                }`}
              >
                <span>{link.label}</span>
              </ReliableLink>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

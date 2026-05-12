"use client";

import Link from "next/link";
import * as React from "react";
import { usePathname } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

import { SiteLogo } from "./site-logo";

const navLinks = [
  { label: "음반심의", href: "/dashboard/new/album", match: "prefix" as const },
  { label: "뮤비심의", href: "/dashboard/new/mv", match: "prefix" as const },
  { label: "결과 확인", href: "/track", match: "prefix" as const },
  { label: "구버전(이메일) 접수", href: "/forms", match: "prefix" as const },
];

const authStorageKey = "onside:header-auth-state";

type AuthState = "authenticated" | "unauthenticated";

const navLinkClass =
  "inline-flex h-11 items-center border-b-2 border-transparent px-2 text-[14px] font-semibold tracking-normal transition";
const mobileNavLinkClass =
  "inline-flex min-h-10 items-center justify-center border-b-2 border-transparent px-2 py-2 text-center text-[12px] font-semibold leading-tight tracking-normal transition";
const subtleButtonClass =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] border border-[#c9d6e8] bg-white px-3 text-[12px] font-semibold tracking-normal text-[#2f3a4d] transition hover:border-[#2f6f9f] hover:text-[#2f6f9f] dark:border-white/16 dark:bg-[#111827] dark:text-white dark:hover:border-[#a9c8dc] sm:h-11 sm:px-4 sm:text-[14px]";
const primaryButtonClass =
  "inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] bg-[#2f6f9f] px-3 text-[12px] font-semibold tracking-normal text-white transition hover:bg-[#285f87] dark:bg-[#78a7c3] dark:text-[#06111f] dark:hover:bg-[#8bb8cf] sm:h-11 sm:px-4 sm:text-[14px]";

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
      className="sticky top-0 z-[90] isolate border-b border-[#d8e1ef] bg-white/95 backdrop-blur-[18px] dark:border-white/10 dark:bg-[#0f172a]/92"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6">
        <SiteLogo />

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex">
          {navLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            const linkClass = `${navLinkClass} ${
              activeLink
                ? "border-[#2f6f9f] text-[#2f6f9f] dark:border-[#a9c8dc] dark:text-[#a9c8dc]"
                : "text-[#667085] hover:border-[#c9d6e8] hover:text-[#2f3a4d] dark:text-white/70 dark:hover:border-white/24 dark:hover:text-white"
            }`;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass}
              >
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
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

      <nav className="border-t border-[#edf1f7] px-3 py-2.5 lg:hidden dark:border-white/10">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-4 gap-1.5 sm:gap-2">
          {navLinks.map((link) => {
            const activeLink = isActivePath(pathname, link.href, link.match);
            const linkClass = `${mobileNavLinkClass} ${
              activeLink
                ? "border-[#2f6f9f] text-[#2f6f9f] dark:border-[#a9c8dc] dark:text-[#a9c8dc]"
                : "bg-transparent text-[#667085] hover:border-[#c9d6e8] hover:text-[#2f3a4d] dark:text-white/70 dark:hover:border-white/24 dark:hover:text-white"
            }`;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass}
              >
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  LogIn,
  LogOut,
  ShoppingCart,
  UserPlus,
  UserRound,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  GUEST_SUBMISSION_CART_STORAGE_KEY,
  readGuestSubmissionCartEntries,
  SUBMISSION_CART_UPDATED_EVENT,
} from "@/lib/guest-submission-cart";

import { ReliableLink } from "./reliable-link";
// import { ThemeToggle } from "./theme-toggle";
import { SiteLogo } from "./site-logo";

const navLinks = [
  { label: "심의 신청", mobileLabel: "신청", href: "/dashboard/new", match: "prefix" as const },
  { label: "결과 조회", mobileLabel: "조회", href: "/track", match: "prefix" as const },
  { label: "크레딧", mobileLabel: "크레딧", href: "/magazine", match: "prefix" as const },
  { label: "이용가이드", mobileLabel: "가이드", href: "/guide", match: "prefix" as const },
];

const englishNavLinks = [
  { label: "Apply", mobileLabel: "Apply", href: "/en/dashboard/new", match: "prefix" as const },
  { label: "Results", mobileLabel: "Results", href: "/en/track", match: "prefix" as const },
  { label: "Credits", mobileLabel: "Credits", href: "/en/magazine", match: "prefix" as const },
  { label: "Guide", mobileLabel: "Guide", href: "/en/guide", match: "prefix" as const },
];

const authStorageKey = "onside:header-auth-state";

type AuthState = "authenticated" | "unauthenticated";

const navLinkClass =
  "inline-flex h-11 items-center rounded-[8px] border-2 border-transparent px-4 text-[14px] font-black tracking-normal transition";
const mobileNavLinkClass =
  "inline-flex min-h-10 items-center justify-center rounded-[8px] border-2 border-transparent px-2 py-2 text-center text-[12px] font-black leading-tight tracking-normal transition";
const subtleButtonClass =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white px-0 text-[12px] font-black tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[2px_2px_0_#f2cf27] dark:hover:shadow-[4px_4px_0_#f2cf27] sm:h-11 sm:w-auto sm:px-4 sm:text-[14px] sm:shadow-[3px_3px_0_#111111] sm:hover:shadow-[5px_5px_0_#111111] dark:sm:shadow-[3px_3px_0_#f2cf27] dark:sm:hover:shadow-[5px_5px_0_#f2cf27]";
const primaryButtonClass =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-[#f2cf27] px-0 text-[12px] font-black tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#f2cf27] dark:text-[#111111] dark:shadow-[2px_2px_0_#f2cf27] dark:hover:bg-white dark:hover:shadow-[4px_4px_0_#f2cf27] sm:h-11 sm:w-auto sm:px-4 sm:text-[14px] sm:shadow-[3px_3px_0_#111111] sm:hover:shadow-[5px_5px_0_#111111] dark:sm:shadow-[3px_3px_0_#f2cf27] dark:sm:hover:shadow-[5px_5px_0_#f2cf27]";
const cartButtonClass =
  "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[2px_2px_0_#f2cf27] dark:hover:shadow-[4px_4px_0_#f2cf27] sm:h-11 sm:w-11 sm:shadow-[3px_3px_0_#111111] sm:hover:shadow-[5px_5px_0_#111111] dark:sm:shadow-[3px_3px_0_#f2cf27] dark:sm:hover:shadow-[5px_5px_0_#f2cf27]";

const englishRoutePrefixes = [
  "/dashboard",
  "/mypage",
  "/track",
  "/submissions",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/magazine",
  "/guide",
  "/faq",
  "/support",
  "/forms",
  "/about",
  "/apply",
];

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

const supportsEnglishRoute = (pathname: string) =>
  pathname === "/" ||
  englishRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

const toEnglishPath = (pathname: string) => {
  if (pathname === "/") return "/en";
  if (pathname === "/en" || pathname.startsWith("/en/")) return pathname;
  return supportsEnglishRoute(pathname) ? `/en${pathname}` : "/en";
};

const toKoreanPath = (pathname: string) => {
  if (pathname === "/en") return "/";
  if (pathname.startsWith("/en/")) return pathname.slice(3) || "/";
  return pathname;
};

export function SiteHeader() {
  const pathname = usePathname();
  const headerRef = React.useRef<HTMLElement | null>(null);
  const [authState, setAuthState] = React.useState<AuthState>("unauthenticated");
  const [cartCount, setCartCount] = React.useState(0);
  const [locationSuffix, setLocationSuffix] = React.useState("");
  const isEnglishRoute = pathname === "/en" || pathname.startsWith("/en/");
  const activeNavLinks = isEnglishRoute ? englishNavLinks : navLinks;
  const cartHref = isEnglishRoute ? "/en/mypage/cart" : "/mypage/cart";
  const languagePath = isEnglishRoute
    ? toKoreanPath(pathname)
    : toEnglishPath(pathname);
  const languageHref = `${languagePath}${locationSuffix}`;

  React.useEffect(() => {
    setLocationSuffix(`${window.location.search}${window.location.hash}`);
  }, [pathname]);

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
      window.location.assign(
        `${languagePath}${window.location.search}${window.location.hash}`,
      );
    },
    [languagePath],
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
  }, []);

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
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (!active) return;

      if (error) {
        if (!error.message.toLowerCase().includes("auth session missing")) {
          console.error("[SiteHeader] Failed to read session:", error.message);
        }
        persist("unauthenticated");
        return;
      }

      persist(session?.user ? "authenticated" : "unauthenticated");
    };

    void syncSession();

    const handlePageShow = () => void syncSession();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncSession();
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      persist(session?.user ? "authenticated" : "unauthenticated");
    });

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname]);

  React.useEffect(() => {
    if (authState !== "authenticated") {
      const loadGuestCartCount = () => {
        setCartCount(readGuestSubmissionCartEntries().length);
      };
      const handleStorage = (event: StorageEvent) => {
        if (
          event.key === null ||
          event.key === GUEST_SUBMISSION_CART_STORAGE_KEY
        ) {
          loadGuestCartCount();
        }
      };

      loadGuestCartCount();
      window.addEventListener(SUBMISSION_CART_UPDATED_EVENT, loadGuestCartCount);
      window.addEventListener("storage", handleStorage);
      return () => {
        window.removeEventListener(
          SUBMISSION_CART_UPDATED_EVENT,
          loadGuestCartCount,
        );
        window.removeEventListener("storage", handleStorage);
      };
    }

    const controller = new AbortController();
    const loadCartCount = async () => {
      try {
        const response = await fetch("/api/cart/count", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as {
          count?: number;
        } | null;
        if (!controller.signal.aborted) {
          setCartCount(Math.max(0, Math.trunc(Number(payload?.count ?? 0))));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[SiteHeader] Failed to read cart count:", error);
        }
      }
    };

    void loadCartCount();
    window.addEventListener(SUBMISSION_CART_UPDATED_EVENT, loadCartCount);

    return () => {
      controller.abort();
      window.removeEventListener(SUBMISSION_CART_UPDATED_EVENT, loadCartCount);
    };
  }, [authState, pathname]);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-[90] isolate border-b-2 border-[#111111] bg-[rgba(247,245,239,0.92)] backdrop-blur-[18px] dark:border-[#f2cf27] dark:bg-[rgba(16,16,16,0.92)]"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6">
        <SiteLogo href={isEnglishRoute ? "/en" : "/"} />

        <nav
          aria-label={isEnglishRoute ? "Primary navigation" : "주요 메뉴"}
          className="hidden min-w-0 flex-1 items-center justify-center gap-2 lg:flex"
        >
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
          <ReliableLink
            href={cartHref}
            className={cartButtonClass}
            aria-label={isEnglishRoute ? "Cart" : "장바구니"}
            title={isEnglishRoute ? "Cart" : "장바구니"}
          >
            <ShoppingCart size={18} strokeWidth={2.6} />
            {cartCount > 0 ? (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#111111] bg-[var(--bauhaus-red)] px-1 text-[10px] font-black leading-none text-white dark:border-[#f2cf27] dark:text-[#06111f]">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            ) : null}
          </ReliableLink>
          {authState === "authenticated" ? (
            <>
              <form
                action={isEnglishRoute ? "/logout?next=%2Fen" : "/logout"}
                method="post"
                className="shrink-0"
              >
                <button
                  type="submit"
                  className={subtleButtonClass}
                  aria-label={isEnglishRoute ? "Logout" : "로그아웃"}
                >
                  <LogOut className="h-4 w-4 sm:hidden" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {isEnglishRoute ? "Logout" : "로그아웃"}
                  </span>
                </button>
              </form>
              <ReliableLink
                href={isEnglishRoute ? "/en/mypage/history" : "/mypage/history"}
                className={subtleButtonClass}
                aria-label={isEnglishRoute ? "My Page" : "마이페이지"}
              >
                <UserRound className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {isEnglishRoute ? "My Page" : "마이페이지"}
                </span>
              </ReliableLink>
            </>
          ) : (
            <>
              <ReliableLink
                href={isEnglishRoute ? "/en/login" : "/login"}
                className={subtleButtonClass}
                aria-label={isEnglishRoute ? "Login" : "로그인"}
              >
                <LogIn className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {isEnglishRoute ? "Login" : "로그인"}
                </span>
              </ReliableLink>
              <ReliableLink
                href={isEnglishRoute ? "/en/signup" : "/signup"}
                className={primaryButtonClass}
                aria-label={isEnglishRoute ? "Sign Up" : "회원가입"}
              >
                <UserPlus className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {isEnglishRoute ? "Sign Up" : "회원가입"}
                </span>
              </ReliableLink>
            </>
          )}
        </div>
      </div>

      <nav
        aria-label={isEnglishRoute ? "Mobile navigation" : "모바일 주요 메뉴"}
        className="border-t-2 border-[#111111] px-3 py-2.5 lg:hidden dark:border-[#f2cf27]"
      >
        <div className="mx-auto grid w-full max-w-6xl grid-cols-4 gap-1.5 sm:gap-2">
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
                <span>{link.mobileLabel}</span>
              </ReliableLink>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

"use client";

import * as React from "react";
import { MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex h-12 w-12 shrink-0 rounded-full border border-black/8 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-white/6"
      />
    );
  }

  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? SunMedium : MoonStar;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-12 shrink-0 items-center gap-2.5 rounded-full border border-black/8 bg-white/82 px-[18px] text-[14px] font-medium tracking-[-0.01em] text-[#1d1d1f] shadow-[0_12px_32px_rgba(0,0,0,0.06)] backdrop-blur-xl transition hover:border-black/12 hover:bg-white dark:border-white/10 dark:bg-white/6 dark:text-white dark:hover:border-white/16 dark:hover:bg-white/10"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="hidden sm:inline">{isDark ? "라이트" : "다크"}</span>
    </button>
  );
}

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
        className="inline-flex h-9 w-9 shrink-0 rounded-full border border-black/8 bg-white/70 backdrop-blur-xl dark:border-white/10 dark:bg-white/6"
      />
    );
  }

  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? SunMedium : MoonStar;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-black/8 bg-white/78 px-3 text-[12px] font-medium tracking-[-0.01em] text-[#1d1d1f] shadow-[0_10px_30px_rgba(0,0,0,0.06)] backdrop-blur-xl transition hover:border-black/12 hover:bg-white dark:border-white/10 dark:bg-white/6 dark:text-white dark:hover:border-white/16 dark:hover:bg-white/10"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

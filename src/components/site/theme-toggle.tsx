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
        className="inline-flex h-11 w-11 shrink-0 rounded-[8px] border-2 border-[#111111] bg-white dark:border-[#f2cf27] dark:bg-[#171717]"
      />
    );
  }

  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? SunMedium : MoonStar;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-11 shrink-0 items-center gap-2.5 rounded-[8px] border-2 border-[#111111] bg-white px-4 text-[14px] font-black tracking-normal text-[#111111] shadow-[3px_3px_0_#111111] transition hover:-translate-y-0.5 hover:shadow-[5px_5px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[3px_3px_0_#f2cf27] dark:hover:shadow-[5px_5px_0_#f2cf27]"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="hidden sm:inline">{isDark ? "라이트" : "다크"}</span>
    </button>
  );
}

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
        className="inline-flex h-10 w-10 shrink-0 rounded-[8px] border-2 border-[#111111] bg-white dark:border-[#f2cf27] dark:bg-[#171717] sm:h-11 sm:w-11"
      />
    );
  }

  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? SunMedium : MoonStar;

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border-2 border-[#111111] bg-white text-[13px] font-black tracking-normal text-[#111111] shadow-[2px_2px_0_#111111] transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_#111111] dark:border-[#f2cf27] dark:bg-[#171717] dark:text-white dark:shadow-[2px_2px_0_#f2cf27] dark:hover:shadow-[4px_4px_0_#f2cf27] sm:h-11 sm:w-auto sm:gap-2.5 sm:px-4 sm:text-[14px] sm:shadow-[3px_3px_0_#111111] sm:hover:shadow-[5px_5px_0_#111111] dark:sm:shadow-[3px_3px_0_#f2cf27] dark:sm:hover:shadow-[5px_5px_0_#f2cf27]"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="hidden sm:inline">{isDark ? "라이트" : "다크"}</span>
    </button>
  );
}

/** Solid Onside colors with matching text contrast in both themes. */
export const brandStatusTones = {
  neutral: "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]",
  warning: "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111]",
  progress: "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-blue)] text-white dark:text-[#06111f]",
  success: "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-green)] text-white dark:text-[#06111f]",
  danger: "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-red)] text-white dark:text-[#06111f]",
} as const;

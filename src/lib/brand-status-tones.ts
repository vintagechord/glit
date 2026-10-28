/** Solid Onside colors with matching text contrast in both themes. */
export const brandStatusTones = {
  neutral: "border-[var(--bauhaus-ink)] bg-[var(--background)] text-[var(--foreground)]",
  warning: "border-[var(--bauhaus-ink)] bg-[var(--bauhaus-yellow)] text-[#111111]",
  progress: "border-[var(--bauhaus-ink)] bg-[#1556a4] text-white",
  success: "border-[var(--bauhaus-ink)] bg-[#1f7a5a] text-white",
  danger: "border-[var(--bauhaus-ink)] bg-[#d9362c] text-white",
} as const;

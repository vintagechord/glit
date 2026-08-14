const internalPathBase = "https://onside-internal.invalid";

/**
 * Normalize a caller-provided redirect target without allowing a protocol,
 * scheme-relative URL, or backslash-normalized external host.
 */
export function getSafeInternalPath(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\")
  ) {
    return null;
  }

  try {
    const url = new URL(raw, internalPathBase);
    if (url.origin !== internalPathBase) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

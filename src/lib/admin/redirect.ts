const adminRedirectBase = "https://admin-redirect.invalid";

export function safeAdminRedirectPath(
  value: string | null | undefined,
  fallback = "/admin",
) {
  const raw = value?.trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return fallback;
  }

  try {
    const url = new URL(raw, adminRedirectBase);
    const isAdminPath =
      url.origin === adminRedirectBase &&
      (url.pathname === "/admin" || url.pathname.startsWith("/admin/"));
    return isAdminPath
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

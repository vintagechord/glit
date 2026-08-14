const allowedRemoteImageHost = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return (
    normalized.endsWith(".supabase.co") ||
    normalized.endsWith(".backblazeb2.com") ||
    normalized === "image.genie.co.kr"
  );
};

/** Keep database-configured images inside the hosts supported by next/image. */
export const isAllowedImageSource = (value: string | null | undefined) => {
  const source = value?.trim();
  if (!source) return false;
  if (source.startsWith("/") && !source.startsWith("//")) return true;

  try {
    const parsed = new URL(source);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      allowedRemoteImageHost(parsed.hostname)
    );
  } catch {
    return false;
  }
};

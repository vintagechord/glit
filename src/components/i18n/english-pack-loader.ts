type EnglishPack = typeof import("@/components/i18n/english-language-pack");

let loadedPack: EnglishPack | null = null;
let pendingPack: Promise<EnglishPack> | null = null;

export function isEnglishPathname(pathname: string) {
  return pathname === "/en" || pathname.startsWith("/en/");
}

/**
 * Fetches the English language pack once and keeps it for the visit. The
 * chunk is immutable, so later visits read it from the browser cache.
 */
export function loadEnglishPack(): Promise<EnglishPack> {
  if (!pendingPack) {
    pendingPack = import("@/components/i18n/english-language-pack").then(
      (pack) => {
        loadedPack = pack;
        return pack;
      },
      (error: unknown) => {
        pendingPack = null;
        throw error;
      },
    );
  }
  return pendingPack;
}

/** The pack when it has already loaded, so it can run without waiting a tick. */
export function loadedEnglishPack() {
  return loadedPack;
}

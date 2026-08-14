const navigationBase = "https://admin-submission-navigation.invalid";

const allowedFilterKeys = [
  "q",
  "status",
  "payment",
  "origin",
  "from",
  "to",
  "page",
  "type",
] as const;

const allowedOrigins = new Set(["domestic", "global"]);
const allowedTypes = new Set([
  "ALL",
  "ALBUM",
  "MV_DISTRIBUTION",
  "MV_BROADCAST",
]);

const normalizeFilterValue = (
  key: (typeof allowedFilterKeys)[number],
  value: string,
) => {
  const trimmed = value.trim();
  if (!trimmed) return "";

  switch (key) {
    case "q":
      return trimmed.slice(0, 200);
    case "status":
    case "payment":
      return /^[A-Z0-9_]{1,64}$/.test(trimmed) ? trimmed : "";
    case "origin":
      return allowedOrigins.has(trimmed) ? trimmed : "";
    case "from":
    case "to":
      return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
    case "page": {
      const page = Number(trimmed);
      return Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000
        ? String(page)
        : "";
    }
    case "type":
      return allowedTypes.has(trimmed) ? trimmed : "";
  }
};

export function safeAdminSubmissionsReturnTo(
  value: string | null | undefined,
  fallback = "/admin/submissions",
) {
  const raw = value?.trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return fallback;
  }

  try {
    const url = new URL(raw, navigationBase);
    if (
      url.origin !== navigationBase ||
      url.pathname !== "/admin/submissions"
    ) {
      return fallback;
    }

    const params = new URLSearchParams();
    for (const key of allowedFilterKeys) {
      const normalized = normalizeFilterValue(key, url.searchParams.get(key) ?? "");
      if (normalized) params.set(key, normalized);
    }

    const query = params.toString();
    return query ? `/admin/submissions?${query}` : "/admin/submissions";
  } catch {
    return fallback;
  }
}

export function buildAdminSubmissionDetailPath({
  submissionId,
  returnTo,
  state,
}: {
  submissionId: string;
  returnTo?: string | null;
  state?: Record<string, string | null | undefined>;
}) {
  const params = new URLSearchParams();
  Object.entries(state ?? {}).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  params.set("returnTo", safeAdminSubmissionsReturnTo(returnTo));

  return `/admin/submissions/${encodeURIComponent(submissionId)}?${params.toString()}`;
}

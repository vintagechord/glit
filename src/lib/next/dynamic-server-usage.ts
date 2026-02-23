export function isDynamicServerUsageError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (
    "digest" in error &&
    (error as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE"
  );
}

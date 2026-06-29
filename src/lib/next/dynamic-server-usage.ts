export function isDynamicServerUsageError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { digest?: unknown; message?: unknown };
  if (maybeError.digest === "DYNAMIC_SERVER_USAGE") {
    return true;
  }
  if (typeof maybeError.message !== "string") {
    return false;
  }
  return maybeError.message.includes("Dynamic server usage");
}

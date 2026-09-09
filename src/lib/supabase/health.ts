import { getServiceRoleKey, getSupabaseEnv, validateSupabaseUrl } from "./env";
import type { RuntimeHealthCheck } from "../runtime-health";
import { fetchWithTimeout } from "../fetch-with-timeout";

export function checkSupabaseConfig(): RuntimeHealthCheck {
  try {
    getSupabaseEnv();
    getServiceRoleKey();
    // Server-only aliases cannot supply browser auth during password recovery.
    const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
    if (!publicUrl || !publicKey) throw new Error("Missing browser Supabase URL or publishable key.");
    validateSupabaseUrl(publicUrl);
    if (publicKey.startsWith("sb_secret_")) throw new Error("A secret key must never be used as a browser Supabase key.");
    return { name: "supabase env", ok: true, severity: "error" };
  } catch (error) {
    return { name: "supabase env", ok: false, severity: "error", detail: error instanceof Error ? error.message : "Invalid Supabase configuration." };
  }
}

function connectionDetail(error: unknown): string {
  const value = error as { name?: string; cause?: { code?: string }; code?: string };
  const code = value?.cause?.code || value?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS resolution failed. Verify the configured Supabase project URL and project status.";
  if (value?.name === "TimeoutError" || code === "ETIMEDOUT") return "Supabase connection timed out.";
  return "Could not connect to Supabase. Check project availability and network access.";
}

/** Read-only probes: no users, password resets, emails, or database mutations. */
export async function checkSupabaseConnection(fetcher: typeof fetch = fetch): Promise<RuntimeHealthCheck[]> {
  let config: ReturnType<typeof getSupabaseEnv>;
  try {
    config = getSupabaseEnv();
  } catch {
    return [{ name: "supabase connectivity", ok: false, severity: "error", detail: "Fix Supabase configuration before checking connectivity." }];
  }
  const targets = [
    { name: "supabase auth connectivity", path: "/auth/v1/health" },
    // HEAD reads no catalog rows but verifies PostgREST + the same table used by
    // public product selection. It also catches missing tables and API permission failures.
    { name: "supabase product catalog connectivity", path: "/rest/v1/packages?select=id&limit=0", method: "HEAD" },
  ];
  return Promise.all(targets.map(async ({ name, path, method }) => {
    try {
      const response = await fetchWithTimeout(`${config.url}${path}`, {
        method: method ?? "GET",
        headers: { apikey: config.anonKey },
        redirect: "error",
      }, 8_000, fetcher);
      await response.body?.cancel();
      return { name, ok: response.ok, severity: "error" as const,
        detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}. Check the project's URL, key, API availability, and catalog permissions.` };
    } catch (error) {
      return { name, ok: false, severity: "error" as const, detail: connectionDetail(error) };
    }
  }));
}

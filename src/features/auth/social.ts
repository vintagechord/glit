import "server-only";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { emptySocialAvailability, type SocialAvailability } from "./social-contract";

let availability: { key: string; expiresAt: number; value: SocialAvailability } | undefined;
let pending: { key: string; promise: Promise<SocialAvailability> } | undefined;

const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

export function parseSocialAvailability(settings: unknown, naverEnabled: boolean): SocialAvailability {
  const external = asRecord(asRecord(settings).external);
  return {
    google: external.google === true,
    kakao: external.kakao === true,
    naver: naverEnabled,
  };
}

async function readJson(url: string, headers: Record<string, string>) {
  try {
    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(5_000) });
    return response.ok ? await response.json() as unknown : null;
  } catch { return null; }
}

/** Only public booleans are shared; credentials and account data never enter this cache. */
export async function getSocialAvailability(): Promise<SocialAvailability> {
  try {
    const { url, anonKey } = getSupabaseEnv();
    // Custom-provider configuration is provisioned separately with approval.
    // Never read an admin endpoint to render a public sign-in screen.
    const naverEnabled = process.env.ONSIDE_NAVER_LOGIN_ENABLED === "true";
    const key = `${url}:${naverEnabled}`;
    if (availability?.key === key && availability.expiresAt > Date.now()) return { ...availability.value };
    if (pending?.key === key) return { ...await pending.promise };
    const promise = readJson(`${url}/auth/v1/settings`, { apikey: anonKey })
      .then(settings => parseSocialAvailability(settings, naverEnabled));
    const request = { key, promise };
    pending = request;
    const value = await promise;
    if (pending === request) {
      availability = { key, expiresAt: Date.now() + 60_000, value };
      pending = undefined;
    }
    return { ...value };
  } catch { return emptySocialAvailability(); }
}

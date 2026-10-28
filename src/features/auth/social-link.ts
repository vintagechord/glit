import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getServiceRoleKey } from "@/lib/supabase/env";
import { getSocialProvider, type SocialProviderId } from "./social-contract";

const cookieName = "onside_social_link";
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/auth/callback" };
const signature = (value: string) => createHmac("sha256", getServiceRoleKey()).update(`onside-social-link-v1:${value}`).digest("base64url");
const equals = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

export type SocialLinkIntent = { userId: string; provider: SocialProviderId; token: string; flowId: string; english: boolean; expiresAt: number };
export const createSocialLinkToken = () => randomBytes(32).toString("base64url");

export async function saveSocialLinkIntent(intent: Omit<SocialLinkIntent, "expiresAt">) {
  const payload = Buffer.from(JSON.stringify({ ...intent, expiresAt: Date.now() + 600_000 })).toString("base64url");
  (await cookies()).set(cookieName, `${payload}.${signature(payload)}`, { ...cookieOptions, maxAge: 600 });
}

export async function consumeSocialLinkIntent(token: string | null): Promise<SocialLinkIntent | null> {
  const store = await cookies();
  const value = store.get(cookieName)?.value;
  store.set(cookieName, "", { ...cookieOptions, maxAge: 0 });
  if (!value || value.length > 4096 || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try {
    const [payload, signed, extra] = value.split(".");
    if (!payload || !signed || extra || !equals(signed, signature(payload))) return null;
    const intent = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SocialLinkIntent;
    if (typeof intent.userId !== "string" || !intent.userId || typeof intent.provider !== "string" || !getSocialProvider(intent.provider) ||
      typeof intent.token !== "string" || !equals(intent.token, token) || typeof intent.flowId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(intent.flowId) ||
      typeof intent.english !== "boolean" || typeof intent.expiresAt !== "number" || intent.expiresAt < Date.now() || intent.expiresAt > Date.now() + 600_000) return null;
    return intent;
  } catch { return null; }
}

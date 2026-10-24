import { createHmac, timingSafeEqual } from "node:crypto";
import { getServiceRoleKey } from "@/lib/supabase/env";

/** Bind confirmation to a link issued by our random-password signup flow. */
export function signSignupToken(token: string): string {
  return createHmac("sha256", getServiceRoleKey())
    .update(`onside.signup.email_password_v1\0${token}`)
    .digest("hex");
}

export function verifySignupToken(token: string, signature: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signSignupToken(token), "hex"));
}

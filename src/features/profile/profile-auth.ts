import type { User } from "@supabase/supabase-js";
import { socialProviders } from "@/features/auth/social-contract";

export function getProfileAuthDetails(user: Pick<User, "app_metadata" | "identities" | "email">) {
  const providers = new Set([
    ...(user.identities ?? []).map((identity) => identity.provider),
    ...(Array.isArray(user.app_metadata.providers) ? user.app_metadata.providers : []),
    user.app_metadata.provider,
  ]);
  const hasEmailIdentity = providers.has("email");
  return {
    email: user.email?.trim() || null,
    hasEmailIdentity,
    canChangePassword: hasEmailIdentity || user.app_metadata.hasPassword === true,
    linkedProviders: socialProviders.filter(({ provider }) => providers.has(provider)).map(({ id }) => id),
  };
}

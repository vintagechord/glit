import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { socialDisplayName } from "./social-contract";

/** Failed exchanges and link-account mismatches must not replace an existing session. */
export async function createSocialCallbackClient() {
  const store = await cookies();
  const { url, anonKey } = getSupabaseEnv();
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const supabase = createServerClient(url, anonKey, {
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll: () => {
        const values = new Map(store.getAll().map(cookie => [cookie.name, cookie]));
        pending.forEach(cookie => values.set(cookie.name, cookie));
        return [...values.values()];
      },
      setAll: values => { values.forEach(cookie => pending.set(cookie.name, cookie)); },
    },
  });
  return { supabase, commit: () => {
    pending.forEach(({ name, value, options }) => store.set({ name, value, ...options }));
    pending.clear();
  } };
}

export async function ensureSocialProfile(supabase: SupabaseClient, user: User) {
  const { data, error } = await supabase.from("profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) return false;
  if (data) return true;
  // Provider metadata is display-only. Never upsert or change an existing role.
  const { error: insertError } = await supabase.from("profiles").insert({ user_id: user.id, name: socialDisplayName(user) });
  if (!insertError) return true;
  if (insertError.code !== "23505") return false;
  const { data: existing, error: readError } = await supabase.from("profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  return !readError && Boolean(existing);
}

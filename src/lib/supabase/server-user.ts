import type { SupabaseClient, User } from "@supabase/supabase-js";

type AuthClient = Pick<SupabaseClient, "auth">;

export async function getServerSessionUser(client: AuthClient): Promise<User | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  return user ?? null;
}

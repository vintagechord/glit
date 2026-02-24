import type { SupabaseClient, User } from "@supabase/supabase-js";

type AuthClient = Pick<SupabaseClient, "auth">;

export async function getServerSessionUser(client: AuthClient): Promise<User | null> {
  const {
    data: { session },
  } = await client.auth.getSession();
  return session?.user ?? null;
}

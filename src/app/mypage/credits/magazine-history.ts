import type { SupabaseClient } from "@supabase/supabase-js";

import { isMagazineCreditColumnMissing } from "@/lib/credits";

export type UserMagazineRequest = {
  id: string;
  credits_spent: number;
  target_channel: string | null;
  status: string | null;
  album_title: string | null;
  artist_name: string | null;
  published_url: string | null;
  admin_memo: string | null;
  created_at: string | null;
};

const legacyColumns =
  "id, target_channel, status, album_title, artist_name, published_url, admin_memo, created_at";

export async function loadUserMagazineRequests(
  client: SupabaseClient,
  userId: string,
): Promise<UserMagazineRequest[]> {
  const read = (columns: string) =>
    client
      .from("magazine_requests")
      .select(columns)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

  const result = await read(`credits_spent, ${legacyColumns}`);
  if (isMagazineCreditColumnMissing(result.error)) {
    const legacy = await read(legacyColumns);
    if (legacy.error) {
      throw new Error(`Failed to load magazine requests: ${legacy.error.message}`);
    }
    // Before the pricing migration every request consumed one credit. Do not
    // infer this price for other query errors or overwrite recorded charges.
    const rows = (legacy.data ?? []) as unknown as Omit<UserMagazineRequest, "credits_spent">[];
    return rows.map((row) => ({
      ...row,
      credits_spent: 1,
    }));
  }
  if (result.error) {
    throw new Error(`Failed to load magazine requests: ${result.error.message}`);
  }
  return (result.data ?? []) as unknown as UserMagazineRequest[];
}

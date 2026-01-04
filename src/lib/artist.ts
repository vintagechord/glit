import { createAdminClient } from "@/lib/supabase/admin";

// NOTE: 단순 정책 - 동일 이름이면 동일 아티스트로 취급. 필요하면 나중에 고유 키/슬러그 정책을 확장하세요.
export async function ensureArtistByName(rawName: string | null | undefined) {
  const name = rawName?.trim();
  if (!name) return null;

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("artists")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await admin
    .from("artists")
    .insert({ name, slug })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("ensureArtistByName error", error);
    return null;
  }

  return created?.id ?? null;
}

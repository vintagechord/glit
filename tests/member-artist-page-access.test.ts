import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("the member artist page reads the artist with the member's session, so the owner-only artists policy applies", () => {
  const view = readSource("src/app/dashboard/artists/[id]/view.tsx");
  // The service role skips row level security: any member could open any
  // artist's name and thumbnail by changing the id in the address.
  assert.doesNotMatch(view, /createAdminClient/);
  assert.match(view, /supabase\.from\("artists"\)\.select\("id, name, thumbnail_url"\)\.eq\("id", artistId\)\.maybeSingle\(\)/);
  // An artist the member has no submission for reads as missing.
  assert.match(view, /if \(!artist\) \{[\s\S]{0,200}아티스트 정보를 찾을 수 없습니다\./);

  const policy = readSource("supabase/migrations/20261101190000_artists_row_level_security.sql");
  assert.match(policy, /create policy "Artists readable by submission owners"[\s\S]*to authenticated[\s\S]*s\.artist_id = artists\.id\s+and s\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(policy, /grant select on table public\.artists to authenticated;/);
});

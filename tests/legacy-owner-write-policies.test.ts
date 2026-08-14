import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("legacy owner INSERT policies are removed from credit and moderation tables", () => {
  const migration = read("supabase/migrations/0074_harden_privileged_writes.sql");
  for (const policy of [
    "Karaoke votes insertable",
    "Karaoke promotions insertable",
    "Karaoke contributions insertable",
    "Karaoke recommendations insertable",
    "Magazine requests insertable by owner",
    "Studio reservations insertable by owner",
  ]) {
    assert.match(
      migration,
      new RegExp(`drop policy if exists "${policy}"`),
      `${policy} must not survive the hardening migration`,
    );
  }
  assert.match(migration, /create policy "Karaoke votes pending insert"/);
  assert.match(migration, /voter_user_id = auth\.uid\(\)[\s\S]*status = 'PENDING'/);
  assert.match(
    migration,
    /create policy "Karaoke recommendations pending insert"[\s\S]*promotion\.status = 'ACTIVE'[\s\S]*promotion\.credits_balance > 0[\s\S]*promotion\.owner_user_id is distinct from auth\.uid\(\)/,
  );
});

test("supported public writes use trusted actions or security-definer RPCs", () => {
  const karaoke = read("src/features/karaoke/actions.ts");
  const voteStart = karaoke.indexOf("export async function createKaraokeVoteAction");
  const contributionStart = karaoke.indexOf(
    "export async function contributeKaraokePromotionAction",
  );
  const recommendationStart = karaoke.indexOf(
    "export async function createKaraokePromotionRecommendationAction",
  );
  const recommendationEnd = karaoke.indexOf(
    "export async function updateKaraokePromotionRecommendationStatusAction",
  );
  const vote = karaoke.slice(voteStart, contributionStart);
  const recommendation = karaoke.slice(recommendationStart, recommendationEnd);

  assert.match(vote, /const admin = createAdminClient\(\)/);
  assert.match(vote, /admin\.from\("karaoke_votes"\)\.insert/);
  assert.match(recommendation, /const admin = createAdminClient\(\)/);
  assert.match(
    recommendation,
    /admin\s+\.from\("karaoke_promotion_recommendations"\)\s+\.insert/,
  );

  const magazine = read("src/features/magazine/actions.ts");
  const credits = read("src/features/credits/actions.ts");
  assert.match(magazine, /supabase\.rpc\(\s*"create_magazine_request"/);
  assert.match(credits, /supabase\.rpc\("redeem_studio_reward"/);

  const magazineRpc = read(
    "supabase/migrations/0066_magazine_free_credit_requests.sql",
  );
  const studioRpc = read("supabase/migrations/0054_credit_studio_reservations.sql");
  assert.match(
    magazineRpc,
    /create or replace function public\.create_magazine_request[\s\S]*security definer/,
  );
  assert.match(
    studioRpc,
    /create or replace function public\.redeem_studio_reward[\s\S]*security definer/,
  );
});

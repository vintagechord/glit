import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("karaoke credit mutations are service-only transactional RPCs", () => {
  const migration = read(
    "supabase/migrations/0085_karaoke_credit_integrity.sql",
  );
  for (const name of [
    "create_karaoke_request_with_promotion",
    "contribute_karaoke_promotion_credits",
    "set_karaoke_promotion_recommendation_status",
    "set_karaoke_vote_status",
  ]) {
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${name}`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`),
    );
  }
  assert.equal(
    (migration.match(/coalesce\(auth\.role\(\), ''\) <> 'service_role'/g) ?? [])
      .length,
    4,
  );
  assert.equal(
    (migration.match(/for update/g) ?? []).length >= 6,
    true,
    "balances, promotions, and moderation rows must be locked",
  );
  assert.match(migration, /credit\.balance >= v_promotion_credits/);
  assert.match(migration, /credit\.balance >= p_credits/);
  assert.match(migration, /KARAOKE_CREDITS_INSUFFICIENT/);
  assert.match(migration, /KARAOKE_RECOMMENDATION_APPROVAL_TERMINAL/);
  assert.match(migration, /KARAOKE_VOTE_APPROVAL_TERMINAL/);
});

test("karaoke actions do not compose balances and ledgers client-side", () => {
  const actions = read("src/features/karaoke/actions.ts");
  const createStart = actions.indexOf("export async function createKaraokeRequestAction");
  const voteStart = actions.indexOf("export async function createKaraokeVoteAction");
  const createAction = actions.slice(createStart, voteStart);
  assert.match(createAction, /"create_karaoke_request_with_promotion"/);
  assert.doesNotMatch(createAction, /\.from\("karaoke_credits"\)/);
  assert.doesNotMatch(createAction, /\.from\("karaoke_promotions"\)\.insert/);

  const contributionStart = actions.indexOf(
    "export async function contributeKaraokePromotionAction",
  );
  const createRecommendationStart = actions.indexOf(
    "export async function createKaraokePromotionRecommendationAction",
  );
  const contribution = actions.slice(
    contributionStart,
    createRecommendationStart,
  );
  assert.match(contribution, /"contribute_karaoke_promotion_credits"/);
  assert.doesNotMatch(contribution, /\.from\("karaoke_credits"\)/);
  assert.doesNotMatch(
    contribution,
    /\.from\("karaoke_promotion_contributions"\)/,
  );

  const recommendationStatusStart = actions.indexOf(
    "export async function updateKaraokePromotionRecommendationStatusAction",
  );
  const voteStatusStart = actions.indexOf(
    "export async function updateKaraokeVoteStatusAction",
  );
  const updateStatusStart = actions.indexOf(
    "export async function updateKaraokeStatusAction",
  );
  const recommendationStatus = actions.slice(
    recommendationStatusStart,
    voteStatusStart,
  );
  const voteStatus = actions.slice(voteStatusStart, updateStatusStart);
  assert.match(
    recommendationStatus,
    /"set_karaoke_promotion_recommendation_status"/,
  );
  assert.match(voteStatus, /"set_karaoke_vote_status"/);
  assert.doesNotMatch(recommendationStatus, /\.from\("karaoke_credits"\)/);
  assert.doesNotMatch(voteStatus, /\.from\("karaoke_credits"\)/);
});

test("karaoke credit and URL inputs have bounded action schemas", () => {
  const actions = read("src/features/karaoke/actions.ts");
  assert.match(actions, /promotionCredits: z\.number\(\)\.int\(\)\.min\(0\)\.max\(1_000_000\)/);
  assert.match(actions, /credits: z\.number\(\)\.int\(\)\.positive\(\)\.max\(1_000_000\)/);
  assert.match(actions, /referenceUrl: z\.string\(\)\.max\(2_048\)/);
});

test("admin file downloads allow only exact RLS-visible foreign B2 references", () => {
  const source = read("src/features/karaoke/actions.ts");
  for (const functionName of [
    "getKaraokeRequestFileUrlAction",
    "getKaraokeRecommendationFileUrlAction",
  ]) {
    const start = source.indexOf(`export async function ${functionName}`);
    const next = source.indexOf("\nexport async function ", start + 1);
    const action = source.slice(start, next >= 0 ? next : undefined);

    assert.match(action, /\.from\("karaoke_(?:requests|promotion_recommendations)"\)/);
    assert.match(action, /objectKeyKind === "foreign"[\s\S]*supabase\.rpc\("is_admin"\)/);
    assert.match(action, /objectKeyKind === "foreign" && isAdmin !== true/);
    assert.match(
      action,
      /objectKeyKind === "owned" \|\| \(objectKeyKind === "foreign" && isAdmin === true\)/,
    );
  }
});

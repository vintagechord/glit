import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("editing and re-adding an album keeps the original submission as the cart item", () => {
  const wizard = read("src/features/submissions/album-wizard.tsx");
  const actions = read("src/features/submissions/actions.ts");
  const cartQuery = read("src/lib/submission-cart.ts");
  const cart = read("src/components/dashboard/submission-cart-checkout.tsx");
  const draftsApi = read("src/app/api/submissions/drafts/route.ts");

  assert.match(cart, /ids: groupItems\.map\(\(candidate\) => candidate\.id\)/);
  assert.match(cart, /guestTokensBySubmissionId: groupGuestTokens/);
  assert.match(cart, /expandSubmissionCartGroupIds/);
  assert.match(cart, /dashboard\/new\/album\?from=drafts/);
  assert.match(draftsApi, /const loadableDraftStatuses = \[[\s\S]*"SUBMITTED"[\s\S]*"WAITING_PAYMENT"/);
  assert.match(draftsApi, /submissionQuery\.in\("id", requestedIds\)/);
  assert.match(wizard, /submissionId: draft\.submissionId/);
  assert.match(wizard, /addGuestSubmissionCartEntries\([\s\S]*submissionId,[\s\S]*guestToken/);
  assert.match(actions, /const submissionPayload = \{[\s\S]*id: parsed\.data\.submissionId/);
  assert.match(actions, /package_id: parsed\.data\.packageId \?\? null/);
  assert.match(actions, /amount_krw: amountKrw/);
  assert.match(
    actions,
    /db\.rpc\([\s\S]*"commit_submission_save_v2"[\s\S]*p_submission_id: parsed\.data\.submissionId[\s\S]*p_parent: atomicParentPayload/,
  );
  assert.match(cartQuery, /\.from\("submissions"\)/);
  assert.doesNotMatch(cartQuery, /\.from\("(?:cart|cart_items)"\)/);
});

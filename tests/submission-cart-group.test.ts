import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  expandSubmissionCartGroupIds,
  filterCompleteSubmissionCartGroups,
  getSubmissionCartGroupKey,
  type SubmissionCartGroupItem,
} from "../src/lib/submission-cart-group";

const items: SubmissionCartGroupItem[] = [
  {
    id: "album-base",
    type: "ALBUM",
    album_draft_group_id: "album-base",
  },
  {
    id: "album-additional",
    type: "ALBUM",
    album_draft_group_id: "album-base",
  },
  {
    id: "mv-one",
    type: "MV_BROADCAST",
    album_draft_group_id: "album-base",
  },
];

test("album cart rows share their base submission as one cart unit", () => {
  assert.equal(getSubmissionCartGroupKey(items[0]), "album:album-base");
  assert.equal(getSubmissionCartGroupKey(items[1]), "album:album-base");
  assert.equal(
    getSubmissionCartGroupKey(items[2]),
    "submission:mv-one",
    "a stray album group id must not group a non-album submission",
  );
});

test("selecting either album row expands to the entire album bundle", () => {
  assert.deepEqual(
    expandSubmissionCartGroupIds(items, ["album-additional"]),
    ["album-base", "album-additional"],
  );
  assert.deepEqual(
    expandSubmissionCartGroupIds(items, ["album-base", "mv-one"]),
    ["album-base", "album-additional", "mv-one"],
  );
});

test("legacy and standalone cart rows remain independent", () => {
  const standalone: SubmissionCartGroupItem[] = [
    { id: "legacy-album", type: "ALBUM" },
    { id: "standalone-mv", type: "MV_DISTRIBUTION" },
  ];

  assert.deepEqual(
    expandSubmissionCartGroupIds(standalone, ["legacy-album"]),
    ["legacy-album"],
  );
});

test("one unauthorized album row rejects the entire bundle", () => {
  const acceptedIds = new Set(["album-base", "mv-one"]);
  assert.deepEqual(
    filterCompleteSubmissionCartGroups(items, (item) =>
      acceptedIds.has(item.id),
    ).map((item) => item.id),
    ["mv-one"],
  );
});

test("both cart payment entry points reject incomplete active album bundles", () => {
  for (const path of [
    "src/app/api/cart/bank/route.ts",
    "src/lib/payments/submission.ts",
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const groupLookup = source.indexOf(
      '.in("album_draft_group_id", albumDraftGroupIds)',
    );
    const incompleteGuard = source.indexOf(
      "함께 작성한 앨범은 묶음 전체의 접수를 완료한 뒤 함께 결제해주세요.",
      groupLookup,
    );

    assert.ok(groupLookup >= 0, `${path}: active album group lookup is missing`);
    assert.ok(
      incompleteGuard > groupLookup,
      `${path}: incomplete album group must be rejected before payment`,
    );
    assert.match(
      source.slice(groupLookup, incompleteGuard),
      /\["DRAFT", "PRE_REVIEW", "SUBMITTED", "WAITING_PAYMENT"\]/,
    );
  }
});

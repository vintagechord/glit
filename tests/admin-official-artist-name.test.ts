import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { artistReferenceNames, officialArtistName } from "../src/lib/submissions/artist-display";

test("MV requests show the 아티스트명 공식 표기 instead of the 한글/영문 name", () => {
  for (const type of ["MV_DISTRIBUTION", "MV_BROADCAST"]) {
    assert.equal(
      officialArtistName({ type, artist_name: "쏠(SOLE) / SOLE", artist_name_kr: " SOLE (쏠) " }),
      "SOLE (쏠)",
    );
  }
});

test("MV requests from before the official field fall back to the 한글/영문 name", () => {
  assert.equal(officialArtistName({ type: "MV_DISTRIBUTION", artist_name: "싸이(PSY) / PSY", artist_name_kr: null }), "싸이(PSY) / PSY");
  assert.equal(officialArtistName({ type: "MV_BROADCAST", artist_name: "아이유 / IU", artist_name_kr: "  " }), "아이유 / IU");
});

test("albums keep artist_name, which is already the official credit", () => {
  assert.equal(officialArtistName({ type: "ALBUM", artist_name: "윤하 (YOUNHA)", artist_name_kr: "윤하" }), "윤하 (YOUNHA)");
  assert.equal(officialArtistName({ type: "ALBUM", artist_name: null, artist_name_kr: "윤하" }), null);
});

test("the 한글/영문 names follow the official credit as reference only", () => {
  assert.deepEqual(artistReferenceNames({ type: "MV_DISTRIBUTION", artist_name: "쏠(SOLE) / SOLE", artist_name_kr: "SOLE (쏠)" }), ["쏠(SOLE) / SOLE"]);
  assert.deepEqual(artistReferenceNames({ type: "MV_BROADCAST", artist_name: "아이유 / IU", artist_name_kr: null }), []);
  assert.deepEqual(artistReferenceNames({ type: "ALBUM", artist_name: "윤하 (YOUNHA)", artist_name_kr: "윤하", artist_name_en: "YOUNHA" }), ["윤하", "YOUNHA"]);
});

test("customer mail, result pages and lists name the artist by the official credit", () => {
  for (const file of [
    "src/lib/admin/submission-notifications.ts",
    "src/lib/admin/review-email-preview.ts",
    "src/lib/payments/notifications.ts",
    "src/lib/payments/submission.ts",
    "src/lib/payments/paypal.ts",
    "src/app/api/cart/bank/route.ts",
    "src/lib/submission-supplements/server.ts",
    "src/features/submissions/submission-detail-client.tsx",
    "src/features/home/home-review-panel.tsx",
    "src/app/dashboard/drafts/view.tsx",
    "src/app/dashboard/artists/[id]/view.tsx",
    "src/components/dashboard/submission-cart-checkout.tsx",
  ]) {
    assert.match(readFileSync(file, "utf8"), /officialArtistName\(/, file);
  }
  for (const file of ["src/lib/dashboard-status.ts", "src/app/dashboard/history/view.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /startsWith\("MV_"\) \? (?:submission|item)\.artist_name_kr/, file);
  }
  // Every query feeding those views loads the official field.
  for (const file of ["src/lib/admin/review-desk.ts", "src/lib/submission-cart.ts", "src/lib/dashboard-status.ts"]) {
    assert.match(readFileSync(file, "utf8"), /artist_name_kr/, file);
  }
  const mvSave = readFileSync("src/features/submissions/actions.ts", "utf8");
  assert.match(mvSave, /ensureArtistByName\(officialArtistNameValue\)/);
  assert.equal(mvSave.match(/artist: officialArtistNameValue \|\| null/g)?.length, 2);
});

test("order items snapshot the official MV credit and existing MV items are corrected", () => {
  const migration = readFileSync("supabase/migrations/20261109120000_order_items_official_artist.sql", "utf8");
  assert.match(migration, /create or replace function public\.snapshot_submission_order_items\(p_order_id uuid,p_ids uuid\[\]\)/);
  assert.match(migration, /then coalesce\(nullif\(btrim\(s\.artist_name_kr\),''\),s\.artist_name\)\s+else s\.artist_name end/);
  assert.match(migration, /update public\.submission_order_items i\s+set artist_name = btrim\(s\.artist_name_kr\)/);
  assert.doesNotMatch(migration, /set\s+(?:amount|amount_krw|title|package_name)\b/);
});

test("admin list, detail, dashboard and payments read the official artist name", () => {
  for (const file of [
    "src/app/admin/submissions/page.tsx",
    "src/app/admin/submissions/detail/page.tsx",
    "src/lib/admin/dashboard-summary.ts",
    "src/app/admin/payments/page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /officialArtistName\(/, file);
    assert.match(source, /artist_name_kr/, file);
  }
});

test("the MV 소속사 notice stays and is highlighted", () => {
  const source = readFileSync("src/features/submissions/mv-wizard.tsx", "utf8");
  assert.match(
    source,
    /id="mv-agency-help" className=\{`[^`]*\$\{brandStatusTones\.warning\}`\}>\s*영상 좌측 하단에 표기할 소속사명과 똑같이 입력해주세요\./,
  );
});

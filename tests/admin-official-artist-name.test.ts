import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { officialArtistName } from "../src/lib/submissions/artist-display";

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

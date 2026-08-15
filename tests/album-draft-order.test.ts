import assert from "node:assert/strict";
import test from "node:test";

import { orderAlbumDraftRowsForResume } from "../src/lib/album-draft-order";

test("stored submission order wins over autosave timestamps", () => {
  const base = { id: "base", created_at: "2026-01-01", updated_at: "2026-01-01" };
  const addition = { id: "addition", created_at: "2026-01-02", updated_at: "2026-08-15" };
  assert.deepEqual(
    orderAlbumDraftRowsForResume([addition, base], ["base", "addition"]),
    [base, addition],
  );
});

test("full-price tier identifies the base on cross-device resume", () => {
  const addition = { id: "addition", album_price_tier: "ADDITIONAL", created_at: "2026-01-01" };
  const base = { id: "base", album_price_tier: "FULL", created_at: "2026-01-02" };
  assert.deepEqual(orderAlbumDraftRowsForResume([addition, base]), [base, addition]);
});

test("full-price tier wins even when a stale browser order puts an addition first", () => {
  const addition = { id: "addition", album_price_tier: "ADDITIONAL", created_at: "2026-01-01" };
  const base = { id: "base", album_price_tier: "FULL", created_at: "2026-01-02" };
  assert.deepEqual(
    orderAlbumDraftRowsForResume([addition, base], ["addition", "base"]),
    [base, addition],
  );
});

test("legacy rows keep their creation order without relying on updated_at", () => {
  const first = { id: "first", created_at: "2026-01-01" };
  const second = { id: "second", created_at: "2026-01-02" };
  assert.deepEqual(orderAlbumDraftRowsForResume([second, first]), [first, second]);
});

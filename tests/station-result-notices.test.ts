import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadStationResultNotices,
  normalizeStationResultNotices,
  saveStationResultNotice,
  stationResultNoticeFor,
  STATION_RESULT_NOTICES_KEY,
} from "../src/lib/station-result-notices";

// 2026-11-25 (owner): TBS only accepts applications while its results are on
// hold. The note shows on the TBS row until the administrator turns it off.

const tbs = "서울시 예산 문제로 TBS의 심의 결과 안내가 멈춰 있어, 현재는 접수만 진행되고 있습니다.";

function fakeDb(initial: unknown, options: { readError?: boolean; writeError?: boolean } = {}) {
  const state = { value: initial, writes: [] as unknown[] };
  const db = {
    from(table: string) {
      assert.equal(table, "site_settings");
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => { assert.deepEqual([column, value], ["key", STATION_RESULT_NOTICES_KEY]); return chain; },
        maybeSingle: async () => options.readError
          ? { data: null, error: { message: "down" } }
          : { data: state.value === undefined ? null : { value: state.value }, error: null },
        upsert: async (row: { key: string; value: unknown }) => {
          state.writes.push(row);
          if (options.writeError) return { error: { message: "denied" } };
          state.value = row.value;
          return { error: null };
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, state };
}

test("stored notes are read by station code, and anything malformed is dropped", () => {
  assert.deepEqual(normalizeStationResultNotices({ notices: { tbs: ` ${tbs} `, "": "x", "bad code": "x", KBS: "  ", MBC: 3 } }), { TBS: tbs });
  assert.deepEqual(normalizeStationResultNotices(null), {});
  assert.deepEqual(normalizeStationResultNotices({ notices: ["TBS"] }), {});
  assert.equal(normalizeStationResultNotices({ notices: { TBS: "가".repeat(500) } }).TBS.length, 200);
});

test("a note shows only on its station's row while that station has no result", () => {
  const notices = { TBS: tbs };
  assert.equal(stationResultNoticeFor(notices, "TBS", false), tbs);
  assert.equal(stationResultNoticeFor(notices, " tbs ", false), tbs);
  assert.equal(stationResultNoticeFor(notices, "TBS", true), null);
  assert.equal(stationResultNoticeFor(notices, "KBS", false), null);
  assert.equal(stationResultNoticeFor(undefined, "TBS", false), null);
});

test("a page whose note cannot be read shows none instead of failing", async () => {
  assert.deepEqual(await loadStationResultNotices(fakeDb(undefined, { readError: true }).db), {});
  assert.deepEqual(await loadStationResultNotices({ from() { throw new Error("offline"); } } as unknown as SupabaseClient), {});
  assert.deepEqual(await loadStationResultNotices(fakeDb({ notices: { TBS: tbs } }).db), { TBS: tbs });
});

test("the administrator sets, edits and removes a station's note", async () => {
  const { db, state } = fakeDb({ notices: { TBS: tbs, KBS: "other" } });
  assert.deepEqual(await saveStationResultNotice(db, "tbs", "edited"), { ok: true });
  assert.deepEqual(state.value, { notices: { TBS: "edited", KBS: "other" } });
  assert.deepEqual(await saveStationResultNotice(db, "TBS", ""), { ok: true });
  assert.deepEqual(state.value, { notices: { KBS: "other" } });
  assert.equal((await saveStationResultNotice(db, "bad code", "x")).ok, false);
  assert.equal((await saveStationResultNotice(db, "TBS", "가".repeat(201))).ok, false);
  assert.equal(state.writes.length, 2);
  assert.equal((await saveStationResultNotice(fakeDb(undefined, { readError: true }).db, "TBS", "x")).ok, false);
  assert.equal((await saveStationResultNotice(fakeDb(undefined, { writeError: true }).db, "TBS", "x")).ok, false);
});

test("the migration seeds the TBS note the customer pages and mail read", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261125120000_tbs_result_notice.sql", import.meta.url), "utf8");
  assert.match(sql, new RegExp(`'${STATION_RESULT_NOTICES_KEY}'`));
  assert.ok(sql.includes(`'${tbs}'`));
  assert.match(sql, /on conflict \(key\) do nothing/);
  const pack = readFileSync(new URL("../src/components/i18n/english-language-pack.tsx", import.meta.url), "utf8");
  assert.ok(pack.includes(`"${tbs}":`), "the English pack translates the seeded note");
});

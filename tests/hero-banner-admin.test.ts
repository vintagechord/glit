import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deleteHeroBanner, saveHeroBanner, saveHeroInterval } from "../src/lib/admin/hero-banner-admin";
import { DEFAULT_HERO_SLIDES, HERO_SETTINGS_KEY } from "../src/lib/home-hero-banners";

const id = "11111111-1111-4111-8111-111111111111";
type Op = [string, ...unknown[]];

function fakeDb(options: { fail?: boolean; missing?: boolean } = {}) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const db = {
    from(table: string) {
      const call = { table, ops: [] as Op[] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "insert", "update", "upsert", "delete"]) chain[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return chain; };
      const answer = () => options.fail ? { data: null, error: { message: "down" } } : { data: options.missing ? null : { id }, error: null };
      chain.maybeSingle = async () => answer();
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve);
      return chain;
    },
  } as unknown as SupabaseClient;
  const write = (name: string) => calls.flatMap((call) => call.ops.filter(([op]) => op === name).map((op) => ({ table: call.table, payload: op[1], ops: call.ops })));
  return { db, calls, write };
}

const urlBanner = {
  design: "url", headline1: "이미 발매된 음원은", headline2: "URL만 입력하면 끝",
  headline1En: "Already released?", headline2En: "Just paste the URL", linkUrl: "/dashboard/new/album", sortOrder: "20", isActive: true,
};

test("a new banner is added with checked text, and an existing one is changed in place", async () => {
  const created = fakeDb();
  assert.deepEqual(await saveHeroBanner(created.db, { raw: urlBanner }), { ok: true });
  assert.equal(created.write("insert").length, 1);
  assert.equal(created.write("insert")[0].table, "home_hero_banners");
  assert.deepEqual(created.write("insert")[0].payload, {
    design: "url", badge: null, headline_1: "이미 발매된 음원은", headline_2: "URL만 입력하면 끝", body: null,
    badge_en: null, headline_1_en: "Already released?", headline_2_en: "Just paste the URL", body_en: null,
    link_url: "/dashboard/new/album", sort_order: 20, is_active: true,
  });

  const changed = fakeDb();
  assert.deepEqual(await saveHeroBanner(changed.db, { id, raw: { ...urlBanner, isActive: false } }), { ok: true });
  assert.equal(changed.write("insert").length, 0);
  assert.equal((changed.write("update")[0].payload as { is_active: boolean }).is_active, false);
  assert.ok(changed.write("update")[0].ops.some(([op, column, value]) => op === "eq" && column === "id" && value === id));
});

test("a banner that fails the checks, or is gone, is not written and says why", async () => {
  const refused = fakeDb();
  const result = await saveHeroBanner(refused.db, { raw: { ...urlBanner, linkUrl: "javascript:alert(1)" } });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /링크/);
  assert.equal(refused.calls.length, 0);

  assert.equal((await saveHeroBanner(fakeDb().db, { id: "not-an-id", raw: urlBanner })).ok, false);
  const gone = await saveHeroBanner(fakeDb({ missing: true }).db, { id, raw: urlBanner });
  assert.equal(gone.ok, false);
  assert.equal((await saveHeroBanner(fakeDb({ fail: true }).db, { raw: urlBanner })).ok, false);
});

test("deleting removes exactly the chosen banner", async () => {
  const { db, write } = fakeDb();
  assert.deepEqual(await deleteHeroBanner(db, id), { ok: true });
  assert.equal(write("delete").length, 1);
  assert.ok(write("delete")[0].ops.some(([op, column, value]) => op === "eq" && column === "id" && value === id));
  const bad = fakeDb();
  assert.equal((await deleteHeroBanner(bad.db, "")).ok, false);
  assert.equal(bad.calls.length, 0);
});

test("the interval is saved within its range under the carousel's settings key", async () => {
  const { db, write } = fakeDb();
  assert.deepEqual(await saveHeroInterval(db, "60"), { ok: true, seconds: 20 });
  assert.deepEqual((write("upsert")[0].payload as { key: string; value: unknown }).key, HERO_SETTINGS_KEY);
  assert.deepEqual((write("upsert")[0].payload as { key: string; value: unknown }).value, { intervalSeconds: 20 });
  assert.equal((await saveHeroInterval(fakeDb().db, "abc")).ok, false);
});

test("the seeded banners are the built-in set, word for word", () => {
  const seed = readFileSync(new URL("../supabase/migrations/20261116150000_home_hero_banners.sql", import.meta.url), "utf8");
  for (const slide of DEFAULT_HERO_SLIDES) {
    for (const text of [...slide.ko.headline, slide.ko.badge, slide.ko.body, ...(slide.en?.headline ?? []), slide.en?.body, slide.linkUrl]) {
      if (text) assert.ok(seed.includes(`'${text}'`), `${slide.design}: ${text}`);
    }
  }
});

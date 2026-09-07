import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test, { before } from "node:test";
import { build, transform } from "esbuild";
import ts from "typescript";

import * as tags from "../src/lib/public-cache-tags";

const require = createRequire(import.meta.url);
Object.assign(globalThis, { AsyncLocalStorage });
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");

type Result = { data: unknown; error?: { message: string } };
type Fixture = {
  requests: string[];
  clients: Array<{ key: string; options: unknown }>;
  query: (table: string, columns: string) => Promise<Result>;
};
const fixture: Fixture = { requests: [], clients: [], query: async () => ({ data: [] }) };
Object.assign(globalThis, { __publicDataFixture: fixture });

const bundlePromise = build({
  stdin: {
    contents: `export * from './src/lib/public-catalog'; export * from './src/lib/public-ad-banners';`,
    resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "public-query-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(server-only|@supabase\/supabase-js|@\/lib\/supabase\/(env|admin))$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      loader: "js",
      contents: path === "server-only" ? "" : path.endsWith("/env")
        ? `export const getSupabaseEnv=()=>({url:'https://fixture.invalid',anonKey:'fixture-anon'});`
        : path.endsWith("/admin")
          ? `import {createClient} from '@supabase/supabase-js'; export const createAdminClient=()=>createClient('fixture','fixture-admin',{});`
          : `export function createClient(_url,key,options){
            const f=globalThis.__publicDataFixture; f.clients.push({key,options});
            return {from(table){let columns='';const q={
              select(value){columns=value;return q}, eq(){return q}, in(){return q}, order(){return q}, maybeSingle(){return q},
              then(resolve,reject){f.requests.push(table);return f.query(table,columns).then(resolve,reject)}
            };return q;}};
          }`,
    }));
  } }],
});
const output = { exports: {} as {
  getPublicAlbumCatalog: () => Promise<{ packages: Array<{ name: string; stations: unknown[] }>; albumDiscountPercent: number; profanityTerms: unknown[] }>;
  getPublicAdBanners: () => Promise<unknown[]>;
  selectPublicAdBanners: (rows: unknown[], placement: string, now: Date) => Array<{ id: string }>;
} };
before(async () => {
  const bundled = await bundlePromise;
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, output, output.exports);
});

function createCache() {
  const entries = new Map<string, { value: unknown; tags: string[] }>();
  const incrementalCache = {
    generateSimpleCacheKey: async (key: string) => key,
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: unknown, options: { tags: string[] }) => {
      entries.set(key, { value, tags: options.tags });
    },
  };
  return {
    entries,
    invalidate(tag: string) {
      for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key);
    },
    async request<T>(operation: () => Promise<T>) {
      // Exercise installed Next's real unstable_cache in a dynamic App Router
      // request, with only the persistent cache storage replaced by a fixture.
      const store = { route: "/dashboard/new/album", forceDynamic: true, isStaticGeneration: false, incrementalCache, pendingRevalidates: {} };
      return workAsyncStorage.run(store, async () => {
        const result = await operation();
        await Promise.all(Object.values(store.pendingRevalidates));
        return result;
      });
    },
  };
}

const packageRow = { id: "package", name: "기본", station_count: 3, price_krw: 10000, description: null, package_stations: [] };

test("public catalog queries run together and dynamic requests share only public data", async () => {
  const cache = createCache();
  fixture.requests = []; fixture.clients = [];
  const releases: Array<() => void> = [];
  fixture.query = async (table) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return { data: table === "packages" ? [packageRow, { ...packageRow, name: "[테스트] 숨김" }]
      : table === "site_settings" ? { value: { discountPercent: 30 } } : [{ term: "fixture", language: "KO" }] };
  };
  const firstRequest = cache.request(output.exports.getPublicAlbumCatalog);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(new Set(fixture.requests), new Set(["packages", "site_settings", "profanity_terms"]));
  assert.equal(releases.length, 3, "all public reads start before any one resolves");
  releases.forEach((release) => release());
  const first = await firstRequest;
  assert.equal(first.packages.length, 1);
  assert.equal(first.packages[0].stations.length, 3);
  assert.equal(first.albumDiscountPercent, 30);
  assert.deepEqual(await cache.request(output.exports.getPublicAlbumCatalog), first);
  assert.equal(fixture.requests.length, 3, "warm dynamic render issues no additional public queries");
  assert.equal(cache.entries.size, 3);
  assert.ok(fixture.clients.every(({ key }) => key === "fixture-anon"));
  assert.ok(fixture.clients.every(({ options }) => !JSON.stringify(options).includes("cookies")));
  cache.invalidate(tags.PUBLIC_ALBUM_DISCOUNT_CACHE_TAG);
  fixture.query = async () => ({ data: { value: 50 } });
  assert.equal((await cache.request(output.exports.getPublicAlbumCatalog)).albumDiscountPercent, 50);
  assert.deepEqual(fixture.requests, ["packages", "site_settings", "profanity_terms", "site_settings"]);
});

test("failed catalog loads and schema fallbacks do not poison later requests", async () => {
  const cache = createCache();
  fixture.requests = [];
  fixture.query = async (table, columns) => table === "packages" && !columns.includes("package_stations")
    ? { data: [packageRow] } : { data: null, error: { message: "temporary fixture outage" } };
  const warn = console.warn; console.warn = () => {};
  try {
    const fallback = await cache.request(output.exports.getPublicAlbumCatalog);
    assert.equal(fallback.packages.length, 1);
    assert.equal(fallback.albumDiscountPercent, 0);
    assert.deepEqual(fallback.profanityTerms, []);
    assert.equal(cache.entries.size, 0);
    fixture.query = async (table) => ({ data: table === "packages" ? [packageRow]
      : table === "site_settings" ? { value: 20 } : [{ term: "recovered", language: "EN" }] });
    const recovered = await cache.request(output.exports.getPublicAlbumCatalog);
    assert.equal(recovered.albumDiscountPercent, 20);
    assert.equal(recovered.profanityTerms.length, 1);
    assert.equal(cache.entries.size, 3);
  } finally { console.warn = warn; }
});

test("shared banner cache preserves schedule boundaries, placement order and image validation", async () => {
  const cache = createCache();
  fixture.requests = [];
  const row = { title: "Fixture", description: null, image_url: "/fixture.svg", link_url: null, starts_at: null, ends_at: null, sort_order: 0, placement: "HOME_HERO" };
  fixture.query = async () => ({ data: [
    { ...row, id: "later", starts_at: "2026-09-07T01:00:00Z" },
    { ...row, id: "ends", ends_at: "2026-09-07T00:59:59Z", sort_order: 2 },
    { ...row, id: "first", sort_order: 1 },
    { ...row, id: "unsafe", image_url: "https://unsafe.invalid/a.png" },
    { ...row, id: "strip", placement: "STRIP" },
  ] });
  const before = await cache.request(output.exports.getPublicAdBanners);
  const after = await cache.request(output.exports.getPublicAdBanners);
  assert.deepEqual(fixture.requests, ["ad_banners"]);
  assert.deepEqual(output.exports.selectPublicAdBanners(before, "HOME_HERO", new Date("2026-09-07T00:59:58Z")).map(({ id }) => id), ["first", "ends"]);
  assert.deepEqual(output.exports.selectPublicAdBanners(after, "HOME_HERO", new Date("2026-09-07T01:00:00Z")).map(({ id }) => id), ["later", "first"]);
  assert.deepEqual(output.exports.selectPublicAdBanners(after, "STRIP", new Date()).map(({ id }) => id), ["strip"]);
  cache.invalidate(tags.PUBLIC_AD_BANNERS_CACHE_TAG);
  fixture.query = async () => ({ data: [] });
  assert.deepEqual(await cache.request(output.exports.getPublicAdBanners), []);
});

test("all direct admin catalog mutations invalidate their public cache after successful writes", async () => {
  const actionTags: Record<string, string> = {
    upsertPackageAction: tags.PUBLIC_CATALOG_CACHE_TAG,
    upsertStationAction: tags.PUBLIC_CATALOG_CACHE_TAG,
    updatePackageStationsAction: tags.PUBLIC_CATALOG_CACHE_TAG,
    updateAlbumReviewDiscountAction: tags.PUBLIC_ALBUM_DISCOUNT_CACHE_TAG,
    deletePackageAction: tags.PUBLIC_CATALOG_CACHE_TAG,
    deleteStationAction: tags.PUBLIC_CATALOG_CACHE_TAG,
    upsertAdBannerAction: tags.PUBLIC_AD_BANNERS_CACHE_TAG,
    deleteAdBannerAction: tags.PUBLIC_AD_BANNERS_CACHE_TAG,
    upsertProfanityTermAction: tags.PUBLIC_PROFANITY_TERMS_CACHE_TAG,
    deleteProfanityTermAction: tags.PUBLIC_PROFANITY_TERMS_CACHE_TAG,
  };
  const source = readFileSync("src/features/admin/actions.ts", "utf8");
  const ast = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && actionTags[node.name.text]);
  const code = await transform(declarations.map((node) => node.getText(ast)).join("\n"), { loader: "ts", format: "cjs" });
  let error: unknown = null;
  let authorized = true;
  const events: string[] = [];
  const q = { upsert() { return q; }, delete() { return q; }, insert() { return q; }, select() { return q; }, eq() { return q; }, in() { return q; }, then(resolve: (value: unknown) => void) { events.push("query"); return Promise.resolve({ data: [], error }).then(resolve); } };
  const schema = { safeParse: (data: unknown) => ({ success: true, data }) };
  const context = {
    ...tags,
    requireAdminAction: async () => { events.push("authorize"); if (!authorized) throw new Error("forbidden"); },
    createServerSupabase: async () => ({ from: () => q }),
    updateTag: (tag: string) => events.push(tag),
    packageSchema: schema, stationSchema: schema, packageStationsSchema: schema,
    albumReviewDiscountSchema: schema, adBannerSchema: schema, profanityTermSchema: schema,
    normalizeAlbumDiscountPercent: (value: number) => value,
    ALBUM_REVIEW_DISCOUNT_SETTING_KEY: "album_review_discount_percent",
  };
  const actionBundle = { exports: {} as Record<string, (payload: unknown) => Promise<{ error?: string }>> };
  new Function("module", "exports", ...Object.keys(context), code.code)(actionBundle, actionBundle.exports, ...Object.values(context));
  const payload = { id: "fixture", imageUrl: "/fixture.svg", stationCodes: "", discountPercent: 30, term: "fixture" };
  const consoleError = console.error; console.error = () => {};
  try {
    for (const [name, tag] of Object.entries(actionTags)) {
      events.length = 0; error = null;
      assert.equal((await actionBundle.exports[name](payload)).error, undefined, name);
      assert.equal(events[0], "authorize", name);
      assert.equal(events.at(-1), tag, name);
      events.length = 0; error = { message: "fixture failure" };
      assert.ok((await actionBundle.exports[name](payload)).error, name);
      assert.ok(!events.includes(tag), `${name} must not cache-invalidate a failed write`);
      events.length = 0; authorized = false;
      await assert.rejects(actionBundle.exports[name](payload), /forbidden/);
      assert.deepEqual(events, ["authorize"]);
      authorized = true;
    }
  } finally { console.error = consoleError; }
});

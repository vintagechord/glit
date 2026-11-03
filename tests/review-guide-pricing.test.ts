import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import test, { before } from "node:test";
import { build } from "esbuild";

import { PUBLIC_CATALOG_CACHE_TAG } from "../src/lib/public-cache-tags";
import { FALLBACK_ALBUM_PACKAGES, type AlbumPackage } from "../src/lib/review-guides";

const require = createRequire(import.meta.url);
Object.assign(globalThis, { AsyncLocalStorage });
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external");

type Result = { data: unknown; error?: { message: string } };
type Fixture = { requests: string[]; query: (table: string, columns: string) => Promise<Result> };
const fixture: Fixture = { requests: [], query: async () => ({ data: [] }) };
Object.assign(globalThis, { __guidePricingFixture: fixture });

// The guide loader runs against the real public catalog and installed Next's
// unstable_cache; only Supabase and the persistent cache storage are fixtures.
const bundlePromise = build({
  stdin: { contents: `export * from './src/lib/review-guide-pricing';`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
  plugins: [{ name: "guide-pricing-fixture", setup(plugin) {
    plugin.onResolve({ filter: /^(server-only|@supabase\/supabase-js|@\/lib\/supabase\/env)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
      loader: "js",
      contents: path === "server-only" ? "" : path.endsWith("/env")
        ? `export const getSupabaseEnv=()=>({url:'https://fixture.invalid',anonKey:'fixture-anon'});`
        : `export function createClient(){
            const f=globalThis.__guidePricingFixture;
            return {from(table){let columns='';const q={
              select(value){columns=value;return q}, eq(){return q}, order(){return q},
              then(resolve,reject){f.requests.push(table);return f.query(table,columns).then(resolve,reject)}
            };return q;}};
          }`,
    }));
  } }],
});
const output = { exports: {} as { loadAlbumPackages: () => Promise<AlbumPackage[]> } };
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
      const store = { route: "/guide/album-review", forceDynamic: true, isStaticGeneration: false, incrementalCache, pendingRevalidates: {} };
      return workAsyncStorage.run(store, async () => {
        const result = await operation();
        await Promise.all(Object.values(store.pendingRevalidates));
        return result;
      });
    },
  };
}

const packageRow = (name: string, stationCount: number, priceKrw: number) => ({
  id: name, name, station_count: stationCount, price_krw: priceKrw, description: null,
  package_stations: [{ station: { id: "kbs", name: "KBS 한국방송", code: "KBS" } }],
});

test("guide prices follow admin package edits and never show test packages", async () => {
  const cache = createCache();
  let price = 50_000;
  fixture.query = async (table) => ({ data: table === "packages"
    ? [packageRow("3곳 패키지", 3, price), packageRow("[테스트] 결제 확인", 1, 100)]
    : [] });
  const first = await cache.request(output.exports.loadAlbumPackages);
  assert.deepEqual(first, [{ name: "3곳 패키지", stationCount: 3, priceKrw: 50_000, stations: ["KBS", "MBC", "SBS"] }]);
  assert.ok([...cache.entries.values()].some((entry) => entry.tags.includes(PUBLIC_CATALOG_CACHE_TAG)), "the guide reads the tagged catalog cache");

  price = 55_000;
  assert.equal((await cache.request(output.exports.loadAlbumPackages))[0].priceKrw, 50_000, "cached until the catalog tag is updated");
  cache.invalidate(PUBLIC_CATALOG_CACHE_TAG);
  assert.equal((await cache.request(output.exports.loadAlbumPackages))[0].priceKrw, 55_000);
});

test("a catalog outage keeps the last known guide prices", async () => {
  const cache = createCache();
  fixture.query = async () => ({ data: null, error: { message: "fixture outage" } });
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await cache.request(output.exports.loadAlbumPackages), FALLBACK_ALBUM_PACKAGES);
    assert.equal(cache.entries.size, 0, "an outage is never cached");
  } finally { console.warn = warn; }
});

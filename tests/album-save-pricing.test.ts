import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { getAlbumReviewPriceKrw } from "../src/lib/album-pricing";
import { resolveCanonicalAlbumStationSelection } from "../src/lib/submission-station-selection";

// Execute the actual save action's package validation and price assignment,
// keeping the database behind a fixture so no account or order is mutated.
const source = readFileSync(new URL("../src/features/submissions/actions.ts", import.meta.url), "utf8");
const start = source.indexOf("  const hasPackage = Boolean(parsed.data.packageId);");
const endMarker = "  amountKrw = Math.max(0, amountKrw);";
const end = source.indexOf(endMarker, start) + endMarker.length;
assert.ok(start >= 0 && end > start, "album save pricing block must be present");
const compiled = ts.transpileModule(
  `async function quote(db, parsed, isSubmitted) {
    ${source.slice(start, end)}
    return { amountKrw, serverBasePriceKrw, albumPriceTier, canonicalAlbumStationIds };
  }
  return quote;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
const quote = new Function("getAlbumReviewPriceKrw", "resolveCanonicalAlbumStationSelection", compiled)(
  getAlbumReviewPriceKrw,
  resolveCanonicalAlbumStationSelection,
) as (db: unknown, parsed: { data: Record<string, unknown> }, submitted: boolean) => Promise<{
  amountKrw?: number;
  serverBasePriceKrw?: number;
  albumPriceTier?: string;
  canonicalAlbumStationIds?: string[];
  error?: string;
}>;

function database(packagePrice = 100000, unavailable = false) {
  const reads: string[] = [];
  const stationIds = ["station-kbs", "station-mbc", "station-sbs"];
  return {
    reads,
    from(table: string) {
      reads.push(table);
      const result = () => ({
        data: table === "packages"
          ? unavailable ? null : { price_krw: packagePrice, station_count: 3 }
          : table === "package_stations"
            ? stationIds.map(station_id => ({ station_id }))
            : stationIds.map(id => ({ id })),
        error: null,
      });
      const query = {
        select() { return query; },
        eq() { return query; },
        in() { return query; },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve: (value: ReturnType<typeof result>) => void) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return query;
    },
  };
}

test("draft and submitted saves ignore stale campaign prices and additional-album requests", async () => {
  for (const submitted of [false, true]) {
    for (const requestedAmount of [0, 1, 35000, 50000, 70000, 100000]) {
      const db = database();
      const result = await quote(db, { data: {
        packageId: "package-3",
        amountKrw: requestedAmount,
        albumDiscountPercent: 30,
        albumPriceTier: "ADDITIONAL",
      } }, submitted);
      assert.equal(result.error, undefined);
      assert.equal(result.amountKrw, 100000);
      assert.equal(result.serverBasePriceKrw, 100000);
      assert.equal(result.albumPriceTier, "FULL");
      assert.ok(!db.reads.includes("site_settings"));
      assert.ok(!db.reads.includes("submissions"), "legacy discount eligibility is no longer queried");
    }
  }
});

test("save pricing uses a newly changed package price and still validates submission stations", async () => {
  const db = database(120000);
  const result = await quote(db, { data: { packageId: "package-3", amountKrw: 100000 } }, true);
  assert.equal(result.amountKrw, 120000);
  assert.deepEqual(result.canonicalAlbumStationIds, ["station-kbs", "station-mbc", "station-sbs"]);
  assert.deepEqual(db.reads, ["packages", "package_stations", "stations"]);
});

test("a missing, inactive or unavailable package cannot produce a payable quote", async () => {
  assert.ok((await quote(database(), { data: { amountKrw: 1 } }, true)).error);
  assert.ok((await quote(database(100000, true), { data: { packageId: "inactive", amountKrw: 1 } }, true)).error);
  assert.ok((await quote(database(0), { data: { packageId: "free", amountKrw: 1 } }, true)).error);
});

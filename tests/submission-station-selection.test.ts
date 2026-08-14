import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveCanonicalAlbumStationSelection,
  resolveCanonicalMvStationSelection,
} from "../src/lib/submission-station-selection";

const stations = [
  { id: "station-kbs", code: "KBS" },
  { id: "station-mbc", code: "MBC" },
  { id: "station-sbs", code: "SBS" },
  { id: "station-etn", code: "ETN" },
  { id: "station-mnet", code: "MNET" },
];

const actionsSource = readFileSync(
  new URL("../src/features/submissions/actions.ts", import.meta.url),
  "utf8",
);

test("album reviews use the package station rows and reject incomplete configuration", () => {
  assert.deepEqual(
    resolveCanonicalAlbumStationSelection({
      stationIds: ["station-kbs", "station-mbc", "station-sbs"],
      expectedCount: 3,
    }),
    {
      ok: true,
      stationIds: ["station-kbs", "station-mbc", "station-sbs"],
    },
  );
  assert.deepEqual(
    resolveCanonicalAlbumStationSelection({
      stationIds: ["station-kbs", "station-mbc"],
      expectedCount: 3,
    }),
    { ok: false, reason: "COUNT_MISMATCH" },
  );
});

test("MV station price and review IDs come from the same canonical rows", () => {
  assert.deepEqual(
    resolveCanonicalMvStationSelection({
      mvType: "MV_BROADCAST",
      requestedCodes: ["kbs", "MBC", "KBS"],
      stations,
    }),
    {
      ok: true,
      stationIds: ["station-kbs", "station-mbc"],
      stationCodes: ["KBS", "MBC"],
      stationAmountKrw: 80_000,
    },
  );
});

test("MV station selection may be resolved from canonical IDs", () => {
  assert.deepEqual(
    resolveCanonicalMvStationSelection({
      mvType: "MV_DISTRIBUTION",
      requestedIds: ["station-mnet", "station-etn"],
      stations,
    }),
    {
      ok: true,
      stationIds: ["station-mnet", "station-etn"],
      stationCodes: ["MNET", "ETN"],
      stationAmountKrw: 60_000,
    },
  );
});

test("MV station IDs cannot add reviews beyond the priced code selection", () => {
  assert.deepEqual(
    resolveCanonicalMvStationSelection({
      mvType: "MV_BROADCAST",
      requestedCodes: ["MBC"],
      requestedIds: ["station-mbc", "station-kbs", "station-sbs"],
      stations,
    }),
    { ok: false, reason: "SELECTION_MISMATCH" },
  );
});

test("MV selection rejects unsupported product codes and unknown stations", () => {
  assert.deepEqual(
    resolveCanonicalMvStationSelection({
      mvType: "MV_DISTRIBUTION",
      requestedCodes: ["KBS"],
      stations,
    }),
    { ok: false, reason: "INVALID_CODE" },
  );
  assert.deepEqual(
    resolveCanonicalMvStationSelection({
      mvType: "MV_BROADCAST",
      requestedCodes: ["ETN"],
      stations: stations.filter((station) => station.code !== "ETN"),
    }),
    { ok: false, reason: "STATION_NOT_FOUND" },
  );
});

test("server canonical station lookups exclude inactive stations", () => {
  const activeStationFilters = actionsSource.match(
    /\.eq\("is_active", true\)/g,
  );
  assert.ok(
    (activeStationFilters?.length ?? 0) >= 2,
    "album and MV canonical station queries must require active stations",
  );
});

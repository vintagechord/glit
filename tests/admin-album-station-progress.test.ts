import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadAlbumStationProgress,
  summarizeAlbumStationProgress,
  tracksStationProgress,
} from "../src/lib/admin/album-station-progress";
import { getPackageStationCodes } from "../src/lib/station-reviews";
import { stationReviewAnchor } from "../src/lib/admin/station-anchors";

const codes10 = getPackageStationCodes(10, "10곳");
const catalog = codes10.map((code, index) => ({ id: `st-${index}`, name: code === "TBS" ? "TBS 교통방송" : code, code }));
const review = (code: string, status: string, track_results?: unknown) => {
  const station = catalog.find((item) => item.code === code)!;
  return { submission_id: "a1", station_id: station.id, status, track_results, station };
};

test("a 10-station album with 6 results lists the 4 open stations in package order", () => {
  const progress = summarizeAlbumStationProgress({
    expectedCodes: codes10,
    catalog,
    reviews: [
      review("MBC", "APPROVED"), review("KBS", "APPROVED"), review("SBS", "REJECTED"),
      review("YTN", "APPROVED"), review("CBS", "APPROVED"), review("BBS", "APPROVED"),
      review("TBS", "SENT"), review("WBS", "NOT_SENT"),
    ],
  });
  assert.equal(progress.total, 10);
  assert.equal(progress.completed, 6);
  // PBC and ARIRANG have no review row yet: they read as 접수예정, not as done.
  assert.deepEqual(progress.pending.map((station) => station.code), ["TBS", "PBC", "WBS", "ARIRANG"]);
  assert.equal(progress.pending[0].name, "TBS 교통방송");
  assert.equal(progress.pending[0].shortName, "TBS");
  assert.ok(progress.pending.every((station) => station.attention === null));
});

test("a station still waiting on some songs, or asked for a fix, is open", () => {
  const progress = summarizeAlbumStationProgress({
    expectedCodes: ["KBS", "MBC", "SBS"],
    catalog: catalog.filter((station) => ["KBS", "MBC", "SBS"].includes(station.code)),
    reviews: [
      review("KBS", "SENT", [{ track_no: 1, status: "APPROVED" }, { track_no: 2, status: "PENDING" }]),
      review("MBC", "NEEDS_FIX"),
      review("SBS", "APPROVED", [{ track_no: 1, status: "APPROVED" }, { track_no: 2, status: "REJECTED" }]),
    ],
    albumTracks: [{ id: "t1", track_no: 1 }, { id: "t2", track_no: 2 }],
  });
  assert.equal(progress.completed, 1);
  assert.deepEqual(progress.pending.map((station) => [station.code, station.attention]), [["KBS", null], ["MBC", "보완 요청"]]);
});

test("WBS on a 4+ song album without its 3 songs chosen asks for the selection", () => {
  const progress = summarizeAlbumStationProgress({
    expectedCodes: ["WBS"],
    catalog: catalog.filter((station) => station.code === "WBS"),
    reviews: [review("WBS", "APPROVED")],
    albumTracks: [1, 2, 3, 4].map((no) => ({ id: `t${no}`, track_no: no })),
  });
  assert.equal(progress.completed, 0);
  assert.equal(progress.pending[0].attention, "심의곡 확인 필요");
});

test("only paid albums are tracked", () => {
  const base = { id: "a", type: "ALBUM", status: "IN_PROGRESS", payment_status: "PAID" };
  assert.equal(tracksStationProgress(base), true);
  assert.equal(tracksStationProgress({ ...base, payment_status: "UNPAID" }), false);
  assert.equal(tracksStationProgress({ ...base, payment_status: "REFUNDED" }), false);
  assert.equal(tracksStationProgress({ ...base, type: "MV_BROADCAST" }), false);
  assert.equal(tracksStationProgress({ ...base, status: "DRAFT" }), false);
});

test("the list anchor matches the detail page's station form id", () => {
  assert.equal(stationReviewAnchor("GYEONGIN_IFM"), "station-GYEONGIN_IFM");
  assert.equal(stationReviewAnchor(null, "uuid-1"), "station-uuid-1");
  assert.equal(stationReviewAnchor(null, null), "station-results");
});

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

function fakeDb(answers: Record<string, Answer | ((select: string) => Answer)>) {
  const calls: Array<{ table: string; select: string; ids: unknown }> = [];
  const db = {
    from(table: string) {
      let select = "";
      const chain = {
        select(value: string) { select = value; return chain; },
        in(_column: string, ids: unknown) {
          calls.push({ table, select, ids });
          const answer = answers[table];
          return Promise.resolve(typeof answer === "function" ? answer(select) : answer);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const rows = [
  { id: "a1", type: "ALBUM", status: "IN_PROGRESS", payment_status: "PAID", package: { name: "3곳", station_count: 3 } },
  { id: "a2", type: "ALBUM", status: "SUBMITTED", payment_status: "UNPAID", package: { name: "3곳", station_count: 3 } },
  { id: "m1", type: "MV_DISTRIBUTION", status: "IN_PROGRESS", payment_status: "PAID", package: null },
];
const kbs = { id: "st-kbs", name: "KBS", code: "KBS" };

test("the page loads every paid album's stations in one query per table", async () => {
  const { db, calls } = fakeDb({
    station_reviews: { data: [{ submission_id: "a1", station_id: kbs.id, status: "APPROVED", track_results: null, station: kbs }], error: null },
    album_tracks: { data: [], error: null },
    stations: { data: [kbs, { id: "st-mbc", name: "MBC", code: "MBC" }, { id: "st-sbs", name: "SBS", code: "SBS" }], error: null },
  });
  const progress = await loadAlbumStationProgress(db, rows);
  assert.deepEqual([...progress.keys()], ["a1"]);
  assert.deepEqual(progress.get("a1")?.pending.map((station) => station.code), ["MBC", "SBS"]);
  assert.equal(progress.get("a1")?.completed, 1);
  assert.equal(calls.filter((call) => call.table === "station_reviews").length, 1);
  assert.deepEqual(calls[0].ids, ["a1"]);
});

test("an older schema without track_results_json falls back, and a failure shows nothing", async () => {
  const legacy = fakeDb({
    station_reviews: (select) => select.includes("track_results_json")
      ? { data: null, error: { code: "42703", message: "column station_reviews.track_results_json does not exist" } }
      : { data: [], error: null },
    album_tracks: { data: [], error: null },
    stations: { data: [kbs], error: null },
  });
  const fallback = await loadAlbumStationProgress(legacy.db, rows);
  assert.equal(fallback.get("a1")?.pending.length, 1);

  const down = fakeDb({
    station_reviews: { data: null, error: { message: "timeout" } },
    album_tracks: { data: [], error: null },
    stations: { data: [kbs], error: null },
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await loadAlbumStationProgress(down.db, rows)).size, 0);
  } finally {
    console.warn = warn;
  }
});

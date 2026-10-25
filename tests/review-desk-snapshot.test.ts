import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDeskResults } from "../src/lib/admin/review-desk";

test("desktop snapshot preserves requested broadcasters, excludes generic legacy rows and keeps private object keys out", async () => {
  const rows: Record<string, unknown> = {
    submissions: { id: "submission", type: "MV_BROADCAST", status: "IN_PROGRESS", package_id: "package", mv_selected_station_codes: ["MBC", "MV_BROADCAST"], updated_at: "2026-10-25T00:00:00Z", certificate_b2_path: "private/previous.pdf" },
    station_reviews: [
      { station_id: "kbs", id: "review-kbs", status: "APPROVED", age_rating: "12", updated_at: "2026-10-25T00:00:01Z", station: { id: "kbs", code: "KBS", name: "KBS" } },
      { station_id: "generic", id: "review-generic", status: "APPROVED", updated_at: "2026-10-25T00:00:02Z", station: { id: "generic", code: "MV_BROADCAST", name: "신청 방송국" } },
    ],
    album_tracks: [],
    package_stations: [{ station: { id: "kbs", code: "KBS", name: "KBS" } }],
    stations: [{ id: "mbc", code: "MBC", name: "MBC" }, { id: "generic", code: "MV_BROADCAST", name: "신청 방송국" }],
    email_outbox: [],
  };
  const db = { from(table: string) {
    const result = { data: rows[table], error: null };
    const query = { select() { return query; }, eq() { return query; }, in() { return query; }, order() { return query; }, limit() { return query; }, maybeSingle() { return Promise.resolve(result); }, then(resolve: (value: unknown) => unknown) { return Promise.resolve(result).then(resolve); } };
    return query;
  } } as unknown as SupabaseClient;
  const snapshot = await loadDeskResults(db, "submission");
  assert.deepEqual(snapshot.stations.map(station => station.code), ["KBS", "MBC"]);
  assert.equal(snapshot.stations[0].review.age_rating, "12");
  assert.equal(snapshot.stations[1].review.status, "NOT_SENT");
  assert.equal(snapshot.stations[1].review.updated_at, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /private\/previous\.pdf|certificate_b2_path/);
});

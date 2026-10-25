import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

import {
  loadSubmissionDetailRelations,
  preservePendingStationReviews,
} from "../src/lib/submissions/detail-relations";
import { SUBMISSION_USER_DETAIL_SELECT } from "../src/lib/submissions/select-columns";

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

test("detail relations start concurrently and every private query is submission scoped", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const requests: URL[] = [];
  const client = createClient("https://fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        await blocked;
        const table = url.pathname.split("/").pop();
        return response(table === "station_reviews"
          ? [{ id: "review", station: [{ id: "station", code: "KBS", name: "KBS" }] }]
          : table === "package_stations"
            ? [{ station: [{ id: "station", code: "KBS", name: "KBS" }] }]
            : []);
      },
    },
  });
  const pending = loadSubmissionDetailRelations(client, "submission-a", "package-a");
  await setImmediate();
  try {
    assert.equal(requests.length, 3, "all reads must start before any one finishes");
    for (const request of requests) {
      const isPackage = request.pathname.endsWith("/package_stations");
      assert.equal(request.searchParams.get(isPackage ? "package_id" : "submission_id"),
        isPackage ? "eq.package-a" : "eq.submission-a");
    }
  } finally {
    release();
  }
  const result = await pending;
  assert.equal(result.reviews.data?.[0].station?.code, "KBS");
  assert.equal(result.packageStations.data[0].id, "station");
  assert.deepEqual(result.files.data, []);
});

test("legacy track results fall back once without refetching independent relations", async () => {
  const requests: URL[] = [];
  const client = createClient("https://fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.searchParams.get("select")?.includes("track_results_json")) {
          return response({ code: "42703", message: "column track_results_json does not exist" }, 400);
        }
        return response([]);
      },
    },
  });
  const result = await loadSubmissionDetailRelations(client, "submission-b");
  assert.equal(result.reviews.error, null);
  assert.equal(requests.filter((url) => url.pathname.endsWith("/station_reviews")).length, 2);
  assert.equal(requests.filter((url) => url.pathname.endsWith("/submission_files")).length, 1);
  assert.ok(requests.every((url) => url.searchParams.get("submission_id") === "eq.submission-b"));
});

test("authorization failures do not trigger legacy retries", async () => {
  let reviewReads = 0;
  const client = createClient("https://fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        if (String(input).includes("/station_reviews?")) {
          reviewReads += 1;
          return response({ code: "42501", message: "permission denied for track_results_json" }, 403);
        }
        return response([]);
      },
    },
  });
  const result = await loadSubmissionDetailRelations(client, "submission-c");
  assert.equal(reviewReads, 1);
  assert.equal(result.reviews.error?.code, "42501");
});

test("refresh replaces pending stations with real results and drops deleted real rows", () => {
  const pendingKbs = { id: "placeholder-a-KBS", station: { id: "", code: "KBS" } };
  const pendingMbc = { id: "placeholder-a-MBC", station: { id: "mbc", code: "MBC" } };
  const stale = { id: "deleted-review", station: { id: "sbs", code: "SBS" } };
  const actual = { id: "actual-review", station: { id: "kbs", code: "KBS" } };
  assert.deepEqual(
    preservePendingStationReviews([pendingKbs, pendingMbc, stale], [actual]),
    [actual, pendingMbc],
  );
});

test("member details contain submitted form fields without administrative data", () => {
  for (const field of ["release_date", "genre", "mv_runtime", "mv_lyrics"]) {
    assert.ok(SUBMISSION_USER_DETAIL_SELECT.includes(field), field);
  }
  for (const field of ["admin_memo", "guest_phone", "guest_email", "bank_depositor_name"]) {
    assert.ok(!SUBMISSION_USER_DETAIL_SELECT.includes(field), field);
  }
  const page = readFileSync("src/app/dashboard/submissions/[id]/view.tsx", "utf8");
  assert.doesNotMatch(page, /ensureAlbumStationReviews|\.(?:upsert|insert|update|delete)\(/);
  const client = readFileSync("src/features/submissions/submission-detail-client.tsx", "utf8");
  assert.match(client, /if \(!initialDataComplete\) void fetchLatest\(\)/);
});

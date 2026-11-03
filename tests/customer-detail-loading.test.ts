import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

import { CUSTOMER_SUBMISSION_DETAIL_SELECT, loadCustomerSubmissionDetail } from "../src/lib/submissions/customer-detail";

const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const submissionRow = {
  id: "70ecdcc6-2d2d-4885-a9e3-76ee99930a84", user_id: null, guest_token: "957a6340-d6ac-409a-8733-a013ff1be40c", type: "ALBUM", status: "IN_PROGRESS", payment_status: "PAID",
  title: "지금이 딱 좋아", artist_name: "김수련", release_date: "2026-11-18", genre: "성인가요", distributor: "오감 엔터테인먼트", production_company: "OK엔터테인먼트",
  previous_release: "2023 무실", artist_type: null, artist_members: null, applicant_name: "김수련", applicant_phone: "010", applicant_email: "a@b.c",
  package_id: "138f50b5-56d1-448b-a566-dd092e7b23bc", package: [{ name: "13곳", station_count: 13, price_krw: 130000 }], amount_krw: 130000,
  created_at: "2026-11-02T09:37:38Z", updated_at: "2026-11-02T09:38:50Z",
  album_tracks: [{ id: "t1", track_no: 1, track_title: "지금이 딱 좋아" }],
};

function client(requests: URL[]) {
  return createClient("https://fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        const table = url.pathname.split("/").pop();
        if (table === "submissions") return response(submissionRow);
        if (table === "station_reviews") return response([{ id: "r1", submission_id: submissionRow.id, station_id: "s-kbs", status: "SENT", result_note: null, updated_at: "2026-11-02T09:38:50Z", station: [{ id: "s-kbs", code: "KBS", name: "KBS" }] }]);
        if (table === "package_stations") return response([{ station: [{ id: "s-kbs", code: "KBS", name: "KBS" }] }, { station: [{ id: "s-mbc", code: "MBC", name: "MBC" }] }]);
        return response([]);
      },
    },
  });
}

test("the customer detail select carries the application-form fields the result page renders", () => {
  for (const column of ["release_date", "genre", "distributor", "production_company", "previous_release", "artist_type", "artist_gender", "artist_members", "melon_url", "is_oneclick", "ai_used", "guest_token", "guest_name", "applicant_name", "applicant_phone", "applicant_email"]) {
    assert.ok(CUSTOMER_SUBMISSION_DETAIL_SELECT.split(",").map((part) => part.trim()).includes(column), column);
  }
  assert.match(CUSTOMER_SUBMISSION_DETAIL_SELECT, /album_tracks \(.*composer.*lyrics.*\)/);
});

test("a guest lookup is scoped to a guest submission with that token and returns the full form plus station placeholders", async () => {
  const requests: URL[] = [];
  const detail = await loadCustomerSubmissionDetail(client(requests), { guestToken: submissionRow.guest_token }, { onError: () => undefined });
  assert.ok(detail);
  const submissionQuery = requests.find((url) => url.pathname.endsWith("/submissions"))!;
  assert.equal(submissionQuery.searchParams.get("user_id"), "is.null");
  assert.equal(submissionQuery.searchParams.get("guest_token"), `eq.${submissionRow.guest_token}`);
  assert.match(submissionQuery.searchParams.get("select") ?? "", /distributor/);
  const form = detail.submission as unknown as Record<string, unknown>;
  assert.equal(form.distributor, "오감 엔터테인먼트"); assert.equal(form.production_company, "OK엔터테인먼트"); assert.equal(form.release_date, "2026-11-18"); assert.equal(form.genre, "성인가요");
  assert.deepEqual(form.package, { name: "13곳", station_count: 13, price_krw: 130000 });
  assert.equal(detail.guestToken, submissionRow.guest_token); assert.equal(detail.userId, null);
  // The expected package stations without a review row appear as NOT_SENT placeholders.
  assert.deepEqual(detail.stationReviews.map((review) => [review.station?.code, review.status]), [["KBS", "SENT"], ["MBC", "NOT_SENT"]]);
  assert.ok(detail.stationReviews[1].id.startsWith("placeholder-"));
  for (const url of requests.filter((item) => !item.pathname.endsWith("/submissions"))) {
    assert.ok([...url.searchParams.values()].some((value) => value.includes(submissionRow.id) || value.includes(submissionRow.package_id)), url.pathname);
  }
});

test("an administrator preview loads by submission id without the guest-only filter", async () => {
  const requests: URL[] = [];
  const detail = await loadCustomerSubmissionDetail(client(requests), { submissionId: submissionRow.id }, { onError: () => undefined });
  assert.ok(detail);
  const submissionQuery = requests.find((url) => url.pathname.endsWith("/submissions"))!;
  assert.equal(submissionQuery.searchParams.get("id"), `eq.${submissionRow.id}`);
  assert.equal(submissionQuery.searchParams.get("guest_token"), null);
});

test("a missing column is dropped and retried instead of failing the page", async () => {
  const requests: URL[] = [];
  const retrying = createClient("https://fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        const table = url.pathname.split("/").pop();
        if (table === "submissions" && (url.searchParams.get("select") ?? "").includes("artist_gender")) {
          return response({ code: "42703", message: 'column submissions.artist_gender does not exist' }, 400);
        }
        return response(table === "submissions" ? submissionRow : []);
      },
    },
  });
  const detail = await loadCustomerSubmissionDetail(retrying, { submissionId: submissionRow.id }, { onError: () => undefined });
  assert.ok(detail);
  assert.equal(requests.filter((url) => url.pathname.endsWith("/submissions")).length, 2);
});

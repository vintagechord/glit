import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  adminOperationalStageValues,
  mapAdminOperationalStage,
  storedOperationalStage,
} from "../src/lib/admin/operational-stage";

test("the stage select stands on the stage that was saved, whatever the stations say", () => {
  // Saved from a paid album in review: every stage the administrator can
  // pick reads back as itself, so the next save changes nothing.
  for (const stage of ["REVIEW_IN_PROGRESS", "RESULT_NOTIFIED"] as const) {
    const stored = mapAdminOperationalStage(stage, "PAID", "IN_PROGRESS");
    assert.equal(storedOperationalStage({ status: stored.status, payment_status: stored.paymentStatus }), stage);
  }
  // 결과 준비 on an album whose stations are only 접수완료 is still 결과 준비.
  assert.equal(storedOperationalStage({ status: "RESULT_READY", payment_status: "PAID" }), "RESULT_NOTIFIED");
  assert.equal(storedOperationalStage({ status: "COMPLETED", payment_status: "PAID" }), "RESULT_NOTIFIED");
  assert.equal(storedOperationalStage({ status: "IN_PROGRESS", payment_status: "PAID" }), "REVIEW_IN_PROGRESS");
  assert.equal(storedOperationalStage({ status: "PRE_REVIEW", payment_status: "PAID" }), "PAYMENT_COMPLETE");
  for (const payment of ["UNPAID", "PAYMENT_PENDING", null]) {
    for (const status of ["SUBMITTED", "WAITING_PAYMENT", "PRE_REVIEW"]) {
      assert.equal(storedOperationalStage({ status, payment_status: payment }), "APPLICATION_RECEIVED");
    }
  }
});

test("saving the stage a row already stands on stores the same row", () => {
  const rows = [
    ["SUBMITTED", "UNPAID"], ["WAITING_PAYMENT", "PAYMENT_PENDING"], ["WAITING_PAYMENT", "UNPAID"],
    ["PRE_REVIEW", "PAID"], ["IN_PROGRESS", "PAID"], ["RESULT_READY", "PAID"],
  ] as const;
  for (const [status, paymentStatus] of rows) {
    const stage = storedOperationalStage({ status, payment_status: paymentStatus });
    assert.deepEqual(mapAdminOperationalStage(stage, paymentStatus, status), { status, paymentStatus }, `${status}/${paymentStatus}`);
  }
  // Marking an unpaid application paid queues the material check.
  assert.deepEqual(mapAdminOperationalStage("PAYMENT_COMPLETE", "PAYMENT_PENDING", "WAITING_PAYMENT"), { status: "PRE_REVIEW", paymentStatus: "PAID" });
  assert.equal(adminOperationalStageValues.length, 4);
});

test("the album detail page reads the stage from the stored row", () => {
  const page = readFileSync("src/app/admin/submissions/detail/page.tsx", "utf8");
  assert.match(page, /storedOperationalStage\(submission\)/);
  assert.doesNotMatch(page, /hasAlbumResultNotified\)\s*\?\s*"RESULT_NOTIFIED"/, "station results no longer decide the album stage");
});

test("a card order whose payment never finished can be settled or removed by the administrator", () => {
  const migration = readFileSync("supabase/migrations/20261119120000_admin_unpaid_card_order_resolution.sql", "utf8");
  // Open attempts are closed before the application is detached, deleted or marked paid;
  // the two PAYMENT_IN_PROGRESS triggers refuse any change while one is REQUESTED.
  for (const code of ["ADMIN_DELETED", "ADMIN_MARKED_PAID"]) {
    assert.match(migration, new RegExp(`close_submission_payment_order\\(p\\.order_id, 'CANCELED', '${code}'`));
  }
  // An approval the gateway is confirming, or whose outcome is unknown, stays protected.
  assert.equal(migration.match(/'APPROVAL_IN_PROGRESS','APPROVAL_UNCERTAIN','CAPTURE_IN_PROGRESS'/g)?.length, 2);
  assert.match(migration, /grant execute on function public\.admin_confirm_unpaid_order_payment\(uuid,uuid,text\) to service_role/);
  const actions = readFileSync("src/features/admin/actions.ts", "utf8");
  assert.match(actions, /PAYMENT_IN_PROGRESS[\s\S]{0,200}결제창이 열린 채 끝나지 않은 접수/);
});

test("station results no longer pull an album back out of 결과 준비", () => {
  const migration = readFileSync("supabase/migrations/20261119121000_station_review_keeps_result_stage.sql", "utf8");
  const next = migration.slice(migration.indexOf("next_status := case"), migration.indexOf("next_result := case"));
  const kept = next.indexOf("when s.status::text in ('RESULT_READY','COMPLETED') then s.status::text");
  assert.ok(kept > 0 && kept < next.indexOf("then 'IN_PROGRESS'"), "the saved result stage is checked before the in-progress fallback");
  assert.ok(next.indexOf("complete_count>=expected_count") < kept, "every station decided still promotes on its own");
});

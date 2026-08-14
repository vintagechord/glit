import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { partitionGuestCartClaimEntries } from "../src/lib/guest-cart-claim";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";

test("guest cart claim requires the exact id-to-token pair", () => {
  const result = partitionGuestCartClaimEntries(
    {
      [firstId]: "guest-token-one",
      [secondId]: "wrong-token",
    },
    [
      {
        id: firstId,
        user_id: null,
        guest_token: "guest-token-one",
        status: "SUBMITTED",
        payment_status: "UNPAID",
      },
      {
        id: secondId,
        user_id: null,
        guest_token: "guest-token-two",
        status: "WAITING_PAYMENT",
        payment_status: "PAYMENT_PENDING",
      },
    ],
  );

  assert.deepEqual(result, {
    claimableEntries: { [firstId]: "guest-token-one" },
    invalidSubmissionIds: [secondId],
  });
});

test("guest cart claim rejects paid, deleted, draft, and member-owned rows", () => {
  const ids = Array.from({ length: 4 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
  );
  const entries = Object.fromEntries(ids.map((id) => [id, `token-${id}`]));
  const rows = [
    {
      id: ids[0],
      user_id: null,
      guest_token: entries[ids[0]],
      status: "SUBMITTED",
      payment_status: "PAID",
    },
    {
      id: ids[1],
      user_id: null,
      guest_token: entries[ids[1]],
      status: "SUBMITTED",
      payment_status: "UNPAID",
      user_deleted_at: "2026-08-15T00:00:00.000Z",
    },
    {
      id: ids[2],
      user_id: null,
      guest_token: entries[ids[2]],
      status: "DRAFT",
      payment_status: "UNPAID",
    },
    {
      id: ids[3],
      user_id: "member-one",
      guest_token: entries[ids[3]],
      status: "SUBMITTED",
      payment_status: "UNPAID",
    },
  ];

  assert.deepEqual(partitionGuestCartClaimEntries(entries, rows), {
    claimableEntries: {},
    invalidSubmissionIds: ids,
  });
});

test("guest cart claim RPC is service-only, exact-token, and row-locked", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/0075_claim_guest_cart_submissions.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /auth\.role\(\).*service_role/);
  assert.match(migration, /submission\.guest_token = entry\.value/);
  assert.match(migration, /for update of submission/);
  assert.match(migration, /matched_count <> expected_count/);
  assert.match(migration, /payment\.status = 'REQUESTED'/);
  assert.match(migration, /PAYMENT_IN_PROGRESS/);
  assert.match(
    migration,
    /grant execute on function public\.claim_guest_cart_submissions\(uuid, jsonb\) to service_role/,
  );
});

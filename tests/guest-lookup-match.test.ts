import assert from "node:assert/strict";
import test from "node:test";

import { matchesGuestLookupIdentity } from "../src/lib/guest-lookup-match";

test("guest lookup accepts either complete stored identity pair", () => {
  const row = {
    guest_name: "결제자",
    guest_email: "payer@example.com",
    applicant_name: "신청 자",
    applicant_email: "artist@example.com",
  };

  assert.equal(
    matchesGuestLookupIdentity(row, " 결제자 ", "PAYER@example.com"),
    true,
  );
  assert.equal(
    matchesGuestLookupIdentity(row, "신청   자", "artist@example.com"),
    true,
  );
});

test("guest lookup never combines fields from different identity pairs", () => {
  assert.equal(
    matchesGuestLookupIdentity(
      {
        guest_name: "결제자",
        guest_email: "payer@example.com",
        applicant_name: "신청자",
        applicant_email: "artist@example.com",
      },
      "결제자",
      "artist@example.com",
    ),
    false,
  );
});

test("guest lookup rejects blank missing identity fields", () => {
  assert.equal(matchesGuestLookupIdentity({}, "", ""), false);
});

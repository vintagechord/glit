import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canEditSubmission } from "../src/lib/submission-edit-access";

test("member can edit only their own member submission", () => {
  assert.equal(
    canEditSubmission(
      {
        user_id: "user-1",
        guest_token: null,
        status: "SUBMITTED",
        payment_status: "UNPAID",
      },
      { userId: "user-1" },
    ),
    true,
  );
  assert.equal(
    canEditSubmission(
      {
        user_id: "user-2",
        guest_token: null,
        status: "SUBMITTED",
        payment_status: "UNPAID",
      },
      { userId: "user-1" },
    ),
    false,
  );
});

test("guest can edit only a guest submission with the exact token", () => {
  assert.equal(
    canEditSubmission(
      {
        user_id: null,
        guest_token: "guest-token-1",
        status: "SUBMITTED",
        payment_status: "UNPAID",
      },
      { guestToken: "guest-token-1" },
    ),
    true,
  );
  assert.equal(
    canEditSubmission(
      {
        user_id: null,
        guest_token: "guest-token-1",
        status: "SUBMITTED",
        payment_status: "UNPAID",
      },
      { guestToken: "guest-token-2" },
    ),
    false,
  );
  assert.equal(
    canEditSubmission(
      {
        user_id: "user-1",
        guest_token: "guest-token-1",
        status: "SUBMITTED",
        payment_status: "UNPAID",
      },
      { guestToken: "guest-token-1" },
    ),
    false,
  );
});

test("member can claim a guest draft only with its guest token", () => {
  const submission = {
    user_id: null,
    guest_token: "guest-token-1",
    status: "DRAFT",
    payment_status: "UNPAID",
  };

  assert.equal(canEditSubmission(submission, { userId: "user-1" }), false);
  assert.equal(
    canEditSubmission(submission, {
      userId: "user-1",
      guestToken: "guest-token-1",
    }),
    true,
  );
});

test("missing submissions and missing credentials fail closed", () => {
  assert.equal(canEditSubmission(null, { userId: "user-1" }), false);
  assert.equal(
    canEditSubmission(
      {
        user_id: null,
        guest_token: "guest-token-1",
        status: "DRAFT",
        payment_status: "UNPAID",
      },
      {},
    ),
    false,
  );
});

test("paid and post-submission lifecycle records cannot be rewritten", () => {
  assert.equal(
    canEditSubmission(
      {
        user_id: "user-1",
        guest_token: null,
        status: "SUBMITTED",
        payment_status: "PAID",
      },
      { userId: "user-1" },
    ),
    false,
  );
  assert.equal(
    canEditSubmission(
      {
        user_id: "user-1",
        guest_token: null,
        status: "IN_PROGRESS",
        payment_status: "UNPAID",
      },
      { userId: "user-1" },
    ),
    false,
  );
});

test("service-role ownership lookups are constrained in SQL, including guest files", () => {
  const source = readFileSync(
    new URL("../src/features/submissions/actions.ts", import.meta.url),
    "utf8",
  );
  const helperStart = source.indexOf("const loadEditableSubmissionByActor");
  const helperEnd = source.indexOf(
    "const scheduleReplacedSubmissionFileCleanup",
    helperStart,
  );
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /\.eq\("id", submissionId\)\s+\.eq\("user_id", normalizedUserId\)/);
  assert.match(
    helper,
    /\.eq\("id", submissionId\)\s+\.is\("user_id", null\)\s+\.eq\("guest_token", normalizedGuestToken\)/,
  );
  assert.equal(
    (source.match(/loadEditableSubmissionByActor\(\{/g) ?? []).length,
    4,
    "album/MV initial and post-payment-cleanup checks must use the scoped loader",
  );

  const guestDownloadStart = source.indexOf("if (!parsed.data.guestToken)");
  const guestDownloadEnd = source.indexOf(
    'const { data: fileRow } = await admin',
    guestDownloadStart,
  );
  const guestDownload = source.slice(guestDownloadStart, guestDownloadEnd);
  assert.match(
    guestDownload,
    /\.eq\("id", parsed\.data\.submissionId\)\s+\.is\("user_id", null\)\s+\.eq\("guest_token", parsed\.data\.guestToken\)/,
  );
});

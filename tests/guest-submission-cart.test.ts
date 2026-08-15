import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeGuestSubmissionCartEntries,
  normalizeGuestSubmissionCartEntries,
  parseGuestSubmissionCartEntries,
  toGuestTokensBySubmissionId,
} from "../src/lib/guest-submission-cart";

const submissionId = (sequence: number) =>
  `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

test("normalizeGuestSubmissionCartEntries trims and normalizes valid entries", () => {
  const id = submissionId(1);

  assert.deepEqual(
    normalizeGuestSubmissionCartEntries([
      { submissionId: `  ${id}  `, guestToken: "  token-123  " },
    ]),
    [{ submissionId: id, guestToken: "token-123" }],
  );
});

test("normalizeGuestSubmissionCartEntries ignores invalid containers and rows", () => {
  const id = submissionId(2);

  assert.deepEqual(normalizeGuestSubmissionCartEntries(null), []);
  assert.deepEqual(normalizeGuestSubmissionCartEntries({}), []);
  assert.deepEqual(
    normalizeGuestSubmissionCartEntries([
      null,
      [],
      "not-an-entry",
      { submissionId: "not-a-uuid", guestToken: "token-123" },
      { submissionId: id, guestToken: 123 },
      { submissionId: id },
      { submissionId: id, guestToken: "1234567" },
      { submissionId: id, guestToken: "x".repeat(121) },
      { submissionId: id, guestToken: "12345678" },
    ]),
    [{ submissionId: id, guestToken: "12345678" }],
  );
});

test("normalizeGuestSubmissionCartEntries accepts token length boundaries", () => {
  const minId = submissionId(3);
  const maxId = submissionId(4);

  assert.deepEqual(
    normalizeGuestSubmissionCartEntries([
      { submissionId: minId, guestToken: "a".repeat(8) },
      { submissionId: maxId, guestToken: "b".repeat(120) },
    ]),
    [
      { submissionId: minId, guestToken: "a".repeat(8) },
      { submissionId: maxId, guestToken: "b".repeat(120) },
    ],
  );
});

test("normalizeGuestSubmissionCartEntries deduplicates by submission and keeps the latest token", () => {
  const firstId = submissionId(5);
  const secondId = submissionId(6);

  assert.deepEqual(
    normalizeGuestSubmissionCartEntries([
      { submissionId: firstId, guestToken: "token-old" },
      { submissionId: secondId, guestToken: "token-two" },
      { submissionId: firstId, guestToken: "token-new" },
    ]),
    [
      { submissionId: firstId, guestToken: "token-new" },
      { submissionId: secondId, guestToken: "token-two" },
    ],
  );
});

test("normalizeGuestSubmissionCartEntries limits the cart to the last 100 unique entries", () => {
  const entries = Array.from({ length: 105 }, (_, index) => ({
    submissionId: submissionId(index + 1),
    guestToken: `token-${String(index).padStart(3, "0")}`,
  }));

  const normalized = normalizeGuestSubmissionCartEntries(entries);

  assert.equal(normalized.length, 100);
  assert.equal(normalized[0]?.submissionId, submissionId(6));
  assert.equal(normalized[99]?.submissionId, submissionId(105));
});

test("parseGuestSubmissionCartEntries safely parses, normalizes, and rejects malformed JSON", () => {
  const id = submissionId(7);

  assert.deepEqual(parseGuestSubmissionCartEntries(null), []);
  assert.deepEqual(parseGuestSubmissionCartEntries(""), []);
  assert.deepEqual(parseGuestSubmissionCartEntries("not-json"), []);
  assert.deepEqual(parseGuestSubmissionCartEntries('{"submissionId":"bad"}'), []);
  assert.deepEqual(
    parseGuestSubmissionCartEntries(
      JSON.stringify([
        { submissionId: id, guestToken: "token-old" },
        { submissionId: "invalid", guestToken: "token-bad" },
        { submissionId: id, guestToken: "token-new" },
      ]),
    ),
    [{ submissionId: id, guestToken: "token-new" }],
  );
});

test("toGuestTokensBySubmissionId returns a normalized submission-to-token map", () => {
  const firstId = submissionId(8);
  const secondId = submissionId(9);

  assert.deepEqual(
    toGuestTokensBySubmissionId([
      { submissionId: firstId, guestToken: "token-old" },
      { submissionId: secondId, guestToken: "  token-two  " },
      { submissionId: firstId, guestToken: "token-new" },
      { submissionId: "invalid", guestToken: "token-bad" },
    ]),
    {
      [firstId]: "token-new",
      [secondId]: "token-two",
    },
  );
});

test("re-adding an edited submission updates one guest cart entry", () => {
  const editedId = submissionId(10);
  const untouchedId = submissionId(11);

  assert.deepEqual(
    mergeGuestSubmissionCartEntries(
      [
        { submissionId: editedId, guestToken: "token-before" },
        { submissionId: untouchedId, guestToken: "token-untouched" },
      ],
      [{ submissionId: editedId, guestToken: "token-after" }],
    ),
    [
      { submissionId: editedId, guestToken: "token-after" },
      { submissionId: untouchedId, guestToken: "token-untouched" },
    ],
  );
});

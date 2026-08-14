import assert from "node:assert/strict";
import test from "node:test";

import {
  getGuestStorageOwnerId,
  getStorageLogId,
} from "../src/lib/guest-storage-owner";
import { isSubmissionObjectKeyOwned } from "../src/lib/submission-object-key";

const submissionId = "00000000-0000-4000-8000-000000000001";
const fileName = "00000000-0000-4000-8000-000000000002-song.wav";

test("guest storage owner ids do not expose the bearer token", () => {
  const token = "guest-secret-token";
  const ownerId = getGuestStorageOwnerId(token);
  assert.match(ownerId, /^guest-[a-f0-9]{32}$/);
  assert.equal(ownerId.includes(token), false);
  assert.equal(ownerId, getGuestStorageOwnerId(token));
});

test("storage log ids are deterministic and never contain object paths", () => {
  const objectKey =
    "submissions/guest-secret-token/album/00000000-0000-4000-8000-000000000001/file.wav";
  const logId = getStorageLogId(objectKey);
  assert.match(logId, /^[a-f0-9]{16}$/);
  assert.equal(logId.includes("guest-secret-token"), false);
  assert.equal(logId, getStorageLogId(objectKey));
});

test("submission object keys require the configured prefix, owner, and submission", () => {
  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey: `submissions/member-one/album/${submissionId}/${fileName}`,
      prefix: "submissions",
      submissionId,
      submissionUserId: "member-one",
    }),
    true,
  );
  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey: `other/member-one/album/${submissionId}/${fileName}`,
      prefix: "submissions",
      submissionId,
      submissionUserId: "member-one",
    }),
    false,
  );
  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey: `submissions/member-two/album/${submissionId}/${fileName}`,
      prefix: "submissions/",
      submissionId,
      submissionUserId: "member-one",
    }),
    false,
  );
  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey: `submissions/member-one/album/00000000-0000-4000-8000-000000000099/${fileName}`,
      prefix: "submissions/",
      submissionId,
      submissionUserId: "member-one",
    }),
    false,
  );
});

test("guest and claimed-guest object keys stay scoped to the submission", () => {
  const guestToken = "guest-token-one";
  const objectKey = `submissions/guest-${guestToken}/album/${submissionId}/${fileName}`;
  const hashedObjectKey = `submissions/${getGuestStorageOwnerId(guestToken)}/album/${submissionId}/${fileName}`;

  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey: hashedObjectKey,
      prefix: "submissions/",
      submissionId,
      guestToken,
    }),
    true,
  );
  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey,
      prefix: "submissions/",
      submissionId,
      guestToken,
    }),
    true,
  );
  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey,
      prefix: "submissions/",
      submissionId,
      guestToken: "wrong-token",
    }),
    false,
  );
  assert.equal(
    isSubmissionObjectKeyOwned({
      objectKey,
      prefix: "submissions/",
      submissionId,
      submissionUserId: "claimed-member",
      allowClaimedGuestOwner: true,
    }),
    true,
  );
});

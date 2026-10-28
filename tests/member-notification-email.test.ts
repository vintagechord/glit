import assert from "node:assert/strict";
import test from "node:test";
import { getMemberNotificationEmail } from "../src/lib/member-notification-email";

test("a member's current Auth email always takes priority over application contacts", () => {
  assert.equal(getMemberNotificationEmail({ id: "member", email: " Owner@Example.com ", identities: [{ provider: "custom:naver" }] }, "old@example.com"), "owner@example.com");
  assert.equal(getMemberNotificationEmail({ id: "member", email: "invalid", identities: [{ provider: "google" }] }, "other@example.com"), null);
});

test("email-less social members can receive notices at their declared application contact", () => {
  for (const provider of ["google", "kakao", "custom:naver"]) {
    assert.equal(getMemberNotificationEmail({ id: "member", email: null, identities: [{ provider }] }, " Applicant@Example.com "), "applicant@example.com");
  }
  assert.equal(getMemberNotificationEmail({ id: "member", app_metadata: { providers: ["custom:naver"] } }, "applicant@example.com"), "applicant@example.com");
});

test("missing users, ordinary email accounts and invalid contacts cannot trigger a fallback", () => {
  for (const user of [null, undefined, { email: null }, { id: "member", identities: [{ provider: "email" }] }, { id: "member", app_metadata: { providers: "custom:naver" } }]) {
    assert.equal(getMemberNotificationEmail(user, "old@example.com"), null);
  }
  assert.equal(getMemberNotificationEmail({ id: "member", identities: [{ provider: "custom:naver" }] }, "invalid"), null);
});

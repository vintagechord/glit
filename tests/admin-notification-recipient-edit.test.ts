import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { describeSubmissionRecipient, saveSubmissionNotificationEmail } from "../src/lib/admin/notification-recipient-edit";

type Op = [string, ...unknown[]];
type Call = { table: string; ops: Op[] };

/** Records PostgREST chains; each awaited chain is answered by `answer`. */
function fakeDb(options: {
  user?: { id: string; email?: string | null; app_metadata?: Record<string, unknown>; identities?: Array<{ provider: string }> } | null;
  answer: (call: Call) => { data?: unknown; error?: unknown };
}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "not", "order", "limit", "update", "insert"]) {
      builder[method] = (...args: unknown[]) => { call.ops.push([method, ...args]); return builder; };
    }
    builder.maybeSingle = () => { call.ops.push(["maybeSingle"]); return Promise.resolve({ error: null, ...options.answer(call) }); };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ error: null, ...options.answer(call) }).then(resolve, reject);
    return builder;
  };
  const db = {
    from,
    auth: { admin: { getUserById: async () => ({ data: { user: options.user ?? null }, error: options.user ? null : { message: "missing" } }) } },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const naverMember = { id: "member-1", email: "", app_metadata: { provider: "custom:naver", providers: ["custom:naver"] }, identities: [{ provider: "custom:naver" }] };

test("an email-less social member without any address can be given one on this application", async () => {
  const { db } = fakeDb({
    user: naverMember,
    answer: ({ table, ops }) => {
      if (table === "profiles") return { data: { notification_email: null } };
      if (table === "submissions" && ops.some(([op, column]) => op === "eq" && column === "user_id")) {
        return { data: [{ applicant_email: "Artist@Example.com" }, { applicant_email: "artist@example.com" }, { applicant_email: "bad" }] };
      }
      return { data: null };
    },
  });
  const state = await describeSubmissionRecipient(db, { id: "mv-1", user_id: "member-1", applicant_email: null });
  assert.equal(state.recipient, null);
  assert.equal(state.source, "none");
  assert.equal(state.editField, "applicant_email");
  assert.deepEqual(state.suggestions, ["artist@example.com"]);
});

test("account and saved member addresses are never overridden from the admin page", async () => {
  const withAccount = fakeDb({ user: { id: "m", email: "member@example.com" }, answer: () => ({ data: null }) });
  const account = await describeSubmissionRecipient(withAccount.db, { id: "s", user_id: "m" });
  assert.equal(account.recipient, "member@example.com");
  assert.equal(account.editField, null);

  const withSaved = fakeDb({ user: naverMember, answer: ({ table }) => (table === "profiles" ? { data: { notification_email: "saved@example.com" } } : { data: [] }) });
  const saved = await describeSubmissionRecipient(withSaved.db, { id: "s", user_id: "member-1", applicant_email: "old@example.com" });
  assert.equal(saved.recipient, "saved@example.com");
  assert.equal(saved.source, "member_notification");
  assert.equal(saved.editField, null);
});

test("guests are edited through the guest email that the result mail reads first", async () => {
  const { db } = fakeDb({ answer: () => ({ data: null }) });
  const state = await describeSubmissionRecipient(db, { id: "g", user_id: null, guest_email: "", applicant_email: "applicant@example.com" });
  assert.equal(state.recipient, "applicant@example.com");
  assert.equal(state.editField, "guest_email");
});

test("saving writes only the address column and an event without the address", async () => {
  const { db, calls } = fakeDb({
    user: naverMember,
    answer: ({ table, ops }) => {
      if (table === "submissions" && ops.some(([op]) => op === "maybeSingle")) return { data: { id: "mv-1", user_id: "member-1", guest_email: null, applicant_email: null } };
      if (table === "profiles") return { data: { notification_email: null } };
      return { data: [] };
    },
  });
  const result = await saveSubmissionNotificationEmail(db, { submissionId: "mv-1", email: " Customer@Example.com ", actorUserId: "admin-1" });
  assert.deepEqual(result, { ok: true, changed: true });
  const update = calls.find((call) => call.ops.some(([op]) => op === "update"));
  assert.deepEqual(update?.ops.find(([op]) => op === "update"), ["update", { applicant_email: "customer@example.com" }]);
  const event = calls.find((call) => call.table === "submission_events");
  const inserted = event?.ops.find(([op]) => op === "insert")?.[1] as { message: string; event_type: string };
  assert.equal(inserted.event_type, "ADMIN_CONTACT");
  assert.doesNotMatch(inserted.message, /@/);
  assert.equal(calls.some((call) => call.ops.some(([op, value]) => op === "update" && JSON.stringify(value).match(/status|payment/))), false);
});

test("invalid addresses and members with an account email are refused", async () => {
  const { db } = fakeDb({ answer: () => ({ data: null }) });
  assert.deepEqual(await saveSubmissionNotificationEmail(db, { submissionId: "x", email: "not-an-email", actorUserId: "a" }), { ok: false, error: "이메일 주소 형식을 확인해주세요." });
  const member = fakeDb({
    user: { id: "m", email: "member@example.com" },
    answer: ({ table }) => (table === "submissions" ? { data: { id: "s", user_id: "m", guest_email: null, applicant_email: null } } : { data: null }),
  });
  const refused = await saveSubmissionNotificationEmail(member.db, { submissionId: "s", email: "other@example.com", actorUserId: "a" });
  assert.equal(refused.ok, false);
  assert.equal(member.calls.some((call) => call.ops.some(([op]) => op === "update")), false);
});

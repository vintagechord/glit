import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { adminMenuAttentionKeys, loadAdminMenuAttention, markAdminSectionSeen } from "../src/lib/admin/menu-attention";

type Row = Record<string, unknown>;
type Call = { table: string; filters: Array<[string, string, unknown]>; head: boolean };

/** A PostgREST-like table store: enough of the builder for the loader. */
function fakeDb(tables: Record<string, Row[]>, failing: string[] = []) {
  const calls: Call[] = [];
  const upserts: Array<{ table: string; row: Row }> = [];
  const db = {
    from(table: string) {
      const call: Call = { table, filters: [], head: false };
      calls.push(call);
      const read = (row: Row, column: string) => column.split(".").reduce<unknown>((value, key) => {
        const next = Array.isArray(value) ? value[0] : value;
        return next && typeof next === "object" ? (next as Row)[key] : undefined;
      }, row);
      const rows = () => (tables[table] ?? []).filter((row) => call.filters.every(([op, column, value]) => {
        const actual = read(row, column);
        if (op === "eq") return actual === value;
        if (op === "neq") return actual !== value;
        if (op === "gt") return typeof actual === "string" ? actual > String(value) : Number(actual) > Number(value);
        if (op === "in") return (value as unknown[]).includes(actual);
        if (op === "is") return (actual ?? null) === value;
        return true;
      }));
      const result = () => failing.includes(table)
        ? { data: null, count: null, error: { message: "boom" } }
        : { data: call.head ? null : rows(), count: rows().length, error: null };
      const query = {
        select(_columns: string, options?: { head?: boolean }) { call.head = Boolean(options?.head); return query; },
        eq(column: string, value: unknown) { call.filters.push(["eq", column, value]); return query; },
        neq(column: string, value: unknown) { call.filters.push(["neq", column, value]); return query; },
        gt(column: string, value: unknown) { call.filters.push(["gt", column, value]); return query; },
        in(column: string, value: unknown[]) { call.filters.push(["in", column, value]); return query; },
        is(column: string, value: unknown) { call.filters.push(["is", column, value]); return query; },
        limit() { return query; },
        async maybeSingle() { const r = result(); return { data: r.data?.[0] ?? null, error: r.error }; },
        async upsert(row: Row) {
          upserts.push({ table, row });
          const list = (tables[table] ??= []);
          const index = list.findIndex((item) => item.user_id === row.user_id && item.section === row.section);
          if (index >= 0) list[index] = row; else list.push(row);
          return { error: null };
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, calls, upserts, tables };
}

const ADMIN = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const now = new Date("2026-11-19T10:00:00Z");

const fixture = () => ({
  admin_section_views: [
    { user_id: ADMIN, section: "karaoke", seen_at: "2026-11-18T00:00:00Z" },
    { user_id: OTHER, section: "magazine", seen_at: "2026-11-19T09:59:00Z" },
  ],
  karaoke_requests: [
    { id: "k1", status: "REQUESTED", created_at: "2026-11-17T00:00:00Z" }, // seen, still pending
    { id: "k2", status: "REQUESTED", created_at: "2026-11-18T05:00:00Z" }, // arrived after the last visit
    { id: "k3", status: "COMPLETED", created_at: "2026-11-19T01:00:00Z" }, // handled
  ],
  magazine_requests: [
    { id: "m1", status: "REQUESTED", created_at: "2026-11-10T00:00:00Z" },
    { id: "m2", status: "WRITING", created_at: "2026-11-19T00:00:00Z" },
  ],
  support_inquiries: [{ id: "i1", status: "ANSWERED", created_at: "2026-11-19T00:00:00Z" }],
  studio_reservation_requests: [
    { id: "s1", status: "REQUESTED", created_at: "2026-11-19T00:00:00Z" },
    { id: "s2", status: "REQUESTED", created_at: "2026-11-19T01:00:00Z" },
  ],
  support_chat_conversations: [{ unread_admin_count: 2 }, { unread_admin_count: 0 }, { unread_admin_count: 3 }],
  email_outbox: [
    { id: "e1", status: "failed", acknowledged_at: null },
    { id: "e2", status: "failed", acknowledged_at: "2026-11-16T00:00:00Z" },
    { id: "e3", status: "accepted", acknowledged_at: null },
    { id: "e4", status: "uncertain", acknowledged_at: null },
  ],
  submission_payments: [
    { id: "p1", status: "REQUESTED", result_code: "APPROVAL_UNCERTAIN" },
    { id: "p2", status: "REQUESTED", result_code: null }, // an open card window is not a decision to make
    { id: "p3", status: "APPROVED", result_code: "0000" },
  ],
  submission_order_cash_receipts: [
    { status: "REQUESTED", updated_at: "2026-11-19T09:00:00Z", order: { status: "PAID" } }, // issue
    { status: "REQUESTED", updated_at: "2026-11-19T09:00:00Z", order: { status: "BANK_PENDING" } }, // waits for the deposit
    { status: "UNCERTAIN", updated_at: "2026-11-19T09:00:00Z", order: { status: "PAID" } }, // verify
    { status: "ISSUED", updated_at: "2026-11-19T09:00:00Z", order: { status: "REFUNDED" } }, // cancel in Hometax
    { status: "ISSUED", updated_at: "2026-11-19T09:00:00Z", order: { status: "PAID" } }, // done
  ],
});

test("each menu card counts what this administrator has not looked at yet", async () => {
  const { db } = fakeDb(fixture());
  assert.deepEqual(await loadAdminMenuAttention(db, ADMIN, now), {
    chat: 5, // unread messages, as the chat page totals them
    inquiries: 0,
    karaoke: 1, // only the request that arrived after the last visit
    magazine: 1, // never opened by this administrator: every pending request is new
    credit_requests: 2,
    emails: 2, // failed or uncertain without 확인 완료
    payments: 1,
    cash_receipts: 3,
  });
  // Another administrator's visit does not clear this one's badge.
  assert.equal((await loadAdminMenuAttention(db, OTHER, now)).magazine, 0);
  assert.equal((await loadAdminMenuAttention(db, OTHER, now)).karaoke, 2);
});

test("a count that could not be loaded is unknown, never zero, and the others still load", async () => {
  const failed = await loadAdminMenuAttention(fakeDb(fixture(), ["karaoke_requests", "email_outbox"]).db, ADMIN, now);
  assert.equal(failed.karaoke, null);
  assert.equal(failed.emails, null);
  assert.equal(failed.chat, 5);
  assert.equal(failed.credit_requests, 2);
  // Without the last-opened times every old request would look new.
  const noSeen = await loadAdminMenuAttention(fakeDb(fixture(), ["admin_section_views"]).db, ADMIN, now);
  assert.deepEqual([noSeen.karaoke, noSeen.magazine, noSeen.inquiries, noSeen.credit_requests], [null, null, null, null]);
  assert.equal(noSeen.chat, 5);
});

test("opening a request page clears its badge from the time the list was loaded", async () => {
  const store = fakeDb(fixture());
  const rendered = "2026-11-19T09:59:30Z";
  assert.deepEqual(await markAdminSectionSeen(store.db, { userId: ADMIN, section: "karaoke", renderedAt: rendered, now }), { ok: true });
  assert.equal((await loadAdminMenuAttention(store.db, ADMIN, now)).karaoke, 0);
  // A request that arrived while the page was loading is still new.
  store.tables.karaoke_requests.push({ id: "k4", status: "REQUESTED", created_at: "2026-11-19T09:59:45Z" });
  assert.equal((await loadAdminMenuAttention(store.db, ADMIN, now)).karaoke, 1);
  // An older tab finishing late never moves the mark backwards.
  await markAdminSectionSeen(store.db, { userId: ADMIN, section: "karaoke", renderedAt: "2026-11-19T09:55:00Z", now });
  assert.equal(store.tables.admin_section_views.find((row) => row.user_id === ADMIN && row.section === "karaoke")?.seen_at, new Date(rendered).toISOString());
  // A time from the future or from a tab left open is replaced by now.
  for (const renderedAt of ["2026-11-20T00:00:00Z", "2026-11-19T09:00:00Z", "not a date", undefined]) {
    const fresh = fakeDb(fixture());
    await markAdminSectionSeen(fresh.db, { userId: ADMIN, section: "magazine", renderedAt, now });
    assert.equal(fresh.upserts.at(-1)?.row.seen_at, now.toISOString(), String(renderedAt));
  }
  const unknown = fakeDb(fixture());
  assert.deepEqual(await markAdminSectionSeen(unknown.db, { userId: ADMIN, section: "users", now }), { ok: false });
  assert.equal(unknown.upserts.length, 0);
});

test("the admin home shows the badge on the menu cards and request pages report being opened", () => {
  const home = readFileSync("src/app/admin/page.tsx", "utf8");
  assert.match(home, /loadAdminMenuAttention\(db, admin\.id\)/);
  assert.match(home, /absolute -right-2 -top-2/, "the count sits in the card's top-right corner");
  for (const href of Object.keys(adminMenuAttentionKeys)) assert.ok(home.includes(`href: "${href}"`), href);
  for (const [page, section] of [
    ["src/app/admin/karaoke/page.tsx", 'section="karaoke"'],
    ["src/app/admin/magazine/page.tsx", 'section="magazine"'],
    ["src/app/admin/inquiries/page.tsx", 'section="inquiries"'],
    ["src/app/admin/credits/requests/page.tsx", '"credit_requests"'],
  ]) assert.ok(readFileSync(page, "utf8").includes(section), page);
  // The mark is written from the browser, so a link prefetch cannot clear a badge.
  assert.match(readFileSync("src/components/admin/mark-section-seen.tsx", "utf8"), /^"use client";/);
  assert.match(readFileSync("src/features/admin/section-seen-actions.ts", "utf8"), /requireAdminAction\(\)/);
});

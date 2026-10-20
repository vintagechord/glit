import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as credits from "../src/lib/credits";

const userId = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;

function database(
  rows: Record<string, Row[]>,
  errors: Record<string, string> = {},
  responseLimit = 1000,
) {
  const reads: Array<{ table: string; columns: string }> = [];
  const client = {
    from(table: string) {
      let filtered = [...(rows[table] ?? [])];
      let countOnly = false;
      let includeCount = false;
      let firstRow = 0;
      let lastRow = responseLimit - 1;
      const result = () => ({
        data: countOnly ? null : filtered.slice(firstRow, Math.min(lastRow + 1, firstRow + responseLimit)),
        count: includeCount ? filtered.length : null,
        error: errors[table] ? { message: errors[table] } : null,
      });
      const query = {
        select(columns: string, options?: { head?: boolean; count?: string }) {
          reads.push({ table, columns });
          countOnly = Boolean(options?.head);
          includeCount = options?.count === "exact";
          return query;
        },
        eq(column: string, value: unknown) {
          filtered = filtered.filter((row) => row[column] === value);
          return query;
        },
        neq(column: string, value: unknown) {
          filtered = filtered.filter((row) => row[column] !== value);
          return query;
        },
        order(column: string) {
          filtered.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
          return query;
        },
        range(first: number, last: number) {
          firstRow = first;
          lastRow = last;
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ ...result(), data: filtered[0] ?? null });
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, reads };
}

test("credit balances sum historical and current magazine charges, excluding canceled and other users", async () => {
  const own = (row: Row) => ({ user_id: userId, ...row });
  const { client, reads } = database({
    submissions: [
      own({ type: "ALBUM", payment_status: "PAID" }),
      own({ type: "ALBUM", payment_status: "PAID" }),
      own({ type: "MV", payment_status: "PAID" }),
      own({ type: "ALBUM", payment_status: "PENDING" }),
      { user_id: "another-user", type: "ALBUM", payment_status: "PAID" },
    ],
    credit_grants: [own({ amount: 10 }), { user_id: "another-user", amount: 50 }],
    magazine_requests: [
      own({ status: "PUBLISHED", credits_spent: 1 }),
      own({ status: "REQUESTED", credits_spent: 3 }),
      own({ status: "CANCELED", credits_spent: 3 }),
      { user_id: "another-user", status: "REQUESTED", credits_spent: 3 },
    ],
    credit_reward_redemptions: [
      own({ status: "ISSUED", credits_spent: 2 }),
      own({ status: "CANCELED", credits_spent: 4 }),
    ],
  });
  assert.deepEqual(await credits.getUserCreditSummary(client, userId), {
    earned: 12,
    adminGranted: 10,
    magazineUsed: 4,
    rewardUsed: 2,
    used: 6,
    available: 6,
  });
  assert.deepEqual(reads.find((read) => read.table === "magazine_requests"), {
    table: "magazine_requests",
    columns: "credits_spent",
  });
});

test("magazine charges are not truncated by the API row limit", async () => {
  const { client, reads } = database({
    magazine_requests: Array.from({ length: 1101 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      user_id: userId,
      status: "PUBLISHED",
      credits_spent: index === 0 ? 1 : 3,
    })),
    credit_grants: [{ user_id: userId, amount: 4000 }],
  }, {}, 200);
  const summary = await credits.getUserCreditSummary(client, userId);
  assert.equal(summary.magazineUsed, 3301);
  assert.equal(summary.available, 699);
  assert.equal(reads.filter((read) => read.table === "magazine_requests").length, 6);
});

test("a failed charge lookup cannot silently expose an unspent balance", async () => {
  const { client } = database({}, { magazine_requests: "charge lookup failed" });
  await assert.rejects(
    credits.getUserCreditSummary(client, userId),
    /Failed to load magazine credit usage: charge lookup failed/,
  );
});

const require = createRequire(import.meta.url);
function loadModule<T>(path: string, mocks: Record<string, unknown>): T {
  const code = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "console", code)(
    (name: string) => name in mocks ? mocks[name] : require(name),
    loaded,
    loaded.exports,
    { ...console, error() {} },
  );
  return loaded.exports as T;
}

type RequestAction = (
  payload: FormData | Record<string, unknown>,
) => Promise<{ error?: string; message?: string; requestId?: string }>;

function requestFixture(balance: number, rpcError?: string) {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const uploads: string[] = [];
  const paths: string[] = [];
  const { client } = database({
    profiles: [{ user_id: userId, name: "Member", phone: "01012345678" }],
    credit_grants: [{ user_id: userId, amount: balance }],
  });
  const admin = Object.assign(client, {
    storage: {
      from() {
        return {
          async upload(path: string) {
            uploads.push(path);
            return { error: null };
          },
          getPublicUrl() {
            return { data: { publicUrl: "https://example.test/artwork.png" } };
          },
          async remove() { return { error: null }; },
        };
      },
    },
  });
  const action = loadModule<{ createMagazineRequestAction: RequestAction }>(
    "../src/features/magazine/actions.ts",
    {
      "@/lib/credits": credits,
      "@/lib/supabase/admin": { createAdminClient: () => admin },
      "@/lib/supabase/server": {
        createServerSupabase: async () => ({
          auth: { getUser: async () => ({ data: { user: { id: userId, email: "member@example.test" } }, error: null }) },
          async rpc(name: string, params: Record<string, unknown>) {
            rpcCalls.push({ name, params });
            return { data: rpcError ? null : { id: "new-request" }, error: rpcError ? { message: rpcError } : null };
          },
        }),
      },
      "next/cache": { revalidatePath: (path: string) => paths.push(path) },
      "next/navigation": { redirect() { throw new Error("Unexpected redirect"); } },
    },
  ).createMagazineRequestAction;
  return { action, rpcCalls, uploads, paths };
}

test("0, 1 and 2 credits cannot submit or upload artwork through the server action", async () => {
  for (const balance of [0, 1, 2]) {
    const fixture = requestFixture(balance);
    const payload = new FormData();
    payload.set("targetChannel", "MEDIA");
    payload.set("artworkFile", new File(["image"], "cover.png", { type: "image/png" }));
    const result = await fixture.action(payload);
    assert.equal(result.error, credits.MAGAZINE_CREDIT_INSUFFICIENT_MESSAGE);
    assert.equal(result.requestId, undefined);
    assert.deepEqual(fixture.rpcCalls, []);
    assert.deepEqual(fixture.uploads, []);
    assert.deepEqual(fixture.paths, []);
  }
});

test("3 credits allows the server action and forged client prices never reach the RPC", async () => {
  const fixture = requestFixture(3);
  const result = await fixture.action({
    targetChannel: "MEDIA",
    creditsSpent: 1,
    credits_spent: 1,
    creditCost: 1,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.requestId, "new-request");
  assert.equal(fixture.rpcCalls.length, 1);
  assert.equal(fixture.rpcCalls[0].name, "create_magazine_request");
  assert.deepEqual(Object.keys(fixture.rpcCalls[0].params).filter((key) => /cost|spent/i.test(key)), []);
  assert.ok(fixture.paths.includes("/mypage/credits"));
});

test("the action reports the same 3-credit rule if a concurrent request exhausts the balance", async () => {
  const fixture = requestFixture(3, "INSUFFICIENT_CREDITS");
  const result = await fixture.action({ targetChannel: "MEDIA" });
  assert.equal(result.error, credits.MAGAZINE_CREDIT_INSUFFICIENT_MESSAGE);
  assert.equal(result.requestId, undefined);
  assert.deepEqual(fixture.paths, []);
});

test("the rendered magazine form requires 3 credits and keeps guests from submitting", () => {
  const { MagazineRequestForm } = loadModule<{
    MagazineRequestForm: React.ComponentType<{ isAuthenticated: boolean; availableCredits: number }>;
  }>("../src/features/magazine/magazine-request-form.tsx", {
    "@/lib/credits": credits,
    "./actions": { createMagazineRequestAction() { throw new Error("Unexpected request"); } },
    "next/navigation": { useRouter: () => ({}), usePathname: () => "/magazine" },
  });
  for (const [isAuthenticated, availableCredits, disabled] of [
    [true, 0, true],
    [true, 1, true],
    [true, 2, true],
    [true, 3, false],
    [false, 3, true],
  ] as const) {
    const html = renderToStaticMarkup(React.createElement(MagazineRequestForm, { isAuthenticated, availableCredits }));
    const submit = html.match(/<button type="submit"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    assert.ok(submit, "submit control must exist");
    assert.equal(submit.includes('disabled=""'), disabled);
    assert.ok(html.includes("3크레딧 사용"));
    if (isAuthenticated && availableCredits < 3) assert.ok(submit.includes("3크레딧 필요"));
  }
});

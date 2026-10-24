import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { AccountLookup } from "../src/features/auth/account-lookup";

test("account lookup uses read-only filtered requests, exact matching, and bounded results without credentials in errors", async () => {
  const built = await build({ entryPoints: ["src/features/auth/account-lookup.ts"], bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "lookup-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(server-only|@\/lib\/supabase\/env)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "server-only" ? "" : `export const getSupabaseEnv=()=>({url:'https://project.example.invalid'}); export const getServiceRoleKey=()=> 'private-service-key';` }));
    } }],
  });
  const bundled = { exports: {} as { findAccountByEmail: (email: string) => Promise<AccountLookup | null> } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
  const original = globalThis.fetch;
  const target = "owner@example.invalid";
  const requests: URL[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert.equal(init?.method, "GET");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      assert.equal(url.pathname, "/auth/v1/admin/users");
      assert.equal(url.searchParams.get("filter"), target);
      assert.equal(new Headers(init?.headers).get("apikey"), "private-service-key");
      return new Response(JSON.stringify({ users: [{ id: "other", email: `not-${target}` }, { id: "owner", email: "OWNER@example.invalid", email_confirmed_at: null, private_field: "not-returned" }] }));
    };
    assert.deepEqual(await bundled.exports.findAccountByEmail(` ${target.toUpperCase()} `), { id: "owner", email: "OWNER@example.invalid", email_confirmed_at: null });
    assert.equal(requests.length, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ users: [{ id: "other", email: `not-${target}` }] }));
    assert.equal(await bundled.exports.findAccountByEmail(target), null);
    let count = 0;
    globalThis.fetch = async () => { count += 1; return new Response(JSON.stringify({ users: Array.from({ length: 100 }, (_, i) => ({ id: String(i), email: `other${i}@example.invalid` })) })); };
    await assert.rejects(bundled.exports.findAccountByEmail(target), /result limit exceeded/);
    assert.equal(count, 5);
    for (const response of [new Response("private-provider-payload", { status: 403 }), new Response(JSON.stringify({ users: null }))]) {
      globalThis.fetch = async () => response;
      await assert.rejects(bundled.exports.findAccountByEmail(target), error => {
        assert.doesNotMatch(String(error), /owner@example|private-service|private-provider/);
        return true;
      });
    }
  } finally { globalThis.fetch = original; }
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationsDir = new URL("../supabase/migrations/", import.meta.url);

// Supabase grants every new public table to anon and authenticated, so a table
// without row level security is readable and writable with the public key.
test("every public table created by a migration enables row level security", () => {
  const created = new Set<string>();
  const protectedTables = new Set<string>();
  const dropped = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter(name => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(new URL(file, migrationsDir), "utf8").toLowerCase();
    for (const match of sql.matchAll(/create table (?:if not exists )?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/g)) {
      created.add(match[1]);
    }
    for (const match of sql.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?"?([a-z0-9_]+)"?\s+enable row level security/g)) {
      protectedTables.add(match[1]);
    }
    for (const match of sql.matchAll(/drop table (?:if exists )?(?:public\.)?"?([a-z0-9_]+)/g)) {
      dropped.add(match[1]);
    }
  }
  const unprotected = [...created].filter(name => !protectedTables.has(name) && !dropped.has(name));
  assert.ok(created.size > 50, "migration scan found too few tables");
  assert.deepEqual(unprotected, []);
});
